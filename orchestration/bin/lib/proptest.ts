/**
 * orchestration/bin/lib/proptest.ts — vO22 zero-dep DETERMINISTIC property-based-testing harness (pure).
 *
 * Mathematical+logical foundation primitive: a seeded LCG PRNG + composable generators + `forAll` that
 * verifies a property over N deterministic inputs and, on failure, returns the COUNTEREXAMPLE + the seed
 * that produced it (reproducible evidence — re-run the exact case). No `Math.random`, no `Date`: same seed
 * → same sequence (determinism is the point). Pattern: fast-check/QuickCheck (idea-only; we own zero-dep).
 *
 * A generator is `Gen<T> = (seed:number) => [value:T, nextSeed:number]` — the classic state-threading
 * (seed monad). All combinators are pure and total.
 */

// ── Seeded PRNG (LCG — Numerical Recipes constants, mod 2^31) ─────────────────────
const A = 1103515245, C = 12345, M = 0x80000000; // 2^31

/** Pure LCG step. Normalizes any input to a non-negative int seed; returns [u01, nextSeed]. */
export function next(seed: number): [number, number] {
  const s = ((Math.floor(seed) % M) + M) % M;            // total: any number → [0, M)
  const n = (A * s + C) % M;
  return [n / M, n];                                      // u01 ∈ [0,1)
}

export type Gen<T> = (seed: number) => [T, number];

// ── Primitive generators ──────────────────────────────────────────────────────────

/** Uniform integer in [lo, hi] (inclusive). Total: hi<lo → returns lo. */
export function intGen(lo: number, hi: number): Gen<number> {
  return (seed) => {
    const [u, s] = next(seed);
    if (hi <= lo) return [lo, s];
    return [lo + Math.floor(u * (hi - lo + 1)), s];
  };
}

export const boolGen: Gen<boolean> = (seed) => {
  const [u, s] = next(seed);
  return [u < 0.5, s];
};

/** Pick one element from a non-empty array (uniform). Total: empty → throws is WRONG; we guard. */
export function pickGen<T>(arr: readonly T[]): Gen<T> {
  return (seed) => {
    if (arr.length === 0) throw new Error("pickGen: empty array");
    const [i, s] = intGen(0, arr.length - 1)(seed);
    return [arr[i], s];
  };
}

/** Array of length [0, maxLen] whose elements come from `elem`. Threads the seed through each element. */
export function arrayGen<T>(elem: Gen<T>, maxLen: number): Gen<T[]> {
  return (seed) => {
    const [len, s0] = intGen(0, Math.max(0, maxLen))(seed);
    const out: T[] = [];
    let s = s0;
    for (let i = 0; i < len; i++) {
      const [v, s2] = elem(s);
      out.push(v);
      s = s2;
    }
    return [out, s];
  };
}

/** Map a generator's output (pure). */
export function mapGen<T, U>(g: Gen<T>, f: (t: T) => U): Gen<U> {
  return (seed) => {
    const [t, s] = g(seed);
    return [f(t), s];
  };
}

/** Combine generators into a tuple, threading the seed left→right. */
export function tupleGen<T extends unknown[]>(...gens: { [K in keyof T]: Gen<T[K]> }): Gen<T> {
  return (seed) => {
    const out: unknown[] = [];
    let s = seed;
    for (const g of gens) {
      const [v, s2] = g(s);
      out.push(v);
      s = s2;
    }
    return [out as T, s];
  };
}

/** Build a record generator from a map of field generators (deterministic key order = insertion order). */
export function recordGen<T extends object>(shape: { [K in keyof T]: Gen<T[K]> }): Gen<T> {
  return (seed) => {
    const out = {} as T;
    let s = seed;
    for (const k of Object.keys(shape) as (keyof T)[]) {
      const [v, s2] = shape[k](s);
      (out as Record<PropertyKey, unknown>)[k] = v;
      s = s2;
    }
    return [out, s];
  };
}

// ── forAll ─────────────────────────────────────────────────────────────────────────

export interface PropResult<T> {
  ok: boolean;
  runs: number;            // cases executed (stops at first failure)
  counterexample?: T;      // the input that broke the property
  seed?: number;           // the seed that generated the counterexample (reproduce: gen(seed))
  error?: string;          // if the property THREW (also a failure)
}

/**
 * Verify `property` over `runs` deterministic inputs starting from `seed`. Returns ok:true if all pass,
 * else the first counterexample + its originating seed (reproducible). A property that throws counts as a
 * failure (captured, not propagated) — total.
 */
export function forAll<T>(
  opts: { seed: number; runs: number },
  gen: Gen<T>,
  property: (x: T) => boolean,
): PropResult<T> {
  let seed = opts.seed;
  for (let i = 0; i < opts.runs; i++) {
    const caseSeed = seed;
    const [value, nextSeed] = gen(seed);
    seed = nextSeed;
    let pass = false, err: string | undefined;
    try { pass = property(value) === true; }
    catch (e) { pass = false; err = (e as Error)?.message ?? String(e); }
    if (!pass) return { ok: false, runs: i + 1, counterexample: value, seed: caseSeed, error: err };
  }
  return { ok: true, runs: opts.runs };
}

/** Vitest-friendly assert helper: throws a descriptive error (with seed) when a property fails. */
export function assertForAll<T>(
  opts: { seed: number; runs: number },
  gen: Gen<T>,
  property: (x: T) => boolean,
): void {
  const r = forAll(opts, gen, property);
  if (!r.ok) {
    throw new Error(
      `property failed after ${r.runs} run(s) · seed=${r.seed} · counterexample=${JSON.stringify(r.counterexample)}` +
      (r.error ? ` · threw: ${r.error}` : ""),
    );
  }
}
