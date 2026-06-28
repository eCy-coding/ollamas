import { describe, it, expect } from "vitest";
import {
  next, intGen, boolGen, pickGen, arrayGen, mapGen, tupleGen, recordGen, forAll, assertForAll,
} from "../bin/lib/proptest";

// The harness must itself be deterministic + total (it is the foundation all property proofs inherit).

describe("next — seeded LCG: deterministic + total", () => {
  it("same seed → same output (determinism)", () => {
    expect(next(42)).toEqual(next(42));
  });
  it("u01 always in [0,1)", () => {
    let s = 1;
    for (let i = 0; i < 1000; i++) { const [u, n] = next(s); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); s = n; }
  });
  it("total: negative / float / huge seeds never throw", () => {
    for (const seed of [-5, -0.7, 1e18, 0, 2 ** 31]) expect(() => next(seed)).not.toThrow();
  });
});

describe("generators — deterministic + bounded", () => {
  it("intGen stays in [lo,hi]", () => {
    const g = intGen(3, 9); let s = 7;
    for (let i = 0; i < 500; i++) { const [v, n] = g(s); expect(v).toBeGreaterThanOrEqual(3); expect(v).toBeLessThanOrEqual(9); s = n; }
  });
  it("intGen total when hi<lo → lo", () => {
    expect(intGen(5, 1)(123)[0]).toBe(5);
  });
  it("arrayGen length in [0,maxLen]", () => {
    const g = arrayGen(boolGen, 6); let s = 11;
    for (let i = 0; i < 300; i++) { const [v, n] = g(s); expect(v.length).toBeGreaterThanOrEqual(0); expect(v.length).toBeLessThanOrEqual(6); s = n; }
  });
  it("pickGen always returns a member", () => {
    const arr = ["a", "b", "c"]; const g = pickGen(arr); let s = 2;
    for (let i = 0; i < 200; i++) { const [v, n] = g(s); expect(arr).toContain(v); s = n; }
  });
  it("mapGen / tupleGen / recordGen compose deterministically", () => {
    const g = recordGen({ n: intGen(0, 10), b: boolGen, t: tupleGen(intGen(0, 1), boolGen) });
    expect(g(99)).toEqual(g(99));
    const doubled = mapGen(intGen(0, 5), (x) => x * 2);
    expect(doubled(99)).toEqual(doubled(99));
  });
});

describe("forAll — sound verification + reproducible counterexample", () => {
  it("ok:true when property always holds", () => {
    const r = forAll({ seed: 1, runs: 500 }, intGen(0, 100), (x) => x >= 0 && x <= 100);
    expect(r.ok).toBe(true);
    expect(r.runs).toBe(500);
  });
  it("ok:false + counterexample + seed when property fails", () => {
    const r = forAll({ seed: 1, runs: 500 }, intGen(0, 100), (x) => x < 50);
    expect(r.ok).toBe(false);
    expect(r.counterexample).toBeGreaterThanOrEqual(50);
    expect(typeof r.seed).toBe("number");
  });
  it("counterexample is REPRODUCIBLE from its seed", () => {
    const r = forAll({ seed: 7, runs: 1000 }, intGen(0, 1000), (x) => x !== 777 && x < 900);
    expect(r.ok).toBe(false);
    // re-running the generator on the returned seed yields the same counterexample
    const reproduced = intGen(0, 1000)(r.seed!)[0];
    expect(reproduced).toBe(r.counterexample);
  });
  it("a THROWING property is a captured failure, not a crash (total)", () => {
    const r = forAll({ seed: 1, runs: 10 }, intGen(0, 5), () => { throw new Error("boom"); });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
  it("assertForAll throws with seed on failure, passes silently otherwise", () => {
    expect(() => assertForAll({ seed: 1, runs: 100 }, intGen(0, 9), (x) => x <= 9)).not.toThrow();
    expect(() => assertForAll({ seed: 1, runs: 100 }, intGen(0, 9), (x) => x <= 3)).toThrow(/seed=/);
  });
});
