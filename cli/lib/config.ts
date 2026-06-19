// CLI config: ~/.ollamas/cli.json + env overrides.
// v7: secrets (apiKey, saasAdminToken) are SEALED at rest (AES-256-GCM via
// lib/secrets + lib/keystore) — stored as `apiKeyEnc`/`saasAdminTokenEnc`, never
// plaintext. Decryption happens on load so every consumer still reads the
// plaintext `cfg.apiKey` in memory (GatewayClient callers are untouched). A
// pre-v7 plaintext file is migrated one-way on first load (backup kept).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { seal, open, SecretError } from "./secrets";
import { loadMasterKey } from "./keystore";

export interface CliConfig {
  gateway: string;
  apiKey?: string; // in-memory plaintext (sealed on disk as apiKeyEnc)
  saasAdminToken?: string; // X-Admin-Token; sealed on disk as saasAdminTokenEnc
  mcpGuardAllow?: string; // CSV glob whitelist for `mcp tools|call` (v5)
  mcpGuardDeny?: string; // CSV glob blacklist for `mcp tools|call` (v5)
  provider: string;
  model: string;
  profile: string;
}

// On-disk shape: secrets sealed under *Enc. Legacy plaintext `apiKey`/
// `saasAdminToken` may appear in a pre-v7 file (migrated away on first load).
interface DiskConfig {
  gateway?: string;
  apiKeyEnc?: string;
  saasAdminTokenEnc?: string;
  mcpGuardAllow?: string;
  mcpGuardDeny?: string;
  provider?: string;
  model?: string;
  profile?: string;
  activeProfile?: string; // v7 global pointer — only meaningful in cli.json
  apiKey?: string; // legacy plaintext (pre-v7)
  saasAdminToken?: string; // legacy plaintext (pre-v7)
}

const DEFAULTS: CliConfig = {
  gateway: "http://localhost:3000",
  provider: "ollama-local",
  model: "qwen3:8b", // calibrated default (see SEYIR_DEFTERI / project memory)
  profile: "default",
};

export function configPath(): string {
  return join(homedir(), ".ollamas", "cli.json");
}

// --- v7 profiles: default lives in cli.json (back-compat); named profiles in
// ~/.ollamas/profiles/<name>.json. The active-profile pointer is stored in
// cli.json. Active selection precedence: --profile flag > OLLAMAS_PROFILE env >
// activeProfile (cli.json) > "default". The flag is realized by index.ts setting
// OLLAMAS_PROFILE before load (mirrors --gateway), so the config layer reads env.

export function profilesDir(): string {
  return join(homedir(), ".ollamas", "profiles");
}

function sanitizeProfile(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`invalid profile name '${name}' (allowed: letters, digits, . _ -)`);
  }
  return name;
}

export function profilePath(name: string): string {
  return name === "default" ? configPath() : join(profilesDir(), `${sanitizeProfile(name)}.json`);
}

// PURE precedence resolver → unit-testable. flag wins, then env, then the
// persisted active pointer, else "default".
export function resolveProfileName(flag?: string, envVal?: string, globalActive?: string): string {
  return (flag && flag.trim()) || (envVal && envVal.trim()) || (globalActive && globalActive.trim()) || "default";
}

function globalActiveProfile(): string | undefined {
  return readDisk(configPath()).activeProfile;
}

function activeProfileName(env: NodeJS.ProcessEnv): string {
  return resolveProfileName(undefined, env.OLLAMAS_PROFILE, globalActiveProfile());
}

// Env wins over file wins over defaults. Pure given its inputs → unit-testable.
// Operates on PLAINTEXT fileData (secrets already decrypted upstream).
export function resolveConfig(fileData: Partial<CliConfig>, env: NodeJS.ProcessEnv): CliConfig {
  return {
    gateway: env.OLLAMAS_GATEWAY || fileData.gateway || DEFAULTS.gateway,
    apiKey: env.OLLAMAS_API_KEY || fileData.apiKey,
    saasAdminToken: env.OLLAMAS_SAAS_ADMIN || fileData.saasAdminToken,
    mcpGuardAllow: env.OLLAMAS_MCP_ALLOW || fileData.mcpGuardAllow,
    mcpGuardDeny: env.OLLAMAS_MCP_DENY || fileData.mcpGuardDeny,
    provider: env.OLLAMAS_PROVIDER || fileData.provider || DEFAULTS.provider,
    model: env.OLLAMAS_MODEL || fileData.model || DEFAULTS.model,
    profile: env.OLLAMAS_PROFILE || fileData.profile || DEFAULTS.profile,
  };
}

// PURE: decrypt an on-disk config into plaintext fileData. Reports whether legacy
// plaintext secrets were present (caller migrates). `key` is required only when a
// sealed *Enc field exists; pass null otherwise.
export function unsealDisk(disk: DiskConfig, key: Buffer | null): { fileData: Partial<CliConfig>; legacy: boolean } {
  const { apiKey: legacyKey, saasAdminToken: legacyAdmin, apiKeyEnc, saasAdminTokenEnc, ...rest } = disk;
  const legacy = !!(legacyKey || legacyAdmin);
  let apiKey = legacyKey;
  let saasAdminToken = legacyAdmin;
  if (apiKeyEnc) {
    if (!key) throw new Error("master key required to decrypt apiKey");
    apiKey = open(apiKeyEnc, key);
  }
  if (saasAdminTokenEnc) {
    if (!key) throw new Error("master key required to decrypt saasAdminToken");
    saasAdminToken = open(saasAdminTokenEnc, key);
  }
  return { fileData: { ...rest, apiKey, saasAdminToken }, legacy };
}

// PURE: seal plaintext fileData into the on-disk shape. `key` required only when a
// secret is present. Plaintext secrets never survive into the returned object.
export function sealDisk(fileData: Partial<CliConfig>, key: Buffer | null): DiskConfig {
  const { apiKey, saasAdminToken, ...rest } = fileData;
  const disk: DiskConfig = { ...rest };
  if (apiKey) {
    if (!key) throw new Error("master key required to seal apiKey");
    disk.apiKeyEnc = seal(apiKey, key);
  }
  if (saasAdminToken) {
    if (!key) throw new Error("master key required to seal saasAdminToken");
    disk.saasAdminTokenEnc = seal(saasAdminToken, key);
  }
  return disk;
}

function readDisk(path: string = configPath()): DiskConfig {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {}; // no file yet — defaults + env
  }
}

// I/O boundary around the pure unsealDisk: resolves the master key and, on a
// decryption failure (wrong key / lost keyfile / corrupted blob), DEGRADES
// gracefully — warns once with recovery steps and drops the unreadable secret
// rather than crashing every command with a stack trace. The secret being
// absent surfaces later as the existing 401 hint, never a silent empty key.
function unsealOrWarn(disk: DiskConfig, env: NodeJS.ProcessEnv): { fileData: Partial<CliConfig>; legacy: boolean } {
  const needKey = !!(disk.apiKeyEnc || disk.saasAdminTokenEnc);
  try {
    return unsealDisk(disk, needKey ? loadMasterKey(env) : null);
  } catch (e) {
    const why = e instanceof SecretError ? e.message : String((e as Error)?.message || e);
    process.stderr.write(
      `ollamas: cannot decrypt a stored secret (${why}). Ignoring it — set OLLAMAS_API_KEY, ` +
        `run 'ollamas config apiKey <key>' to reset, or restore a cli.json.bak.* backup.\n`,
    );
    const { apiKeyEnc, saasAdminTokenEnc, apiKey, saasAdminToken, ...rest } = disk;
    void apiKeyEnc; void saasAdminTokenEnc; void apiKey; void saasAdminToken;
    return { fileData: { ...rest }, legacy: false };
  }
}

// Decrypted active-profile file values WITHOUT env override — the persistence
// baseline so an env-supplied secret (OLLAMAS_API_KEY) is never written to disk.
function loadDiskPlain(env: NodeJS.ProcessEnv = process.env): Partial<CliConfig> {
  return unsealOrWarn(readDisk(profilePath(activeProfileName(env))), env).fileData;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const path = profilePath(activeProfileName(env));
  const disk = readDisk(path);
  const { fileData, legacy } = unsealOrWarn(disk, env);
  if (legacy) migrateLegacy(path, disk, fileData, env);
  return resolveConfig(fileData, env);
}

// One-way migration of a pre-v7 plaintext file → sealed at rest. Backs up the
// original first (0600) so a later keyfile loss is still recoverable, then
// rewrites without plaintext. Non-fatal: config keeps working in-memory if the
// rewrite fails.
function migrateLegacy(path: string, disk: DiskConfig, fileData: Partial<CliConfig>, env: NodeJS.ProcessEnv): void {
  try {
    const bak = `${path}.bak.${Date.now()}`;
    writeFileSync(bak, JSON.stringify(disk, null, 2), { mode: 0o600 });
    const needKey = !!(fileData.apiKey || fileData.saasAdminToken);
    const sealed = sealDisk(fileData, needKey ? loadMasterKey(env) : null);
    if (disk.activeProfile) sealed.activeProfile = disk.activeProfile; // preserve pointer
    writeFileSync(path, JSON.stringify(sealed, null, 2), { mode: 0o600 });
    process.stderr.write(`ollamas: migrated plaintext secrets → encrypted at rest (backup: ${bak})\n`);
  } catch {
    /* migration best-effort; plaintext stays but config still works */
  }
}

export function saveConfig(patch: Partial<CliConfig>, env: NodeJS.ProcessEnv = process.env): CliConfig {
  // Write the ACTIVE profile's file. Persist file-state + patch only — never
  // env-supplied secrets. Preserve the global activeProfile pointer in cli.json.
  const path = profilePath(activeProfileName(env));
  const fileData = unsealOrWarn(readDisk(path), env).fileData;
  const next: Partial<CliConfig> = { ...DEFAULTS, ...fileData, ...patch };
  const needKey = !!(next.apiKey || next.saasAdminToken);
  const disk = sealDisk(next, needKey ? loadMasterKey() : null);
  const prevPointer = readDisk(path).activeProfile;
  if (prevPointer) disk.activeProfile = prevPointer;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(disk, null, 2), { mode: 0o600 });
  return loadConfig(env);
}

// Point the global activeProfile at <name>, creating an empty profile file if it
// doesn't exist yet. Pointer lives in cli.json regardless of the active profile.
export function setActiveProfile(name: string): void {
  const target = name === "default" ? "default" : sanitizeProfile(name);
  if (target !== "default") {
    const p = profilePath(target);
    if (!existsSync(p)) {
      mkdirSync(profilesDir(), { recursive: true, mode: 0o700 });
      writeFileSync(p, JSON.stringify({}, null, 2), { mode: 0o600 });
    }
  }
  const global = readDisk(configPath());
  global.activeProfile = target;
  mkdirSync(join(homedir(), ".ollamas"), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(global, null, 2), { mode: 0o600 });
}

export interface ProfileSummary {
  name: string;
  active: boolean;
  gateway: string;
  hasKey: boolean;
}

// Enumerate default + every ~/.ollamas/profiles/*.json with light metadata
// (no decryption — only presence of a sealed/legacy secret).
export function listProfiles(env: NodeJS.ProcessEnv = process.env): ProfileSummary[] {
  const active = activeProfileName(env);
  const names = new Set<string>(["default"]);
  try {
    for (const f of readdirSync(profilesDir())) if (f.endsWith(".json")) names.add(f.slice(0, -5));
  } catch {
    /* no profiles dir yet */
  }
  return [...names].sort().map((name) => {
    const disk = readDisk(profilePath(name));
    return {
      name,
      active: name === active,
      gateway: disk.gateway || DEFAULTS.gateway,
      hasKey: !!(disk.apiKeyEnc || disk.apiKey),
    };
  });
}
