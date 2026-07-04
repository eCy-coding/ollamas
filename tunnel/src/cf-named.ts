// vT15: named-tunnel config state, encrypted at rest. The token (remotely-managed mode) is a
// long-lived secret → sealed via keystore AES-256-GCM (RISK-TUNNEL-028), never plaintext on disk,
// never logged. Graceful-null read (keystore N-013). describeNamed() is the secret-free surface.

import { loadOrCreateKeyfile, sealToFile, openFromFile } from "./keystore.ts";

export interface NamedConfig {
  mode: "token" | "cli";
  hostname: string; // stable public URL host, e.g. ollamas.example.dev
  token?: string; // remotely-managed secret (mode "token") — encrypted at rest
  tunnelId?: string; // locally-managed (mode "cli")
  credFile?: string; // locally-managed credentials json path
}

/** Persist config to an encrypted vault (token sealed). Reuses the shared auto-keyfile. */
export function writeNamed(vaultPath: string, keyfilePath: string, cfg: NamedConfig): void {
  const key = loadOrCreateKeyfile(keyfilePath);
  sealToFile(vaultPath, cfg, key);
}

/** Read config → object, or null on missing/corrupt (graceful, never throws). */
export function readNamed(vaultPath: string, keyfilePath: string): NamedConfig | null {
  const key = loadOrCreateKeyfile(keyfilePath);
  return openFromFile<NamedConfig>(vaultPath, key);
}

/** PURE secret-free description for status/logs — hostname + mode, NEVER the token. */
export function describeNamed(cfg: NamedConfig): string {
  const detail = cfg.mode === "cli" && cfg.tunnelId ? ` (id ${cfg.tunnelId.slice(0, 8)}…)` : "";
  return `named: https://${cfg.hostname}  ·  mode=${cfg.mode}${detail}`;
}
