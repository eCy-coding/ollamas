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
  getMember,
  type RegistryState,
  type Member,
} from "../contract/src/registry.ts";
import { approveWithKey, revokeWithKey, type KeyBridge } from "../contract/src/keys.ts";
import { loadState, saveState, defaultStatePath } from "../contract/src/state.ts";

const STATE_PATH = process.env.CONTRACT_STATE_PATH || defaultStatePath();

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

// --- service functions (shared by HTTP routes, contract_admin tool, CLI path) ---

export function contractApply(input: { email: string; machinePubkey: string; specs: Member["specs"]; contractHash: string }): Member {
  const { state: next, member } = applyForMembership(getState(), input, currentContractHash(), new Date().toISOString());
  setState(next);
  return member;
}

export async function contractApprove(memberId: string): Promise<{ keyId: string; tenantId: string }> {
  const r = await approveWithKey(getState(), memberId, storeBridge, new Date().toISOString());
  setState(r.state);
  pendingRawKeys.set(memberId, r.rawKey); // picked up once via status poll
  return { keyId: r.keyId, tenantId: r.tenantId };
}

export function contractReject(memberId: string): void {
  setState(rejectMember(getState(), memberId, new Date().toISOString()));
}

export async function contractRevoke(memberId: string): Promise<void> {
  pendingRawKeys.delete(memberId);
  setState(await revokeWithKey(getState(), memberId, storeBridge));
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

export function contractList(): Array<ReturnType<typeof maskMember> & { email: string; keyId?: string }> {
  return getState().members.map((m) => ({ ...maskMember(m), email: m.email, keyId: m.keyId }));
}

/** Test hook: drop the memory cache so a fresh CONTRACT_STATE_PATH is honored. */
export function _resetContractStateForTests(): void {
  state = null;
  pendingRawKeys.clear();
}

// --- Express wiring ---

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

export function registerContractRoutes(app: Express, adminGuard: Middleware, rateLimit: Middleware): void {
  app.get("/api/contract/document", (_req, res) => {
    res.json({ version: CONTRACT_VERSION, hash: currentContractHash(), text: renderContract() });
  });

  app.post("/api/contract/apply", rateLimit, (req, res) => {
    try {
      const { email, machinePubkey, specs, contractHash } = req.body || {};
      const member = contractApply({
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

  app.post("/api/contract/:id/reject", adminGuard, (req, res) => {
    try {
      contractReject(String(req.params.id));
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
}
