// vT12: pure token-bucket rate limiter for the proxy gateway.
// PURE + deterministic: clock injected (breaker.ts pattern). Zero deps.
//
// Semantics: each key owns a bucket of `capacity` tokens refilling continuously
// at `ratePerSec`. allow(key) spends one token or denies. Bounded memory:
// at most `maxKeys` buckets — beyond that the oldest-seen key is evicted
// (unauthenticated remote IPs must never grow the map unbounded).

export interface LimiterOptions {
  /** Max burst size (tokens in a full bucket). */
  capacity: number;
  /** Continuous refill rate, tokens per second. */
  ratePerSec: number;
  /** Bucket-map bound; oldest-seen key evicted beyond this. Default 10_000. */
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  last: number; // ms timestamp of last spend/refill
}

/** Create a limiter: returns allow(key) → true (spend) / false (deny). */
export function createLimiter(
  opts: LimiterOptions,
  clock: () => number = Date.now,
): (key: string) => boolean {
  if (!(opts.capacity > 0)) throw new Error(`ratelimit: capacity must be > 0, got ${opts.capacity}`);
  if (!(opts.ratePerSec > 0)) throw new Error(`ratelimit: ratePerSec must be > 0, got ${opts.ratePerSec}`);
  const maxKeys = opts.maxKeys ?? 10_000;
  // Map preserves insertion order → first key = oldest-seen → cheap eviction.
  const buckets = new Map<string, Bucket>();

  return function allow(key: string): boolean {
    const now = clock();
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      b = { tokens: opts.capacity, last: now };
      buckets.set(key, b);
    } else {
      const elapsed = Math.max(0, now - b.last);
      b.tokens = Math.min(opts.capacity, b.tokens + (elapsed / 1000) * opts.ratePerSec);
      b.last = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  };
}
