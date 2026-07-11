// O8 settings module — wire types + input validation (honest 400 before any
// work). Mirrors server/modules/notes-tasks/schema.ts / cookbook/schema.ts.
// Covers docs/odyssey/handoff/settings-2fa/design.html's 5 sections: general |
// security (2FA + sessions) | roles | tools | vault. Vault itself is out of
// scope here (README: existing KeyVault already owns secrets-at-rest — this
// module's "vault" section is display-only, reusing that surface, not a new
// store) — schema below covers the 4 sections this module actually persists.

// ── General prefs ────────────────────────────────────────────────────────────

export const THEME_OPTIONS = ["dark", "light", "system"] as const;
export type ThemeOption = (typeof THEME_OPTIONS)[number];

export const DENSITY_OPTIONS = ["comfortable", "compact"] as const;
export type DensityOption = (typeof DENSITY_OPTIONS)[number];

export interface GeneralPrefs {
  theme: ThemeOption;
  density: DensityOption;
  language: string;
  reduceMotion: boolean;
}

export function sanitizeTheme(raw: unknown): ThemeOption {
  if (typeof raw !== "string" || !(THEME_OPTIONS as readonly string[]).includes(raw)) {
    throw new Error(`invalid theme (allowed: ${THEME_OPTIONS.join(", ")})`);
  }
  return raw as ThemeOption;
}

export function sanitizeDensity(raw: unknown): DensityOption {
  if (typeof raw !== "string" || !(DENSITY_OPTIONS as readonly string[]).includes(raw)) {
    throw new Error(`invalid density (allowed: ${DENSITY_OPTIONS.join(", ")})`);
  }
  return raw as DensityOption;
}

/** Validate a partial PUT /general patch — every field optional, well-typed if present. */
export function parseGeneralPatch(body: unknown): Partial<GeneralPrefs> {
  const b = (body ?? {}) as Partial<Record<keyof GeneralPrefs, unknown>>;
  const out: Partial<GeneralPrefs> = {};
  if (b.theme !== undefined) out.theme = sanitizeTheme(b.theme);
  if (b.density !== undefined) out.density = sanitizeDensity(b.density);
  if (b.language !== undefined) {
    if (typeof b.language !== "string" || b.language.trim() === "") {
      throw new Error("field 'language' must be a non-empty string");
    }
    out.language = b.language.trim();
  }
  if (b.reduceMotion !== undefined) {
    if (typeof b.reduceMotion !== "boolean") throw new Error("field 'reduceMotion' must be a boolean");
    out.reduceMotion = b.reduceMotion;
  }
  return out;
}

// ── 2FA / TOTP ────────────────────────────────────────────────────────────────

export interface TwoFaStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface EnrollResponse {
  secret: string;
  otpauthUrl: string;
}

export interface ActivateResponse {
  enabled: true;
  backupCodes: string[];
}

/** Validate a { token: "123456" } body — 6-8 digit numeric string. */
export function parseTotpToken(body: unknown): string {
  const token = (body as { token?: unknown })?.token;
  if (typeof token !== "string" || !/^\d{6,8}$/.test(token)) {
    throw new Error("field 'token' must be a 6-8 digit numeric string");
  }
  return token;
}

/** Validate a disable/backup-code body — either a TOTP token or a backup code. */
export function parseTotpCredential(body: unknown): { token?: string; backupCode?: string } {
  const b = (body ?? {}) as { token?: unknown; backupCode?: unknown };
  if (b.token === undefined && b.backupCode === undefined) {
    throw new Error("must provide either 'token' or 'backupCode'");
  }
  const out: { token?: string; backupCode?: string } = {};
  if (b.token !== undefined) out.token = parseTotpToken({ token: b.token });
  if (b.backupCode !== undefined) {
    if (typeof b.backupCode !== "string" || b.backupCode.trim() === "") {
      throw new Error("field 'backupCode' must be a non-empty string");
    }
    out.backupCode = b.backupCode.trim();
  }
  return out;
}

// ── RBAC roles ────────────────────────────────────────────────────────────────

export const ROLE_NAMES = ["owner", "admin", "operator", "viewer", "agent"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const CAPABILITIES = ["models", "tools", "vault", "users", "daemon"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PERM_LEVELS = ["allow", "scoped", "deny"] as const;
export type PermLevel = (typeof PERM_LEVELS)[number];

export type PermMatrix = Record<Capability, PermLevel>;

export interface RoleRecord {
  name: RoleName;
  locked: boolean; // owner is immutable (design.html chipImmutable)
  kind: string; // display label, e.g. "Full access" | "Service account"
  perms: PermMatrix;
}

export function sanitizePermLevel(raw: unknown): PermLevel {
  if (typeof raw !== "string" || !(PERM_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`invalid perm level (allowed: ${PERM_LEVELS.join(", ")})`);
  }
  return raw as PermLevel;
}

export function sanitizeRoleName(raw: unknown): RoleName {
  if (typeof raw !== "string" || !(ROLE_NAMES as readonly string[]).includes(raw)) {
    throw new Error(`invalid role (allowed: ${ROLE_NAMES.join(", ")})`);
  }
  return raw as RoleName;
}

/** Validate a PUT /roles/:name patch — partial perm matrix, every cap optional. */
export function parseRolePermsPatch(body: unknown): Partial<PermMatrix> {
  const b = (body ?? {}) as Partial<Record<Capability, unknown>>;
  const out: Partial<PermMatrix> = {};
  for (const cap of CAPABILITIES) {
    if (b[cap] !== undefined) out[cap] = sanitizePermLevel(b[cap]);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`patch must set at least one of: ${CAPABILITIES.join(", ")}`);
  }
  return out;
}

// ── Tool policy ───────────────────────────────────────────────────────────────

export const TOOL_IDS = ["net", "fsr", "fsw", "sh", "py", "mcp", "clip", "mem"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_POLICY_LEVELS = ["allow", "ask", "deny"] as const;
export type ToolPolicyLevel = (typeof TOOL_POLICY_LEVELS)[number];

export interface ToolPolicyRecord {
  tool: ToolId;
  policy: ToolPolicyLevel;
  scope: string;
  /** Best-effort reference to the live server/tool-registry.ts tier for the
   *  nearest matching real tool (read-only display context — see service.ts
   *  TOOL_TIER_REFERENCE; this module never rewires the tool-registry choke
   *  point, CRITICAL constraint). Undefined when no representative tool exists. */
  tierRef?: string;
}

export function sanitizeToolId(raw: unknown): ToolId {
  if (typeof raw !== "string" || !(TOOL_IDS as readonly string[]).includes(raw)) {
    throw new Error(`invalid tool id (allowed: ${TOOL_IDS.join(", ")})`);
  }
  return raw as ToolId;
}

export function sanitizeToolPolicyLevel(raw: unknown): ToolPolicyLevel {
  if (typeof raw !== "string" || !(TOOL_POLICY_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`invalid policy (allowed: ${TOOL_POLICY_LEVELS.join(", ")})`);
  }
  return raw as ToolPolicyLevel;
}

/** Validate a PUT /tools/policy/:tool patch. */
export function parseToolPolicyPatch(body: unknown): { policy?: ToolPolicyLevel; scope?: string } {
  const b = (body ?? {}) as { policy?: unknown; scope?: unknown };
  const out: { policy?: ToolPolicyLevel; scope?: string } = {};
  if (b.policy !== undefined) out.policy = sanitizeToolPolicyLevel(b.policy);
  if (b.scope !== undefined) {
    if (typeof b.scope !== "string") throw new Error("field 'scope' must be a string");
    out.scope = b.scope;
  }
  if (out.policy === undefined && out.scope === undefined) {
    throw new Error("patch must set 'policy' and/or 'scope'");
  }
  return out;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  client: string;
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

// ── Sandbox toggle (tools section "Execution sandbox" switch) ────────────────

export interface SandboxState {
  enforced: boolean;
}
