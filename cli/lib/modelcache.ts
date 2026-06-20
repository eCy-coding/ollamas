// Local model-name cache (v13) so shell completion can offer `-m <TAB>` values
// WITHOUT a network call on every TAB (N-019). doctor/bench — which already query the
// gateway — write it; the hidden __complete handler reads it. TTL-stamped per
// provider; absent / expired / corrupt → empty (completion still works, just without
// model values). Zero-dep, non-secret (model names only), 0600.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function ollamasDir(): string {
  const dir = join(homedir(), ".ollamas");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function modelCachePath(): string {
  return join(ollamasDir(), "models.json");
}

export interface ModelCache {
  ts: number; // epoch ms of the last write
  byProvider: Record<string, string[]>;
}

// --- pure ---

export function parseModelCache(json: string): ModelCache | null {
  try {
    const o = JSON.parse(json);
    if (o && typeof o.ts === "number" && o.byProvider && typeof o.byProvider === "object") {
      return { ts: o.ts, byProvider: o.byProvider };
    }
  } catch {
    /* corrupt JSON */
  }
  return null;
}

// Fresh models for a provider, or [] when the cache is missing / stale / lacks it.
export function selectModels(cache: ModelCache | null, provider: string, now: number, maxAgeMs: number): string[] {
  if (!cache || now - cache.ts > maxAgeMs) return [];
  const m = cache.byProvider[provider];
  return Array.isArray(m) ? m : [];
}

// Merge one provider's list into a (possibly null) cache, restamping ts.
export function mergeModelCache(cur: ModelCache | null, provider: string, models: string[], now: number): ModelCache {
  const byProvider = { ...(cur?.byProvider ?? {}) };
  byProvider[provider] = models;
  return { ts: now, byProvider };
}

// --- I/O (best-effort; never throws into the caller) ---

export function readModelCache(): ModelCache | null {
  try {
    return parseModelCache(readFileSync(modelCachePath(), "utf8"));
  } catch {
    return null;
  }
}

export function writeModelCache(provider: string, models: string[], now: number = Date.now()): void {
  try {
    const next = mergeModelCache(readModelCache(), provider, models, now);
    writeFileSync(modelCachePath(), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* cache is best-effort — a write failure must not break doctor/bench */
  }
}

// Convenience for __complete: fresh models for a provider (10 min default).
export function cachedModels(provider: string, maxAgeMs = 600_000, now: number = Date.now()): string[] {
  return selectModels(readModelCache(), provider, now, maxAgeMs);
}
