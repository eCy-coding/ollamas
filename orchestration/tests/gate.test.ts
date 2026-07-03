import { describe, it, expect } from "vitest";
import { parseVitestOutput, gateChecks, gateExitCode, renderGateReport } from "../bin/lib/gate";

describe("parseVitestOutput", () => {
  it("exit 0 → ok with passed count", () => {
    expect(parseVitestOutput(0, "Test Files  74 passed\n Tests  815 passed (815)")).toEqual({ ok: true, passed: 815, failed: 0 });
  });
  it("nonzero exit → not ok, counts failed", () => {
    expect(parseVitestOutput(1, "Tests  3 failed | 800 passed")).toMatchObject({ ok: false, failed: 3 });
  });
  it("nonzero exit with no parseable count → failed at least 1", () => {
    expect(parseVitestOutput(1, "crashed before summary")).toEqual({ ok: false, passed: 0, failed: 1 });
  });
});

describe("gateChecks + gateExitCode — the exit-mask fix", () => {
  it("a red tsc is RED even when its output was truncated (real exit, not a masked pipe)", () => {
    // 28 real errors but output only shows a few lines (the head-masking scenario)
    const checks = gateChecks({ exit: 2, output: "a.ts(9,1): error TS2339\nb.ts(1,1): error TS2345" }, { exit: 0, output: "Tests 800 passed" });
    expect(checks[0].ok).toBe(false);
    expect(gateExitCode(checks)).toBe(1); // NOT masked to 0
  });
  it("green tsc + green vitest → exit 0", () => {
    const checks = gateChecks({ exit: 0, output: "" }, { exit: 0, output: "Tests 815 passed" });
    expect(gateExitCode(checks)).toBe(0);
  });
  it("green tsc + red vitest → exit 1", () => {
    const checks = gateChecks({ exit: 0, output: "" }, { exit: 1, output: "Tests 1 failed | 800 passed" });
    expect(gateExitCode(checks)).toBe(1);
  });
});

describe("renderGateReport", () => {
  it("shows the verdict and each check", () => {
    const md = renderGateReport(gateChecks({ exit: 0, output: "" }, { exit: 0, output: "Tests 5 passed" }));
    expect(md).toContain("✅ GREEN");
    expect(md).toContain("tsc --noEmit");
    expect(md).toContain("vitest run");
  });
});
