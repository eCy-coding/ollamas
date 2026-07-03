// PURE membership state machine. No IO — persistence lives in state.ts,
// key issuance lives behind the keys.ts bridge. Every function returns a new
// state; input state is never mutated.
import { randomBytes } from "node:crypto";

export type MemberStatus = "pending" | "active" | "rejected" | "revoked" | "suspended";

export type Specs = {
  ramGB: number;
  os: string;
  arch: string;
  gpu?: string;
  ollamaVersion?: string;
};

export type Quota = { reqPerDay: number; usedToday: number; dayUtc: string };

export type Member = {
  id: string;
  email: string;
  machinePubkey: string;
  specs: Specs;
  contractHash: string;
  status: MemberStatus;
  keyId?: string;
  tenantId?: string;
  quota: Quota;
  capabilities?: { models: string[]; ollamaUrl?: string; rpcPort?: number; load?: number };
  appliedAt: string;
  approvedAt?: string;
  lastHeartbeat?: string;
};

export type RegistryState = { members: Member[] };

export type ApplyInput = {
  email: string;
  machinePubkey: string;
  specs: Specs;
  contractHash: string;
};

export const DEFAULT_REQ_PER_DAY = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyState(): RegistryState {
  return { members: [] };
}

export function getMember(state: RegistryState, id: string): Member | undefined {
  return state.members.find((m) => m.id === id);
}

export function listByStatus(state: RegistryState, status: MemberStatus): Member[] {
  return state.members.filter((m) => m.status === status);
}

function mustFind(state: RegistryState, id: string): Member {
  const m = getMember(state, id);
  if (!m) throw new Error(`member not found: ${id}`);
  return m;
}

function replace(state: RegistryState, next: Member): RegistryState {
  return { members: state.members.map((m) => (m.id === next.id ? next : m)) };
}

function assertTransition(m: Member, from: MemberStatus[], to: MemberStatus): void {
  if (!from.includes(m.status)) {
    throw new Error(`invalid transition: ${m.id} ${m.status} → ${to}`);
  }
}

export function applyForMembership(
  state: RegistryState,
  input: ApplyInput,
  expectedContractHash: string,
  now: string,
): { state: RegistryState; member: Member } {
  if (!EMAIL_RE.test(input.email)) throw new Error(`invalid email: ${input.email}`);
  if (!Number.isFinite(input.specs.ramGB) || input.specs.ramGB <= 0) {
    throw new Error(`invalid specs: ramGB must be > 0`);
  }
  if (!input.specs.os || !input.specs.arch) throw new Error("invalid specs: os/arch required");
  if (!/^[0-9a-f]{16,}$/i.test(input.machinePubkey)) throw new Error("invalid machine pubkey (hex expected)");
  if (input.contractHash !== expectedContractHash) {
    throw new Error("contract hash mismatch — fetch the current contract document and re-accept");
  }
  const clash = state.members.find(
    (m) => m.machinePubkey === input.machinePubkey && (m.status === "pending" || m.status === "active" || m.status === "suspended"),
  );
  if (clash) throw new Error(`machine pubkey already registered as ${clash.status} (${clash.id})`);

  const member: Member = {
    id: `m_${randomBytes(8).toString("hex")}`,
    email: input.email,
    machinePubkey: input.machinePubkey,
    specs: { ...input.specs },
    contractHash: input.contractHash,
    status: "pending",
    quota: { reqPerDay: DEFAULT_REQ_PER_DAY, usedToday: 0, dayUtc: now.slice(0, 10) },
    appliedAt: now,
  };
  return { state: { members: [...state.members, member] }, member };
}

export function approveMember(
  state: RegistryState,
  id: string,
  grant: { keyId: string; tenantId: string },
  now: string,
): RegistryState {
  const m = mustFind(state, id);
  assertTransition(m, ["pending"], "active");
  return replace(state, { ...m, status: "active", keyId: grant.keyId, tenantId: grant.tenantId, approvedAt: now });
}

export function rejectMember(state: RegistryState, id: string, _now: string): RegistryState {
  const m = mustFind(state, id);
  assertTransition(m, ["pending"], "rejected");
  return replace(state, { ...m, status: "rejected" });
}

export function suspendMember(state: RegistryState, id: string): RegistryState {
  const m = mustFind(state, id);
  assertTransition(m, ["active"], "suspended");
  return replace(state, { ...m, status: "suspended" });
}

/** vK13: reverse of suspend. Key/tenant survive — the node re-enters the pool
 * on its next heartbeat (projection only includes fresh nodes). */
export function resumeMember(state: RegistryState, id: string): RegistryState {
  const m = mustFind(state, id);
  assertTransition(m, ["suspended"], "active");
  return replace(state, { ...m, status: "active" });
}

/** vK13: swap an active member's API key reference (rotation). tenantId is
 * unchanged; the caller issues the new key and revokes the old in the store. */
export function rotateMemberKey(state: RegistryState, id: string, newKeyId: string): RegistryState {
  const m = mustFind(state, id);
  if (m.status !== "active") throw new Error(`key rotation requires active membership (is: ${m.status})`);
  return replace(state, { ...m, keyId: newKeyId });
}

/** Returns the keyId so the caller can revoke it in the server key store. */
export function revokeMember(state: RegistryState, id: string): { state: RegistryState; keyId?: string } {
  const m = mustFind(state, id);
  assertTransition(m, ["active", "suspended"], "revoked");
  return { state: replace(state, { ...m, status: "revoked" }), keyId: m.keyId };
}
