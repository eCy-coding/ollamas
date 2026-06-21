// Scripts domain v11 — autonomous gate runner core. Pure runGate() must aggregate
// step results correctly and NEVER report green when a step failed (RISK-SCR-014).
import { describe, test, expect } from "vitest";
import { runGate } from "../../bin/host-bridge/gate.mjs";

// Deterministic clock: +10ms per call.
function clock() {
  let t = 0;
  return () => (t += 10);
}

describe("runGate (autonomous gate core)", () => {
  test("all steps pass → verdict green, exit-worthy 0", async () => {
    const steps = [{ name: "a", cmd: "x" }, { name: "b", cmd: "y" }];
    const v = await runGate(steps, { exec: async () => {}, now: clock() });
    expect(v.ok).toBe(true);
    expect(v.failed).toEqual([]);
    expect(v.results.map((r) => r.name)).toEqual(["a", "b"]);
    expect(v.results.every((r) => r.ms > 0)).toBe(true);
  });

  test("a failing step → verdict red + names the failure (no false-green)", async () => {
    const steps = [{ name: "tsc", cmd: "x" }, { name: "vitest", cmd: "y" }];
    const exec = async (s: any) => { if (s.name === "vitest") throw new Error("2 tests failed"); };
    const v = await runGate(steps, { exec, now: clock() });
    expect(v.ok).toBe(false);
    expect(v.failed).toEqual(["vitest"]);
    const failed = v.results.find((r: any) => r.name === "vitest");
    expect(failed.error).toContain("2 tests failed");
  });

  test("skipped step does not fail the gate but is recorded", async () => {
    const steps = [{ name: "swift", skip: true, reason: "not on PATH" }, { name: "tsc", cmd: "x" }];
    const v = await runGate(steps, { exec: async () => {}, now: clock() });
    expect(v.ok).toBe(true);
    const sw = v.results.find((r: any) => r.name === "swift");
    expect(sw.skipped).toBe(true);
    expect(sw.reason).toBe("not on PATH");
  });

  test("steps run in order and all are attempted even after none fail", async () => {
    const seen: string[] = [];
    const steps = [{ name: "a", cmd: "1" }, { name: "b", cmd: "2" }, { name: "c", cmd: "3" }];
    await runGate(steps, { exec: async (s: any) => { seen.push(s.name); }, now: clock() });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("missing exec runner throws (misuse guard)", async () => {
    await expect(runGate([], {} as any)).rejects.toThrow(/exec runner required/);
  });
});
