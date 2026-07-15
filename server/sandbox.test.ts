// B4: sandboxed JS execution via quickjs-emscripten (pure WASM, MIT). Every
// evalUntrusted call gets a fresh QuickJS context + runtime (no reuse across
// calls — no state leakage between untrusted scripts) with a wall-clock
// interrupt handler and a memory cap, and NO host bindings (fetch/process/
// require) are ever exposed inside the sandbox.
import { describe, test, expect } from "vitest";
import { evalUntrusted } from "./sandbox";

describe("sandbox — evalUntrusted (QuickJS WASM)", () => {
  test("arithmetic returns the evaluated value", async () => {
    const r = await evalUntrusted("1 + 2 * 3");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(7);
    expect(typeof r.durationMs).toBe("number");
  });

  test("infinite loop is killed by the wall-clock timeout", async () => {
    const started = Date.now();
    const r = await evalUntrusted("while (true) {}", { timeoutMs: 500 });
    const elapsed = Date.now() - started;
    expect(r.ok).toBe(false);
    expect(String(r.error)).toBeTruthy();
    expect(elapsed).toBeLessThan(3000);
  }, 8000);

  test("no host bindings: fetch/process/require are undefined inside the sandbox", async () => {
    const r = await evalUntrusted(
      "JSON.stringify([typeof fetch, typeof process, typeof require])"
    );
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(r.value))).toEqual(["undefined", "undefined", "undefined"]);
  });

  test("memory bomb is rejected by the memory limit", async () => {
    const r = await evalUntrusted(
      "let a = []; while (true) { a.push(new Array(1e6).fill('x')); }",
      { timeoutMs: 3000, memoryLimitMb: 8 }
    );
    expect(r.ok).toBe(false);
    expect(String(r.error)).toBeTruthy();
  }, 8000);

  test("syntax error → ok:false with a message, not a throw", async () => {
    const r = await evalUntrusted("this is not ) valid js (((");
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
    expect(r.error!.length).toBeGreaterThan(0);
  });

  test("INPUT is JSON-injected as a global and roundtrips", async () => {
    const r = await evalUntrusted("INPUT.a + INPUT.b", { input: { a: 4, b: 5 } });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(9);
  });

  test("50 sequential evals run without crash or leak", async () => {
    for (let i = 0; i < 50; i++) {
      const r = await evalUntrusted(`${i} * 2`);
      expect(r.ok).toBe(true);
      expect(r.value).toBe(i * 2);
    }
  }, 30000);
});
