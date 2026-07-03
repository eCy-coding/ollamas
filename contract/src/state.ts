// Atomic JSON persistence for the registry: tmp + rename, 0600.
// Corrupt files degrade to empty state WITH a warning — the ledger must never
// crash the server, but silent data loss is not acceptable either.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RegistryState } from "./registry.ts";
import { emptyState } from "./registry.ts";

export function defaultStatePath(): string {
  return join(homedir(), ".ollamas", "contract.json");
}

export function loadState(path: string): { state: RegistryState; warning?: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { state: emptyState() }; // missing file = fresh install
  }
  try {
    const parsed = JSON.parse(raw) as RegistryState;
    if (!parsed || !Array.isArray(parsed.members)) {
      return { state: emptyState(), warning: `corrupt state at ${path}: missing members[] — starting empty` };
    }
    return { state: parsed };
  } catch {
    return { state: emptyState(), warning: `corrupt state at ${path}: invalid JSON — starting empty` };
  }
}

export function saveState(path: string, state: RegistryState): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.contract-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600); // rename preserves tmp mode, but be explicit on overwrite
}
