// Contract lane server glue (vK2): wires contract/src pure logic to Express +
// the SaaS key store. State lives in ~/.ollamas/contract.json (atomic, 0600).
// Raw API keys are delivered exactly ONCE via the status poll after approval —
// held in memory only; a restart before pickup means revoke + re-approve.
import type { Express, Request, Response, NextFunction } from "express";
import { createTenant, issueApiKey, revokeApiKey } from "./store";
import { CONTRACT_VERSION, renderContract, currentContractHash } from "../contract/src/contractdoc.ts";
import {
  applyForMembership,
  rejectMember,
  suspendMember,
  resumeMember,
  getMember,
  type RegistryState,
  type Member,
} from "../contract/src/registry.ts";
import { approveWithKey, revokeWithKey, rotateWithKey, type KeyBridge } from "../contract/src/keys.ts";
import { recordContractAudit, readContractAudit, type AuditAction } from "../contract/src/audit.ts";
import { loadState, saveState, defaultStatePath } from "../contract/src/state.ts";
import { recordHeartbeat, poolNodes, toFleetBackends, mergeFleetBackends, consumeQuota, wouldExceedQuota, type HeartbeatInput } from "../contract/src/pool.ts";
import { shardDir } from "../contract/src/shard.ts";
import { ProviderRouter } from "./providers";
import { notify } from "./notify";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_PATH = process.env.CONTRACT_STATE_PATH || defaultStatePath();
const FLEET_PATH = process.env.FLEET_BACKENDS_PATH || join(homedir(), ".ollamas", "backends.json");

let state: RegistryState | null = null;
const pendingRawKeys = new Map<string, string>(); // memberId → raw key, one-time

function getState(): RegistryState {
  if (!state) {
    const loaded = loadState(STATE_PATH);
    if (loaded.warning) console.warn(`[contract] ${loaded.warning}`);
    state = loaded.state;
  }
  return state;
}

function setState(next: RegistryState): void {
  state = next;
  saveState(STATE_PATH, next);
}

// F4: serialize ALL state mutations. approve/revoke await async store calls between
// read and write; without a lock two concurrent requests interleave getState→setState
// on the single cache and the later write drops the earlier (lost update → orphan key).
// A promise chain runs mutations one-at-a-time in this single-writer process.
let mutationChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = mutationChain.then(() => fn());
  mutationChain = run.then(() => undefined, () => undefined); // never let a rejection break the chain
  return run;
}

const storeBridge: KeyBridge = {
  createTenant: async (name) => createTenant(name, "free"),
  issueKey: async (tenantId, label) => issueApiKey(tenantId, label),
  revokeKey: async (keyId) => revokeApiKey(keyId),
};

/** Public projection — never expose email of others / keyId internals broadly. */
function maskMember(m: Member) {
  return {
    id: m.id,
    status: m.status,
    specs: m.specs,
    appliedAt: m.appliedAt,
    approvedAt: m.approvedAt,
    lastHeartbeat: m.lastHeartbeat,
  };
}

// vK13: append a governance audit entry (best-effort, secret-free — see audit.ts).
function audit(action: AuditAction, memberId: string, actor: string, keyId?: string): void {
  const m = getMember(getState(), memberId);
  recordContractAudit({ action, memberId, status: m?.status ?? "?", actor, keyId }, new Date().toISOString());
}

// --- service functions (shared by HTTP routes, contract_admin tool, CLI path) ---

// G2: notify the operator (T0) that a new applicant is waiting — approval stays
// manual (sovereign) but is no longer silent-poll. macOS local notification is
// zero-account/sovereign; Slack/Discord fire only if CONTRACT_NOTIFY_* is set.
// Best-effort, fire-and-forget — never blocks or throws on the request path.
export function notifyPendingApplicant(memberId: string, specs: Member["specs"], deps?: { osascript?: (script: string) => void; notifyFn?: typeof notify }): void {
  const line = `New contract applicant ${memberId} (${specs.ramGB}GB ${specs.os}/${specs.arch}) — approve: contract approve ${memberId}`;
  try {
    const osascript = deps?.osascript ?? ((script: string) => { spawn("osascript", ["-e", script], { stdio: "ignore" }).on("error", () => {}); });
    osascript(`display notification ${JSON.stringify(line)} with title "ollamas contract"`);
  } catch { /* headless / no osascript → skip */ }
  const cfg = { slackWebhookUrl: process.env.CONTRACT_NOTIFY_SLACK, discordWebhookUrl: process.env.CONTRACT_NOTIFY_DISCORD };
  if (cfg.slackWebhookUrl || cfg.discordWebhookUrl) {
    (deps?.notifyFn ?? notify)(line, cfg).catch(() => {});
  }
}

export function contractApply(input: { email: string; machinePubkey: string; specs: Member["specs"]; contractHash: string }): Promise<Member> {
  return withLock(() => {
    const { state: next, member } = applyForMembership(getState(), input, currentContractHash(), new Date().toISOString());
    setState(next);
    audit("apply", member.id, "applicant");
    return member;
  }).then((member) => {
    notifyPendingApplicant(member.id, member.specs); // after commit, outside the lock
    return member;
  });
}

export function contractApprove(memberId: string): Promise<{ keyId: string; tenantId: string }> {
  return withLock(async () => {
    const r = await approveWithKey(getState(), memberId, storeBridge, new Date().toISOString());
    setState(r.state);
    pendingRawKeys.set(memberId, r.rawKey); // picked up once via status poll
    audit("approve", memberId, "admin", r.keyId);
    return { keyId: r.keyId, tenantId: r.tenantId };
  });
}

export function contractReject(memberId: string): Promise<void> {
  return withLock(() => {
    setState(rejectMember(getState(), memberId, new Date().toISOString()));
    audit("reject", memberId, "admin");
  });
}

/** vK11: suspend an active member (temporary — revoke is permanent). The key
 * stays valid but the node leaves the schedulable pool; vK13 contractResume reverses it. */
export function contractSuspend(memberId: string): Promise<void> {
  return withLock(() => {
    setState(suspendMember(getState(), memberId));
    syncFleetFile(); // suspended is not fresh, but drop the fleet entry explicitly
    audit("suspend", memberId, "admin");
  });
}

/** vK13: reverse a suspend. The node re-enters the pool on its NEXT heartbeat
 * (fleet projection only includes fresh nodes) — not instantly. */
export function contractResume(memberId: string): Promise<void> {
  return withLock(() => {
    setState(resumeMember(getState(), memberId));
    syncFleetFile();
    audit("resume", memberId, "admin");
  });
}

export function contractRevoke(memberId: string): Promise<void> {
  return withLock(async () => {
    pendingRawKeys.delete(memberId);
    const keyId = getMember(getState(), memberId)?.keyId;
    setState(await revokeWithKey(getState(), memberId, storeBridge));
    syncFleetFile(); // drop the node's contract:* fleet entry immediately
    audit("revoke", memberId, "admin", keyId);
  });
}

/** vK13: rotate an active member's API key (litellm principle). New raw key is
 * delivered ONCE via the status poll, like approve. */
export function contractRotate(memberId: string): Promise<{ keyId: string }> {
  return withLock(async () => {
    const r = await rotateWithKey(getState(), memberId, storeBridge);
    setState(r.state);
    pendingRawKeys.set(memberId, r.rawKey); // one-time delivery via status poll
    audit("rotate", memberId, "admin", r.keyId);
    return { keyId: r.keyId };
  });
}

export function contractAuditLog(limit = 100) {
  return readContractAudit(limit);
}

/** Project fresh contract nodes into ~/.ollamas/backends.json so the EXISTING
 * fleet provider (server/providers.ts selectFleetBackend) schedules onto them.
 * Only `contract:` entries are owned/replaced; hand-pinned backends survive (RISK-K3). */
export function syncFleetFile(): void {
  let existing: unknown = [];
  try { existing = JSON.parse(readFileSync(FLEET_PATH, "utf8")); } catch { /* fresh file */ }
  const merged = mergeFleetBackends(existing, toFleetBackends(getState(), Date.now()));
  mkdirSync(dirname(FLEET_PATH), { recursive: true });
  const tmp = `${FLEET_PATH}.contract-tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
  renameSync(tmp, FLEET_PATH);
}

export function contractHeartbeat(tenantId: string, hb: HeartbeatInput): Promise<{ memberId: string }> {
  return withLock(() => {
    const m = getState().members.find((x) => x.tenantId === tenantId && x.status === "active");
    if (!m) throw new Error("no active membership for this key");
    setState(recordHeartbeat(getState(), m.id, hb, new Date().toISOString()));
    syncFleetFile();
    return { memberId: m.id };
  });
}

export function contractPoolNodes() {
  return poolNodes(getState(), Date.now());
}

/** vK10: read-only quota check BEFORE doing work (charge-on-success). */
export function contractQuotaExceeded(tenantId: string): boolean {
  return wouldExceedQuota(getState(), tenantId, new Date().toISOString().slice(0, 10));
}

/** vK4/vK10: gateway-side quota tick — called ONLY after a successful generate. */
export function contractConsumeQuota(tenantId: string): Promise<void> {
  return withLock(() => {
    setState(consumeQuota(getState(), tenantId, new Date().toISOString().slice(0, 10)));
  });
}

/** vK9: shard-first branch. When a healthy shard head (llama-server --rpc group,
 * loopback-bound — gateway must run on the same machine) is registered in
 * ~/.ollamas/shard/head.json, route the request there via OpenAI /v1; any failure
 * falls through to the fleet chain (null return = not handled). */
export async function tryShardGenerate(
  body: { model?: string; messages: Array<{ role: string; content: string }>; temperature?: number },
  fetchFn: typeof fetch = fetch,
): Promise<{ content: string; model: string; source: string; latencyMs: number } | null> {
  let head: { up?: boolean; url?: string; model?: string } = {};
  try {
    head = JSON.parse(readFileSync(join(shardDir(), "head.json"), "utf8"));
  } catch {
    return null;
  }
  if (!head.up || !head.url) return null;
  try {
    const hc = await fetchFn(`${head.url}/health`, { signal: AbortSignal.timeout(1500) } as RequestInit);
    if (!hc.ok) return null;
    const t0 = Date.now();
    const r = await fetchFn(`${head.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: body.messages, temperature: body.temperature, max_tokens: 1024 }),
      signal: AbortSignal.timeout(120_000),
    } as RequestInit);
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const msg = j?.choices?.[0]?.message ?? {};
    const content = String(msg.content || msg.reasoning_content || "");
    if (!content) return null;
    return { content, model: String(j?.model || head.model || "shard"), source: "shard:head", latencyMs: Date.now() - t0 };
  } catch {
    return null; // shard down/hung → fleet chain takes over
  }
}

export function contractStatus(memberId: string): { member: ReturnType<typeof maskMember>; key?: string } | null {
  const m = getMember(getState(), memberId);
  if (!m) return null;
  const out: { member: ReturnType<typeof maskMember>; key?: string } = { member: maskMember(m) };
  const raw = pendingRawKeys.get(memberId);
  if (m.status === "active" && raw) {
    out.key = raw; // one-time delivery
    pendingRawKeys.delete(memberId);
  }
  return out;
}

export function contractList(): Array<ReturnType<typeof maskMember> & { email: string; keyId?: string; tenantId?: string }> {
  return getState().members.map((m) => ({ ...maskMember(m), email: m.email, keyId: m.keyId, tenantId: m.tenantId }));
}

/** Test hook: drop the memory cache so a fresh CONTRACT_STATE_PATH is honored. */
export function _resetContractStateForTests(): void {
  state = null;
  pendingRawKeys.clear();
}

// --- Express wiring ---

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

export function registerContractRoutes(app: Express, adminGuard: Middleware, rateLimit: Middleware, requireAuth: Middleware): void {
  app.post("/api/pool/heartbeat", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenant?.tenantId;
      if (!tenantId) return res.status(401).json({ error: "key required" });
      const { ollamaUrl, models, load, rpcPort } = req.body || {};
      const r = await contractHeartbeat(String(tenantId), {
        ollamaUrl: String(ollamaUrl || ""),
        models: Array.isArray(models) ? models.map(String) : [],
        load: load != null ? Number(load) : undefined,
        rpcPort: rpcPort != null ? Number(rpcPort) : undefined,
      });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/pool/nodes", requireAuth, (req, res) => {
    if (!(req as any).tenant?.tenantId) return res.status(401).json({ error: "key required" });
    res.json({ nodes: contractPoolNodes() });
  });

  app.get("/api/pool/quota", requireAuth, (req, res) => {
    const tenantId = (req as any).tenant?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "key required" });
    const m = getState().members.find((x) => x.tenantId === tenantId && x.status === "active");
    if (!m) return res.status(404).json({ error: "no active membership for this key" });
    res.json({ memberId: m.id, ...m.quota });
  });

  // vK4 federated inference gateway — "one big machine" API surface for members.
  // Quota is enforced HERE (nodes are never trusted to self-limit); the scheduler
  // is the EXISTING fleet provider fed by our ranked backends.json projection.
  app.post("/api/pool/generate", requireAuth, rateLimit, async (req, res) => {
    const tenantId = (req as any).tenant?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "key required" });
    const { model, messages, temperature } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages (non-empty array) required" });
    }
    // F2: check quota BEFORE work (reject at cap) but CONSUME only after a
    // successful generate — a failed inference must never burn a member's quota.
    try {
      if (contractQuotaExceeded(String(tenantId))) return res.status(429).json({ error: "quota exceeded" });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    try {
      // vK9: a healthy shard head (one model split across rpc-servers) takes the
      // request first — the pool's "one big machine" path; fleet is the fallback.
      const shardResult = await tryShardGenerate({ model: model ? String(model) : undefined, messages, temperature: temperature != null ? Number(temperature) : undefined });
      let payload: { content: string; model: string; source: string; latencyMs: number };
      if (shardResult) {
        payload = shardResult;
      } else {
        const ctrl = new AbortController();
        req.on("close", () => ctrl.abort());
        const result = await ProviderRouter.generate(
          { provider: "fleet", model: model ? String(model) : undefined, messages, temperature: temperature != null ? Number(temperature) : undefined } as any,
          undefined,
          undefined,
          ctrl.signal,
        );
        payload = { content: result.text, model: result.modelUsed, source: result.source, latencyMs: result.latencyMs };
      }
      await contractConsumeQuota(String(tenantId)); // charge-on-success only
      res.json(payload);
    } catch (e: any) {
      res.status(502).json({ error: e.message }); // quota untouched on failure
    }
  });

  app.get("/api/contract/document", (_req, res) => {
    res.json({ version: CONTRACT_VERSION, hash: currentContractHash(), text: renderContract() });
  });

  app.post("/api/contract/apply", rateLimit, async (req, res) => {
    try {
      const { email, machinePubkey, specs, contractHash } = req.body || {};
      const member = await contractApply({
        email: String(email || ""),
        machinePubkey: String(machinePubkey || ""),
        specs: {
          ramGB: Number(specs?.ramGB),
          os: String(specs?.os || ""),
          arch: String(specs?.arch || ""),
          gpu: specs?.gpu ? String(specs.gpu) : undefined,
          ollamaVersion: specs?.ollamaVersion ? String(specs.ollamaVersion) : undefined,
        },
        contractHash: String(contractHash || ""),
      });
      res.status(202).json({ id: member.id, status: member.status });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/contract/status/:id", (req, res) => {
    const out = contractStatus(String(req.params.id));
    if (!out) return res.status(404).json({ error: "not found" });
    res.json(out);
  });

  app.get("/api/contract/members", adminGuard, (_req, res) => res.json(contractList()));

  app.post("/api/contract/:id/approve", adminGuard, async (req, res) => {
    try {
      res.json({ id: req.params.id, status: "active", ...(await contractApprove(String(req.params.id))) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/contract/:id/reject", adminGuard, async (req, res) => {
    try {
      await contractReject(String(req.params.id));
      res.json({ id: req.params.id, status: "rejected" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/contract/:id/revoke", adminGuard, async (req, res) => {
    try {
      await contractRevoke(String(req.params.id));
      res.json({ id: req.params.id, status: "revoked" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/contract/:id/suspend", adminGuard, async (req, res) => {
    try {
      await contractSuspend(String(req.params.id));
      res.json({ id: req.params.id, status: "suspended" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/contract/:id/resume", adminGuard, async (req, res) => {
    try {
      await contractResume(String(req.params.id));
      res.json({ id: req.params.id, status: "active" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/contract/:id/rotate", adminGuard, async (req, res) => {
    try {
      // New raw key delivered ONCE via GET /api/contract/status/:id (secret hygiene).
      res.json({ id: req.params.id, status: "active", ...(await contractRotate(String(req.params.id))) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/contract/audit", adminGuard, (req, res) => {
    const limit = req.query.limit ? Math.max(1, Math.min(1000, Number(req.query.limit))) : 100;
    res.json({ entries: contractAuditLog(limit) });
  });
}
