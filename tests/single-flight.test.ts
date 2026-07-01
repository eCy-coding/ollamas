import { describe, test, expect } from "vitest";
import { createSingleFlight } from "../server/lib/single-flight";

describe("createSingleFlight — concurrent callers share ONE in-flight run (concurrency-safety)", () => {
  test("N concurrent calls for the same key invoke fn ONCE, all get the same result", async () => {
    const sf = createSingleFlight();
    let calls = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => { release = r; });
    const fn = () => { calls++; return gate; };

    const p1 = sf.run("base", fn);
    const p2 = sf.run("base", fn);
    const p3 = sf.run("base", fn);
    expect(sf.inFlight()).toBe(1);      // one shared probe
    release("http://127.0.0.1:7345");
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(calls).toBe(1);              // fn ran once despite 3 callers
    expect([a, b, c]).toEqual(["http://127.0.0.1:7345", "http://127.0.0.1:7345", "http://127.0.0.1:7345"]);
    expect(sf.inFlight()).toBe(0);      // cleared on settle
  });

  test("different keys run independently", async () => {
    const sf = createSingleFlight();
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    const [x, y] = await Promise.all([sf.run("a", fn), sf.run("b", fn)]);
    expect(calls).toBe(2);             // distinct keys → distinct runs
    expect(new Set([x, y]).size).toBe(2);
  });

  test("failure is NOT cached — a later call re-runs (no stale rejection)", async () => {
    const sf = createSingleFlight();
    let calls = 0;
    const fn = async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; };
    await expect(sf.run("k", fn)).rejects.toThrow("boom");
    expect(sf.inFlight()).toBe(0);     // cleared after rejection
    await expect(sf.run("k", fn)).resolves.toBe("ok"); // re-runs, succeeds
    expect(calls).toBe(2);
  });
});
