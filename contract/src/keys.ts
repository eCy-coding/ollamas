// Key bridge: the lane never touches the server key store directly (zero-dep).
// The server injects {createTenant, issueKey, revokeKey} from server/store.
// one-api principle: member ⇄ key indirection — the ledger only holds keyId.
import type { RegistryState } from "./registry.ts";
import { approveMember, getMember, revokeMember } from "./registry.ts";

export type KeyBridge = {
  createTenant: (name: string) => Promise<{ id: string }>;
  issueKey: (tenantId: string, label: string) => Promise<{ id: string; key: string }>;
  revokeKey: (keyId: string) => Promise<void>;
};

export type ApprovalResult = {
  state: RegistryState;
  rawKey: string; // shown to the applicant exactly once — NEVER persisted
  keyId: string;
  tenantId: string;
};

export async function approveWithKey(
  state: RegistryState,
  memberId: string,
  bridge: KeyBridge,
  now: string,
): Promise<ApprovalResult> {
  const m = getMember(state, memberId);
  if (!m) throw new Error(`member not found: ${memberId}`);
  if (m.status !== "pending") throw new Error(`invalid transition: ${memberId} ${m.status} → active`);
  const tenant = await bridge.createTenant(`contract:${m.email}`);
  const issued = await bridge.issueKey(tenant.id, `contract:${memberId}`);
  const next = approveMember(state, memberId, { keyId: issued.id, tenantId: tenant.id }, now);
  return { state: next, rawKey: issued.key, keyId: issued.id, tenantId: tenant.id };
}

export async function revokeWithKey(state: RegistryState, memberId: string, bridge: KeyBridge): Promise<RegistryState> {
  const { state: next, keyId } = revokeMember(state, memberId);
  if (keyId) await bridge.revokeKey(keyId);
  return next;
}
