// Disk-backed cache (I/O boundary) over the pure key/TTL policy in lib/cache.ts.
//
// WHY THIS EXISTS
// "No caching / memoisation for `search` results or LLM prompts" is the first gap the prompt
// lists. Redis is what it suggests; a single JSON file is what this machine needs — the runs
// are local and single-process, so a second daemon would add operational weight and buy
// nothing. Swapping in Redis later means replacing this file only: the key derivation and
// expiry rules (the parts that decide correctness) already live in lib/cache.ts and are
// tested there.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheKey, isFresh, makeEntry, evictExpired, hitRatio, DEFAULT_TTL_SECONDS, type CacheEntry, type CacheStats } from "../lib/cache";

export class CacheStore {
  private map = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0 };
  private dirty = false;

  constructor(readonly file = join(process.env.HOME ?? ".", ".ollamas", "pipeline-cache.json")) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, CacheEntry<unknown>>;
      this.map = evictExpired(new Map(Object.entries(raw)), Date.now());
    } catch {
      this.map = new Map(); // absent or corrupt cache is a cold start, never a crash
    }
  }

  get<T>(action: string, payload: unknown): { hit: boolean; key: string; value: T | null } {
    const key = cacheKey(action, payload);
    const e = this.map.get(key);
    if (e && isFresh(e, Date.now())) {
      this.stats.hits++;
      return { hit: true, key, value: e.value as T };
    }
    this.stats.misses++;
    return { hit: false, key, value: null };
  }

  set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): void {
    this.map.set(key, makeEntry(key, value, Date.now(), ttlSeconds));
    this.dirty = true;
  }

  /**
   * Atomic write: serialise to a temp file, then rename.
   *
   * A run interrupted mid-write would otherwise leave truncated JSON, and the next run would
   * silently start cold — a cache that quietly empties itself is worse than no cache, because
   * the benchmark would attribute the lost hit-rate to the workload instead of to corruption.
   */
  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)), "utf8");
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      /* a cache that cannot persist must not fail the run it was speeding up */
    }
  }

  get counters(): CacheStats & { ratio: number; size: number } {
    return { ...this.stats, ratio: hitRatio(this.stats), size: this.map.size };
  }

  /** Was the cache path exercised at all this run? Feeds the self-audit fact. */
  get exercised(): boolean {
    return this.stats.hits + this.stats.misses > 0;
  }

  static exists(file = join(process.env.HOME ?? ".", ".ollamas", "pipeline-cache.json")): boolean {
    return existsSync(file);
  }
}
