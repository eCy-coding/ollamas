// vF11 — capability gating logic. The cockpit reflects the backend's permission
// grant (telemetry.permissions from /api/health); it does NOT enforce security —
// the boundary is the backend ToolRegistry tier-allowlist. Deny-by-default:
// while permissions are unknown (null), gated surfaces are treated as denied.
//
// NOTE: tenant TIER (plan.allowed_tiers) is not exposed to the frontend yet
// (would need a server.ts change = out of scope). Backlog: expose tier on
// /api/health or /api/session/me, then extend this map to tier gating.

export type Capability = 'fileRead' | 'fileWrite' | 'commandExec' | 'git';
export type Permissions = Record<Capability, boolean>;

export const CAPABILITIES: Capability[] = ['fileRead', 'fileWrite', 'commandExec', 'git'];

// Tab id → capability it requires (null = always available). Conservative: only
// gate where a permissions{} field maps cleanly to the tab's core action.
export const TAB_CAPABILITY: Record<string, Capability | null> = {
  telemetry: null,
  swarm: null,
  saas: null, // admin-token-gated implicitly
  pipeline: null,
  'react-agent': null,
  files: 'fileRead',
  drive: null,
  terminal: 'commandExec',
  keys: null, // host vault — no permissions{} field; leave open
  security: null,
  backup: 'fileWrite',
  automation: 'commandExec', // input injection
  selftest: null,
};

export function capabilityFor(tabId: string): Capability | null {
  return TAB_CAPABILITY[tabId] ?? null;
}

// Deny-by-default: unknown permissions (null/undefined) → false.
export function hasCapability(perms: Permissions | null | undefined, cap: Capability): boolean {
  if (!perms) return false;
  return perms[cap] === true;
}

export function isTabEnabled(tabId: string, perms: Permissions | null | undefined): boolean {
  const cap = capabilityFor(tabId);
  if (cap === null) return true;
  return hasCapability(perms, cap);
}
