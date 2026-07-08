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
  isInviteUsed,
  markInviteUsed,
  pruneExpiredInvites,
  type RegistryState,
  type Member,
} from "../contract/src/registry.ts";
import { approveWithKey, revokeWithKey, rotateWithKey, type KeyBridge } from "../contract/src/keys.ts";
import { verifyInvite } from "../contract/src/invite.ts";
import { loadOrCreateOperatorKey } from "../contract/src/opkey.ts";
import { renderInstaller } from "../contract/src/installer.ts";
import { existsSync } from "node:fs";
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

export class InviteError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

/** vK17: auto-activate a device from an operator-signed invite. Minting the invite
 * (behind adminGuard) IS the operator's consent, so this needs no manual approve —
 * but it is atomic (withLock, single-use jti) and fully validated (sig/expiry/hash/epoch).
 * Kill switch: AUTO_APPROVE_INVITE=off, or rotate the operator key (stale epoch). */
export function contractApplyWithInvite(
  token: string,
  input: { email: string; machinePubkey: string; specs: Member["specs"] },
): Promise<{ memberId: string; keyId: string; tenantId: string; rawKey: string }> {
  if (process.env.AUTO_APPROVE_INVITE === "off") {
    return Promise.reject(new InviteError(503, "invite auto-approval disabled (AUTO_APPROVE_INVITE=off)"));
  }
  const op = loadOrCreateOperatorKey();
  return withLock(async () => {
    const now = Date.now();
    const vr = verifyInvite(token, op.publicKeyHex, now, currentContractHash(), op.epoch);
    if (!vr.valid || !vr.payload) {
      const reason = vr.reason || "invalid invite";
      const status = /expired/i.test(reason) ? 403 : /signature|epoch|version|malformed/i.test(reason) ? 401 : /contract/i.test(reason) ? 409 : 400;
      throw new InviteError(status, reason);
    }
    const inv = vr.payload;
    let state = pruneExpiredInvites(getState(), now);
    if (isInviteUsed(state, inv.jti)) throw new InviteError(409, "invite already redeemed (single-use)");
    // apply → immediately approve (pre-authorized). Quota comes from the invite.
    const applied = applyForMembership(state, { ...input, contractHash: inv.contractHash }, currentContractHash(), new Date().toISOString());
    const member = applied.member;
    if (inv.quotaReqPerDay > 0) member.quota.reqPerDay = inv.quotaReqPerDay;
    const r = await approveWithKey(applied.state, member.id, storeBridge, new Date().toISOString());
    state = markInviteUsed(r.state, { jti: inv.jti, memberId: member.id, redeemedAt: new Date().toISOString(), expiresAt: inv.expiresAt });
    setState(state);
    // raw key returned directly to the device (below) — NOT via pendingRawKeys/status
    // poll, so there is exactly one delivery path for the invite flow.
    audit("apply", member.id, "invite");
    audit("approve", member.id, "invite", r.keyId);
    return { memberId: member.id, keyId: r.keyId, tenantId: r.tenantId, rawKey: r.rawKey };
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
// vK18 A: skip the disk write when the projection is unchanged. A heartbeat with
// the same url/models/freshness produces byte-identical output, so writing on every
// beat (N members × 1/60s) is wasted I/O. A fresh→stale transition changes the
// projection and still flushes. Returns true when it actually wrote.
let lastFleetContent: string | null = null;
export function syncFleetFile(): boolean {
  let existing: unknown = [];
  try { existing = JSON.parse(readFileSync(FLEET_PATH, "utf8")); } catch { /* fresh file */ }
  const merged = mergeFleetBackends(existing, toFleetBackends(getState(), Date.now()));
  const content = JSON.stringify(merged, null, 2) + "\n";
  if (content === lastFleetContent) return false; // unchanged → no disk write
  mkdirSync(dirname(FLEET_PATH), { recursive: true });
  const tmp = `${FLEET_PATH}.contract-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, FLEET_PATH);
  lastFleetContent = content;
  return true;
}

/** Test hook: reset the dirty-check cache (fresh CONTRACT/FLEET path per test run). */
export function _resetFleetCacheForTests(): void { lastFleetContent = null; }

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

/** vK16 G-A: aggregate, secret-free pool status for observability (/api/pool/status,
 * /api/health). Counts + shard-head only — no email/keyId ever. */
export function poolStatusReport(): {
  version: string;
  members: { pending: number; active: number; suspended: number; rejected: number; revoked: number };
  fleetContractNodes: number;
  shardHead: { up: boolean; source?: string };
  ts: string;
} {
  const members = { pending: 0, active: 0, suspended: 0, rejected: 0, revoked: 0 };
  for (const m of getState().members) {
    const k = m.status as keyof typeof members;
    if (k in members) members[k]++;
  }
  let fleetContractNodes = 0;
  try {
    const b = JSON.parse(readFileSync(FLEET_PATH, "utf8")) as Array<{ name?: string }>;
    fleetContractNodes = b.filter((x) => String(x?.name || "").startsWith("contract:")).length;
  } catch { /* fresh */ }
  let shardHead: { up: boolean; source?: string } = { up: false };
  try {
    const h = JSON.parse(readFileSync(join(shardDir(), "head.json"), "utf8")) as { up?: boolean; source?: string };
    shardHead = { up: Boolean(h.up), source: h.source };
  } catch { /* no head */ }
  return { version: CONTRACT_VERSION, members, fleetContractNodes, shardHead, ts: new Date().toISOString() };
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
  lastFleetContent = null;
}

// --- Express wiring ---

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

export function registerContractRoutes(app: Express, adminGuard: Middleware, rateLimit: Middleware, requireAuth: Middleware): void {
  // vK16 G-A: eager state load surfaces any corrupt-state warning at BOOT (not
  // mid-request), and a boot log makes the lane discoverable in the server output.
  const loaded = loadState(STATE_PATH);
  if (loaded.warning) console.warn(`[contract] ${loaded.warning}`);
  state = loaded.state;
  console.log(`[contract] lane active — ${state.members.length} member(s), v${CONTRACT_VERSION} (routes: /api/contract/*, /api/pool/*)`);

  // vK16 G-A: aggregate, secret-free pool status (observability). Public read —
  // counts only, no email/keyId (poolStatusReport is masked by construction).
  app.get("/api/pool/status", (_req, res) => res.json(poolStatusReport()));

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
          { provider: "fleet", model: model ? String(model) : undefined, messages, temperature: temperature != null ? Number(temperature) : undefined } as any, // nosemgrep: express-wkhtmltoimage-injection -- fleet-provider LLM generate, no wkhtmltoimage/pdf sink
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

  // vK17: turnkey onboarding — a device presents an operator-signed invite and is
  // auto-activated (no manual approve). The invite IS the operator's consent.
  app.post("/api/contract/apply-with-invite", rateLimit, async (req, res) => {
    try {
      const { invite, email, machinePubkey, specs } = req.body || {};
      const r = await contractApplyWithInvite(String(invite || ""), {
        email: String(email || ""),
        machinePubkey: String(machinePubkey || ""),
        specs: {
          ramGB: Number(specs?.ramGB),
          os: String(specs?.os || ""),
          arch: String(specs?.arch || ""),
          gpu: specs?.gpu ? String(specs.gpu) : undefined,
          ollamaVersion: specs?.ollamaVersion ? String(specs.ollamaVersion) : undefined,
        },
      });
      // raw key delivered ONCE, right here (device consumes immediately — no poll).
      res.status(201).json({ id: r.memberId, status: "active", key: r.rawKey, keyId: r.keyId });
    } catch (e: any) {
      const status = e instanceof InviteError ? e.status : 400;
      res.status(status).json({ error: e.message });
    }
  });

  // vK19 one-click: serve the signed CLI bundle + a self-contained installer. The
  // device reaches these over the mesh (post-join, pre-key) → public, but the
  // install.sh only renders for a VALID invite token (token = authorization).
  // CJS constraint: the prod bundle (esbuild --format=cjs → dist/server.cjs) has no
  // import.meta.url (undefined → crash at boot). In CJS __dirname === <repo>/dist, so
  // repo root is one hop up; in dev (tsx/ESM) this file is <repo>/server/contract.ts,
  // so import.meta.url + ".." also lands on repo root.
  const REPO_ROOT =
    typeof __dirname !== "undefined"
      ? join(__dirname, "..")
      : join(dirname(new URL(import.meta.url).pathname), "..");
  const CLI_BUNDLE = join(REPO_ROOT, "dist", "contract-cli.mjs");
  const CLI_SIG = join(REPO_ROOT, "dist", "contract-cli.sig");

  app.get("/api/contract/cli", (_req, res) => {
    if (!existsSync(CLI_BUNDLE)) return res.status(503).type("text/plain").send("CLI bundle not built — operator: run contract/scripts/build-cli.sh");
    res.type("application/javascript").send(readFileSync(CLI_BUNDLE));
  });
  app.get("/api/contract/cli.sig", (_req, res) => {
    if (!existsSync(CLI_SIG)) return res.status(503).type("text/plain").send("signature not built — operator: run contract/scripts/build-cli.sh");
    res.type("text/plain").send(readFileSync(CLI_SIG, "utf8"));
  });
  app.get("/api/contract/install.sh", (req, res) => {
    const token = String(req.query.t || "");
    const op = loadOrCreateOperatorKey();
    const vr = verifyInvite(token, op.publicKeyHex, Date.now(), currentContractHash(), op.epoch);
    if (!vr.valid || !vr.payload) return res.status(403).type("text/plain").send(`# invalid invite: ${vr.reason || "?"}`);
    const p = vr.payload;
    const script = renderInstaller({
      operatorMeshUrl: p.serverUrl,
      token,
      headscaleUrl: p.headscaleUrl || "",
      authkey: p.authkey || "",
      opPubHex: p.opPubHex || op.publicKeyHex,
    });
    res.type("text/x-shellscript").send(script);
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
