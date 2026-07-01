// backoff — exponential backoff with FULL JITTER + transient-error classification.
//
// PROVEN basis (not invented): AWS Prescriptive Guidance "Retry with backoff" + AWS Builders' Library
// "Timeouts, retries, and backoff with jitter". Full-jitter formula: delay = random(0,1) × min(cap,
// base × 2^attempt). Jitter avoids the thundering-herd (aligned retries); the cap bounds the wait; retries
// are limited; NON-transient errors fail fast (circuit-breaker) instead of retrying. Operations must be
// idempotent (our PROPOSE dispatch is — it only writes a report, never the repo tree).

/** Full-jitter delay in ms for a 0-based attempt. `rand` is injectable for deterministic tests. */
export function fullJitterDelay(attempt: number, baseMs: number, capMs: number, rand: () => number = Math.random): number {
  const a = Math.max(0, Math.floor(attempt));
  const exp = Math.min(capMs, baseMs * Math.pow(2, a)); // exponential, capped
  return Math.floor(rand() * exp);                       // full jitter: uniform in [0, exp)
}

// Transient signatures worth retrying (network/throttle/timeout/5xx). Anything else = fail fast.
const TRANSIENT = /\b(timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed|throttl|rate.?limit|429|500|502|503|504)\b/i;

/** True if the error looks transient (retry-worthy). Non-transient → caller should fail fast. */
export function isTransient(err: unknown): boolean {
  const msg = err == null ? "" : typeof err === "string" ? err : (err as any).message ?? String(err);
  return TRANSIENT.test(String(msg));
}

/** Whether to retry: transient AND attempts remain. Deterministic decision (no IO). */
export function shouldRetry(err: unknown, attempt: number, maxRetries: number): boolean {
  return attempt < maxRetries && isTransient(err);
}
