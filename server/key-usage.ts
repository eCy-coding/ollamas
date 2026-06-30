// server/key-usage.ts — per-key rolling usage counters for PROACTIVE quota awareness.
// SECURITY: a key is identified by a non-reversible `keyId` (sha256 prefix) — the raw key
// is NEVER stored, logged, or surfaced. Counters are in-memory (reset on restart, by which
// time the per-minute/day windows have rolled over anyway).
import { createHash } from "node:crypto";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

// Stable, non-reversible id for a raw key. Used everywhere a key must be referenced safely.
export function keyId(rawKey: string): string {
  return createHash("sha256").update(rawKey || "").digest("hex").slice(0, 12);
}

interface Bucket { minTs: number; minCount: number; dayTs: number; dayCount: number }
const buckets = new Map<string, Bucket>();
const bk = (provider: string, id: string) => `${provider}::${id}`;

// Count one successful use of (provider, keyId), rolling the per-minute/day windows.
export function recordKeyUse(provider: string, id: string, nowMs: number = Date.now()): void {
  const key = bk(provider, id);
  let b = buckets.get(key);
  if (!b) { b = { minTs: nowMs, minCount: 0, dayTs: nowMs, dayCount: 0 }; buckets.set(key, b); }
  if (nowMs - b.minTs >= MIN_MS) { b.minTs = nowMs; b.minCount = 0; }
  if (nowMs - b.dayTs >= DAY_MS) { b.dayTs = nowMs; b.dayCount = 0; }
  b.minCount++; b.dayCount++;
}

// Current per-minute / per-day counts for a key (0 once a window has elapsed).
export function keyWindows(provider: string, id: string, nowMs: number = Date.now()): { perMin: number; perDay: number } {
  const b = buckets.get(bk(provider, id));
  if (!b) return { perMin: 0, perDay: 0 };
  return {
    perMin: nowMs - b.minTs >= MIN_MS ? 0 : b.minCount,
    perDay: nowMs - b.dayTs >= DAY_MS ? 0 : b.dayCount,
  };
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
export function resetKeyUsage(): void { buckets.clear(); costByProvider.clear(); }
