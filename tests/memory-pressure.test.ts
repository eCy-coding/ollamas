// Why the e2e gate needs a memory leg.
//
// Measured 2026-07-22: com.odysseus.server restarted 668 times. It boots in ~210s, serves
// for about a minute, then dies by SIGKILL — a diagnostic wrapper never got to write its
// STOP line, and swap sat at ~22.4 GB of 23.5 GB the entire time. The gate reported
// "odysseus-bridge red" and nothing else, so every investigation started from the wrong
// end: the watchdog, the orchestrator, a double bind, PATH. All were eliminated; the
// machine simply had no memory left.
//
// A red leg that cannot say WHY sends the next person down the same dead ends. This leg
// makes the constraint visible in the same JSON the watchdog already reads.
import { describe, test, expect } from "vitest";
import { parseSwapUsage, assessMemory, type MemorySample } from "../server/memory-pressure";

const SWAP_LINE = "total = 23552.00M  used = 22173.88M  free = 1378.12M  (encrypted)";

describe("parseSwapUsage — sysctl vm.swapusage is the only portable source on macOS", () => {
  test("the real line from this machine parses", () => {
    expect(parseSwapUsage(SWAP_LINE)).toEqual({ totalMb: 23552, usedMb: 22173.88, freeMb: 1378.12 });
  });

  test("a machine with swap disabled reads as zero, not as a failure", () => {
    expect(parseSwapUsage("total = 0.00M  used = 0.00M  free = 0.00M")).toEqual({
      totalMb: 0, usedMb: 0, freeMb: 0,
    });
  });

  test("garbage, empty and truncated output yield null rather than a wrong number", () => {
    expect(parseSwapUsage("")).toBeNull();
    expect(parseSwapUsage("not swap output at all")).toBeNull();
    expect(parseSwapUsage("total = 23552.00M")).toBeNull();
  });

  test("G-suffixed values are honoured, not silently read as megabytes", () => {
    expect(parseSwapUsage("total = 8.00G  used = 4.00G  free = 4.00G")?.usedMb).toBe(4096);
  });
});

describe("assessMemory — the threshold is what the machine actually failed at", () => {
  const sample = (over: Partial<MemorySample> = {}): MemorySample =>
    ({ swap: { totalMb: 23552, usedMb: 2000, freeMb: 21552 }, topRssGb: 1, topName: "node", ...over });

  test("a healthy machine is green and still reports the numbers", () => {
    const r = assessMemory(sample());
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("swap");
  });

  test("the exact state odysseus kept dying in is red", () => {
    const r = assessMemory(sample({ swap: { totalMb: 23552, usedMb: 22173.88, freeMb: 1378.12 } }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("94%");
  });

  test("the biggest consumer is named — that is the actionable part", () => {
    const r = assessMemory(sample({
      swap: { totalMb: 23552, usedMb: 22173.88, freeMb: 1378.12 },
      topRssGb: 6.02, topName: "llama-server",
    }));
    expect(r.detail).toContain("llama-server");
    expect(r.detail).toContain("6.0");
  });

  test("just under the threshold is still green — no crying wolf", () => {
    const r = assessMemory(sample({ swap: { totalMb: 1000, usedMb: 899, freeMb: 101 } }));
    expect(r.ok).toBe(true);
  });

  test("exactly at the threshold trips it", () => {
    const r = assessMemory(sample({ swap: { totalMb: 1000, usedMb: 900, freeMb: 100 } }));
    expect(r.ok).toBe(false);
  });

  test("a machine with swap disabled is never red for swap reasons", () => {
    // total 0 must not divide by zero into NaN and must not read as 100% used.
    const r = assessMemory(sample({ swap: { totalMb: 0, usedMb: 0, freeMb: 0 } }));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("swap disabled");
  });

  test("unreadable swap degrades to a report, not a false red", () => {
    const r = assessMemory({ swap: null, topRssGb: 1, topName: "node" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("unavailable");
  });

  test("the threshold is overridable for machines with different headroom", () => {
    const s = sample({ swap: { totalMb: 1000, usedMb: 500, freeMb: 500 } });
    expect(assessMemory(s, 0.4).ok).toBe(false);
    expect(assessMemory(s, 0.9).ok).toBe(true);
  });
});
