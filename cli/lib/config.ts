// CLI config: ~/.ollamas/cli.json + env overrides.
// v1 stores apiKey in plaintext (file mode 0600). v7 (ROADMAP) replaces this
// with the AES-GCM SecureDB pattern from server/db.ts — env override preferred meanwhile.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  gateway: string;
  apiKey?: string;
  saasAdminToken?: string; // X-Admin-Token for /api/saas/* + /api/billing/* (v3)
  mcpGuardAllow?: string; // CSV glob whitelist for `mcp tools|call` (v5, mcptools guard)
  mcpGuardDeny?: string; // CSV glob blacklist for `mcp tools|call` (v5)
  provider: string;
  model: string;
  profile: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  let fileData: Partial<CliConfig> = {};
  try {
    fileData = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    /* no config file yet — defaults + env */
  }
  return resolveConfig(fileData, env);
}

export function saveConfig(patch: Partial<CliConfig>): CliConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  const dir = join(homedir(), ".ollamas");
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
