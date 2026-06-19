// Plugin registry — external subcommands, checksum-gated (v10). We adopt the git
// `git-foo` model but NOT its blind exec: a plugin runs only if it's registered
// in ~/.ollamas/plugins.json {name, path, sha256} AND its file still hashes to the
// recorded sha256 (tamper/replace → refuse). `plugin install` is the explicit
// trust gate (trust-on-first-use). This is the safe variant of gh-extension/krew.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "./manifest";

export interface PluginEntry {
  name: string;
  path: string; // absolute path to the executable
  sha256: string;
  installed?: string; // ISO date
}

export function pluginsPath(): string {
  return join(homedir(), ".ollamas", "plugins.json");
}
export function pluginsDir(): string {
  return join(homedir(), ".ollamas", "plugins");
}

// PURE: parse a registry document → entries. Tolerant of an absent/garbage file
// (→ []) and drops malformed entries (an unreadable registry must not crash the
// CLI — it just means "no plugins").
export function parsePluginRegistry(json: string): PluginEntry[] {
  if (!json || !json.trim()) return [];
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.plugins) ? raw.plugins : [];
  return list.filter(
    (e: any) => e && typeof e.name === "string" && typeof e.path === "string" && typeof e.sha256 === "string",
  ).map((e: any) => ({ name: e.name, path: e.path, sha256: String(e.sha256).toLowerCase(), installed: e.installed }));
}

export function findPlugin(entries: PluginEntry[], name: string): PluginEntry | undefined {
  return entries.find((e) => e.name === name);
}

// PURE: a plugin name must be a safe single segment — no path separators or
// traversal (the file lives under ~/.ollamas/plugins/ only).
export function isValidPluginName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

// --- I/O shell ---

export function loadRegistry(): PluginEntry[] {
  try {
    return parsePluginRegistry(readFileSync(pluginsPath(), "utf8"));
  } catch {
    return [];
  }
}

export function saveRegistry(entries: PluginEntry[]): void {
  mkdirSync(join(homedir(), ".ollamas"), { recursive: true, mode: 0o700 });
  writeFileSync(pluginsPath(), JSON.stringify({ plugins: entries }, null, 2), { mode: 0o600 });
}

// Verify the on-disk plugin file still matches its recorded sha256. A missing or
// tampered file → false (caller refuses to exec).
export function verifyPluginFile(path: string, expectedSha: string): boolean {
  try {
    if (!existsSync(path)) return false;
    return sha256Hex(readFileSync(path)) === expectedSha.toLowerCase();
  } catch {
    return false;
  }
}
