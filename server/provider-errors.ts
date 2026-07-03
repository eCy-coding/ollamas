// server/provider-errors.ts — typed HTTP failure for provider calls + Retry-After parsing.
// Pure (no IO) so the 429-cooldown arithmetic is unit-testable. The error MESSAGE keeps the
// status digits ("… error 429") because the router's quota/auth detection string-matches it.

/** Parse an HTTP Retry-After header: delta-seconds ("120") or HTTP-date. Absent/invalid → undefined.
 *  A past HTTP-date clamps to 0 (retry immediately allowed). Negative seconds are invalid. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // HTTP-date always carries month/day names; without letters Date.parse would coerce
  // junk like "-5" into a real date (V8 quirk) — reject before parsing.
  if (!/[A-Za-z]/.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - nowMs);
}

/** Cooldown TTL for a spent key: quota (429) honors the server's Retry-After when it gives a
 *  usable positive number, else 6h (daily-quota horizon); auth failures bench the key 24h.
 *  Retry-After of 0 falls through to the default — an instant retry would just re-hit the wall. */
export function quotaCooldownTtl(isQuota: boolean, retryAfterMs?: number): number {
  if (!isQuota) return 24 * 3600_000;
  return retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 6 * 3600_000;
}

/** Short bench for a generic (non-quota, non-auth) provider failure — network blip, 5xx,
 *  timeout. 30s keeps a flapping endpoint out of the hot path without hiding a real outage
 *  (LiteLLM's default deployment cooldown). */
export const FAILURE_COOLDOWN_MS = 30_000;

export class ProviderHttpError extends Error {
  public readonly status: number;
  public readonly retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
