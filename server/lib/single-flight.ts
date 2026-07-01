// single-flight — de-duplicate concurrent async calls that share a key so an expensive operation runs
// ONCE while N callers await the same in-flight promise. (concurrency-safety stream.)
//
// Used for the host-bridge base-resolution race: N concurrent MCP calls arriving before the reachable
// bridge base is cached each ran the full candidate-probe loop and raced the shared `resolvedBridgeBase`
// write. A single-flight makes the first caller probe while the rest await its result — no redundant
// probes, no flapping. Behavior-preserving: every caller gets the same resolved value.
//
// Pure/in-memory (no IO, no clock) → unit-tested. The in-flight promise is cleared on settle (success OR
// failure) so a later call re-probes rather than caching a stale rejection.

export interface SingleFlight {
  /** Run `fn` for `key`; if a call for `key` is already in flight, await that one instead. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Number of currently in-flight keys (for tests/introspection). */
  inFlight(): number;
}

export function createSingleFlight(): SingleFlight {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      // Start once; clear on settle (success or failure) so failures don't cache.
      const p = (async () => fn())().finally(() => { pending.delete(key); });
      pending.set(key, p);
      return p as Promise<T>;
    },
    inFlight() { return pending.size; },
  };
}
