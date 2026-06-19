// CLI config: ~/.ollamas/cli.json + env overrides.
// v7: secrets (apiKey, saasAdminToken) are SEALED at rest (AES-256-GCM via
// lib/secrets + lib/keystore) — stored as `apiKeyEnc`/`saasAdminTokenEnc`, never
// plaintext. Decryption happens on load so every consumer still reads the
// plaintext `cfg.apiKey` in memory (GatewayClient callers are untouched). A
// pre-v7 plaintext file is migrated one-way on first load (backup kept).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

function readDisk(): DiskConfig {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"));
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

// Decrypted file values WITHOUT env override — the persistence baseline so an
// env-supplied secret (OLLAMAS_API_KEY) is never written back to disk.
function loadDiskPlain(env: NodeJS.ProcessEnv = process.env): Partial<CliConfig> {
  return unsealOrWarn(readDisk(), env).fileData;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const disk = readDisk();
  const { fileData, legacy } = unsealOrWarn(disk, env);
  if (legacy) migrateLegacy(disk, fileData, env);
  return resolveConfig(fileData, env);
}

// One-way migration of a pre-v7 plaintext file → sealed at rest. Backs up the
// original first (0600) so a later keyfile loss is still recoverable, then
// rewrites without plaintext. Non-fatal: config keeps working in-memory if the
// rewrite fails.
function migrateLegacy(disk: DiskConfig, fileData: Partial<CliConfig>, env: NodeJS.ProcessEnv): void {
  try {
    const bak = `${configPath()}.bak.${Date.now()}`;
    writeFileSync(bak, JSON.stringify(disk, null, 2), { mode: 0o600 });
    const needKey = !!(fileData.apiKey || fileData.saasAdminToken);
    const sealed = sealDisk(fileData, needKey ? loadMasterKey(env) : null);
    writeFileSync(configPath(), JSON.stringify(sealed, null, 2), { mode: 0o600 });
    process.stderr.write(`ollamas: migrated plaintext secrets → encrypted at rest (backup: ${bak})\n`);
  } catch {
    /* migration best-effort; plaintext stays but config still works */
  }
}

export function saveConfig(patch: Partial<CliConfig>): CliConfig {
  // Persist file-state + patch only — NOT env-supplied secrets.
  const fileData = loadDiskPlain();
  const next: Partial<CliConfig> = { ...DEFAULTS, ...fileData, ...patch };
  const needKey = !!(next.apiKey || next.saasAdminToken);
  const dir = join(homedir(), ".ollamas");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(sealDisk(next, needKey ? loadMasterKey() : null), null, 2), { mode: 0o600 });
  return loadConfig();
}
