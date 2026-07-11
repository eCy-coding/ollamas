// O8 settings module service — thin business layer over ./store (which is the
// only file touching persistence) + ./totp (pure RFC 6238 crypto). Mirrors
// server/modules/notes-tasks/service.ts's honest style: callers (router)
// validate input via ./schema before reaching here; this layer owns the TOTP
// replay guard (stateful — the pure totp.verifyTotp() is not) and the
// role/tool-policy CRUD rules (owner role immutable).
import { ToolRegistry } from "../../tool-registry";
import * as store from "./store";
import { generateBackupCodes, generateTotpSecret, hashBackupCode, otpauthUrl, verifyTotp } from "./totp";
import type {
  EnrollResponse,
  GeneralPrefs,
  PermMatrix,
  RoleName,
  RoleRecord,
  SessionRecord,
  ToolId,
  ToolPolicyLevel,
  ToolPolicyRecord,
  TwoFaStatus,
} from "./schema";

const ISSUER = "ollamas";
const ACCOUNT = "local-owner";

// ── 2FA / TOTP ────────────────────────────────────────────────────────────────

export async function get2faStatus(): Promise<TwoFaStatus> {
  const row = await store.readTotp();
  const backupCodesRemaining = row.enabled ? await store.countUnusedBackupCodes() : 0;
  return { enabled: row.enabled, backupCodesRemaining };
}

export async function enroll2fa(): Promise<EnrollResponse> {
  const secret = generateTotpSecret();
  await store.writePendingSecret(secret);
  return { secret, otpauthUrl: otpauthUrl({ issuer: ISSUER, account: ACCOUNT, secret }) };
}

export class TotpError extends Error {}

/** Verify `token` against the pending enrollment secret and, on success, flip
 *  totp_enabled=1 + mint 10 backup codes (shown to the caller exactly once —
 *  never re-derivable, never logged in plaintext, docs/odyssey/07-security.md
 *  O8.1 step 3 "Kritik" note). */
export async function activate2fa(
  token: string,
  opts: { now?: number } = {},
): Promise<{ enabled: true; backupCodes: string[] }> {
  const row = await store.readTotp();
  if (!row.pendingSecret) throw new TotpError("no pending enrollment — call /security/2fa/enroll first");
  const counter = verifyTotp(row.pendingSecret, token, { time: opts.now });
  if (counter === null) throw new TotpError("invalid or expired code");
  await store.activateSecret(row.pendingSecret, counter);
  const codes = generateBackupCodes();
  await store.insertBackupCodes(codes.map(hashBackupCode));
  return { enabled: true, backupCodes: codes };
}

/** Step-up verification against the ACTIVE secret, with a stateful replay guard
 *  (the same time-step counter cannot be consumed twice — docs/odyssey/07-security.md
 *  O8.1 RED spec: "replay (aynı token 2×) reddeder"). Falls back to a one-time
 *  backup code if the token doesn't match a TOTP window. */
export async function verify2fa(
  cred: { token?: string; backupCode?: string },
  opts: { now?: number } = {},
): Promise<{ ok: boolean; usedBackupCode?: boolean }> {
  const row = await store.readTotp();
  if (!row.enabled || !row.secret) throw new TotpError("2FA is not enabled");
  if (cred.token) {
    const counter = verifyTotp(row.secret, cred.token, { time: opts.now });
    if (counter !== null && counter > row.lastCounter) {
      await store.setLastCounter(counter);
      return { ok: true };
    }
  }
  if (cred.backupCode) {
    const consumed = await store.consumeBackupCode(hashBackupCode(cred.backupCode));
    if (consumed) return { ok: true, usedBackupCode: true };
  }
  return { ok: false };
}

export async function disable2fa(
  cred: { token?: string; backupCode?: string },
  opts: { now?: number } = {},
): Promise<boolean> {
  const result = await verify2fa(cred, opts);
  if (!result.ok) return false;
  await store.disableTotp();
  return true;
}

export async function regenerateBackupCodes(
  cred: { token?: string; backupCode?: string },
  opts: { now?: number } = {},
): Promise<string[] | null> {
  const row = await store.readTotp();
  if (!row.enabled) return null;
  const result = await verify2fa(cred, opts);
  if (!result.ok) return null;
  const codes = generateBackupCodes();
  await store.insertBackupCodes(codes.map(hashBackupCode));
  return codes;
}

// ── RBAC roles ────────────────────────────────────────────────────────────────

export async function listRoles(): Promise<RoleRecord[]> {
  return store.listRoles();
}

export class RoleError extends Error {}

export async function updateRolePerms(name: RoleName, patch: Partial<PermMatrix>): Promise<RoleRecord> {
  const existing = await store.getRole(name);
  if (!existing) throw new RoleError(`unknown role '${name}'`);
  if (existing.locked) throw new RoleError(`role '${name}' is locked (owner always retains full control)`);
  const updated = await store.updateRolePerms(name, patch);
  if (!updated) throw new RoleError(`unknown role '${name}'`);
  return updated;
}

// ── Tool policy ───────────────────────────────────────────────────────────────

// Best-effort mapping from this module's 8 abstract tool categories (design.html)
// to a representative REAL tool name in server/tool-registry.ts, purely for
// read-only tier display — this module never rewires ToolRegistry.execute()
// (CRITICAL constraint: existing security infra / choke-point is untouched).
const TOOL_TIER_REFERENCE: Record<ToolId, string | undefined> = {
  net: "web_search",
  fsr: "read_file",
  fsw: "write_file",
  sh: "run_command",
  py: undefined,
  mcp: undefined,
  clip: undefined,
  mem: "logbook",
};

export async function listToolPolicy(): Promise<ToolPolicyRecord[]> {
  const rows = await store.listToolPolicy();
  return rows.map((r) => {
    const refName = TOOL_TIER_REFERENCE[r.tool];
    const tierRef = refName ? ToolRegistry.tier(refName) : undefined;
    return { ...r, tierRef };
  });
}

export class ToolPolicyError extends Error {}

export async function updateToolPolicy(
  tool: ToolId,
  patch: { policy?: ToolPolicyLevel; scope?: string },
): Promise<ToolPolicyRecord> {
  const updated = await store.updateToolPolicy(tool, patch);
  if (!updated) throw new ToolPolicyError(`unknown tool '${tool}'`);
  const refName = TOOL_TIER_REFERENCE[tool];
  const tierRef = refName ? ToolRegistry.tier(refName) : undefined;
  return { ...updated, tierRef };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function listSessions(): Promise<SessionRecord[]> {
  return store.listSessions();
}

export async function revokeSession(id: string): Promise<boolean> {
  return store.revokeSession(id);
}

// ── General prefs + sandbox toggle ───────────────────────────────────────────

export async function getGeneralPrefs(): Promise<GeneralPrefs> {
  return store.readPrefs();
}

export async function updateGeneralPrefs(patch: Partial<GeneralPrefs>): Promise<GeneralPrefs> {
  return store.writePrefs(patch);
}

export async function getSandboxEnforced(): Promise<boolean> {
  return store.readSandboxEnforced();
}

export async function setSandboxEnforced(enforced: boolean): Promise<boolean> {
  await store.writeSandboxEnforced(enforced);
  return enforced;
}
