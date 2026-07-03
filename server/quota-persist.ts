// server/quota-persist.ts — pure quota-window persistence + daily reset-boundary math.
// Mirrors the cooldownToPersist/FromPersist pattern (providers.ts): serialize live buckets,
// drop expired/corrupt entries on both write and read. Bucket keys are `provider::keyId`
// (sha256-12) — a raw key value never reaches disk. No IO here; key-usage.ts wires it.
import { catalogEntry } from "./provider-catalog";

export type ResetBoundary = "rolling" | "utc-midnight" | "pt-midnight";

export interface UsageBucket { minTs: number; minCount: number; dayTs: number; dayCount: number }

const DAY_MS = 86_400_000;

function isBucket(v: unknown): v is UsageBucket {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return ["minTs", "minCount", "dayTs", "dayCount"].every((f) => typeof b[f] === "number" && Number.isFinite(b[f]));
}

/** Serialize live buckets, dropping any whose day window has fully elapsed (counts read 0). */
export function bucketsToPersist(entries: Array<[string, UsageBucket]>, now: number): Record<string, UsageBucket> {
  const out: Record<string, UsageBucket> = {};
  for (const [k, b] of entries) {
    if (isBucket(b) && now - b.dayTs < DAY_MS) out[k] = { minTs: b.minTs, minCount: b.minCount, dayTs: b.dayTs, dayCount: b.dayCount };
  }
  return out;
}

/** Parse persisted buckets on boot; keeps only well-shaped, still-live entries. */
export function bucketsFromPersist(obj: unknown, now: number): Array<[string, UsageBucket]> {
  if (!obj || typeof obj !== "object") return [];
  const out: Array<[string, UsageBucket]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isBucket(v) && now - v.dayTs < DAY_MS) out.push([k, { minTs: v.minTs, minCount: v.minCount, dayTs: v.dayTs, dayCount: v.dayCount }]);
  }
  return out;
}

// Legacy providers with a known non-rolling daily quota reset. Gemini's free-tier RPD
// resets at midnight Pacific (paid tiers too) — a rolling 24h window would under-report
// available budget every morning.
const LEGACY_BOUNDARY: Record<string, ResetBoundary> = {
  gemini: "pt-midnight",
  "gemini-cli": "pt-midnight",
};

/** Daily-quota reset semantics for a provider. Catalog entries carry their own; unknown → rolling. */
export function boundaryFor(provider: string): ResetBoundary {
  return catalogEntry(provider)?.resetBoundary ?? LEGACY_BOUNDARY[provider] ?? "rolling";
}

/** Epoch ms where the CURRENT daily-quota window began. `rolling` has no boundary → 0
 *  (callers keep the per-bucket rolling window). pt-midnight uses Intl for real DST-aware
 *  Los Angeles midnight — built-in, zero-dep. */
export function boundaryStartMs(boundary: ResetBoundary, nowMs: number): number {
  if (boundary === "rolling") return 0;
  if (boundary === "utc-midnight") return nowMs - (nowMs % DAY_MS);
  // pt-midnight: ms elapsed since midnight in America/Los_Angeles at `nowMs`.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const sinceMidnight = ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000 + (nowMs % 1000);
  return nowMs - sinceMidnight;
}

/** True when a bucket's DAY window is over: rolling → 24h elapsed; boundary → last record
 *  predates the current window's start (e.g. crossed Pacific midnight). */
export function dayWindowExpired(bucket: UsageBucket, boundary: ResetBoundary, nowMs: number): boolean {
  if (nowMs - bucket.dayTs >= DAY_MS) return true; // 24h is an upper bound for every mode
  if (boundary === "rolling") return false;
  return bucket.dayTs < boundaryStartMs(boundary, nowMs);
}
