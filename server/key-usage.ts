// server/key-usage.ts — per-key rolling usage counters for PROACTIVE quota awareness.
// SECURITY: a key is identified by a non-reversible `keyId` (sha256 prefix) — the raw key
// is NEVER stored, logged, or surfaced. Counters are in-memory; the router snapshots them
// to the config (keyUsageSnapshot/hydrateKeyUsage via quota-persist) so a restart no longer
// forgets the day's spent budget. Daily windows honor the provider's reset boundary
// (Gemini = Pacific midnight, GitHub Models/Cloudflare = UTC midnight, rest = rolling 24h).
import { createHash } from "node:crypto";
import { bucketsToPersist, bucketsFromPersist, boundaryFor, dayWindowExpired, type UsageBucket } from "./quota-persist";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

// Stable, non-reversible id for a raw key. Used everywhere a key must be referenced safely.
export function keyId(rawKey: string): string {
  return createHash("sha256").update(rawKey || "").digest("hex").slice(0, 12);
}

type Bucket = UsageBucket;
const buckets = new Map<string, Bucket>();
const bk = (provider: string, id: string) => `${provider}::${id}`;

// A bucket is keyed provider::keyId → a NEW entry per rotated key. Without eviction the map
// grows unbounded over weeks of key rotation. sweepKeyUsage drops any bucket whose per-day window
// has fully elapsed (its counts already read 0), so only currently-active keys are retained.
export function sweepKeyUsage(nowMs: number = Date.now()): number {
  let removed = 0;
  for (const [key, b] of buckets) {
    if (nowMs - b.dayTs >= DAY_MS) { buckets.delete(key); removed++; }
  }
  return removed;
}
// Amortized lazy sweep: run it once every SWEEP_EVERY records so the hot path stays O(1) and
// there is no background timer to leak.
const SWEEP_EVERY = 256;
let recordCount = 0;

// Count one successful use of (provider, keyId), rolling the per-minute/day windows.
// The day window resets by the provider's boundary (Pacific/UTC midnight or rolling 24h).
export function recordKeyUse(provider: string, id: string, nowMs: number = Date.now()): void {
  const key = bk(provider, id);
  let b = buckets.get(key);
  if (!b) { b = { minTs: nowMs, minCount: 0, dayTs: nowMs, dayCount: 0 }; buckets.set(key, b); }
  if (nowMs - b.minTs >= MIN_MS) { b.minTs = nowMs; b.minCount = 0; }
  if (dayWindowExpired(b, boundaryFor(provider), nowMs)) { b.dayTs = nowMs; b.dayCount = 0; }
  b.minCount++; b.dayCount++;
  if (++recordCount % SWEEP_EVERY === 0) sweepKeyUsage(nowMs);
}

// Current per-minute / per-day counts for a key (0 once a window has elapsed).
export function keyWindows(provider: string, id: string, nowMs: number = Date.now()): { perMin: number; perDay: number } {
  const b = buckets.get(bk(provider, id));
  if (!b) return { perMin: 0, perDay: 0 };
  return {
    perMin: nowMs - b.minTs >= MIN_MS ? 0 : b.minCount,
    perDay: dayWindowExpired(b, boundaryFor(provider), nowMs) ? 0 : b.dayCount,
  };
}

// ── Restart persistence (wired by the router; this module stays disk-free) ────────────────
// Snapshot the live buckets for the config vault (expired dropped, keyId-only — safe to
// persist next to the encrypted keys). Hydrate merges saved buckets on boot; corrupt or
// stale payloads are ignored, and an existing in-memory bucket always wins (it is newer).
export function keyUsageSnapshot(nowMs: number = Date.now()): Record<string, Bucket> {
  return bucketsToPersist([...buckets], nowMs);
}
export function hydrateKeyUsage(saved: unknown, nowMs: number = Date.now()): void {
  for (const [k, b] of bucketsFromPersist(saved, nowMs)) {
    if (!buckets.has(k)) buckets.set(k, b);
  }
}

// ── Per-call token + cost telemetry (vNEXT-D1) ─────────────────────────────────────────────
// In-memory, session-scoped (reset on restart) — bytes of RAM, no DB write per LLM call, no
// tenant coupling (distinct from the SaaS usage_events billing path). The cockpit reads
// costSummary() over the existing SSE so the operator sees real per-call tokens + USD spend.
interface CostAgg { calls: number; tokensIn: number; tokensOut: number; usd: number }
const costByProvider = new Map<string, CostAgg>();

export function recordCallCost(provider: string, tokensIn: number, tokensOut: number, usd: number): void {
  let a = costByProvider.get(provider);
  if (!a) { a = { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0 }; costByProvider.set(provider, a); }
  a.calls++; a.tokensIn += Math.max(0, tokensIn || 0); a.tokensOut += Math.max(0, tokensOut || 0); a.usd += Math.max(0, usd || 0);
}

export interface CostSummary {
  totalCalls: number; totalTokensIn: number; totalTokensOut: number; totalUsd: number;
  perProvider: Record<string, CostAgg>;
}
export function costSummary(): CostSummary {
  const perProvider: Record<string, CostAgg> = {};
  let totalCalls = 0, totalTokensIn = 0, totalTokensOut = 0, totalUsd = 0;
  for (const [prov, a] of costByProvider) {
    perProvider[prov] = { ...a };
    totalCalls += a.calls; totalTokensIn += a.tokensIn; totalTokensOut += a.tokensOut; totalUsd += a.usd;
  }
  return { totalCalls, totalTokensIn, totalTokensOut, totalUsd: Math.round(totalUsd * 1e6) / 1e6, perProvider };
}

// Test/maintenance helper — clear all counters.
export function resetKeyUsage(): void { buckets.clear(); costByProvider.clear(); recordCount = 0; }

// Test/observability helper — current number of retained key buckets.
export function keyUsageSize(): number { return buckets.size; }
