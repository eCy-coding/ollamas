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

// Test/maintenance helper — clear all counters.
export function resetKeyUsage(): void { buckets.clear(); }
