// Scripts domain v18 — preflight readiness core. Version parse, launchctl parse,
// verdict (critical fails → not ok; warn fails → still ok, env-dependent).
import { describe, test, expect } from "vitest";
import { nodeVersionOk, parseLaunchctlLoaded, evaluate } from "../../bin/host-bridge/lib/doctor.mjs";

describe("doctor core", () => {
  test("nodeVersionOk: >=24 passes, below fails", () => {
    expect(nodeVersionOk("v24.3.1", 24)).toBe(true);
    expect(nodeVersionOk("v25.0.0", 24)).toBe(true);
    expect(nodeVersionOk("v18.19.0", 24)).toBe(false);
    expect(nodeVersionOk("", 24)).toBe(false);
  });

  test("parseLaunchctlLoaded: exit0 loaded, nonzero not, stdout fallback", () => {
    expect(parseLaunchctlLoaded({ exitCode: 0 })).toBe(true);
    expect(parseLaunchctlLoaded({ exitCode: 113 })).toBe(false);
    expect(parseLaunchctlLoaded({ stdout: "… com.missioncontrol.terminalbridge = {" })).toBe(true);
    expect(parseLaunchctlLoaded({ stdout: "no such process" })).toBe(false);
  });

  test("evaluate: all ok → ok+ready", () => {
    const v = evaluate([
      { name: "node", level: "critical", ok: true },
      { name: "drift", level: "critical", ok: true },
      { name: "bridge", level: "warn", ok: true },
    ]);
    expect(v.ok).toBe(true);
    expect(v.ready).toBe(true);
    expect(v.passed).toBe(3);
  });

  test("evaluate: a critical failure → not ok", () => {
    const v = evaluate([
      { name: "node", level: "critical", ok: false },
      { name: "drift", level: "critical", ok: true },
    ]);
    expect(v.ok).toBe(false);
    expect(v.criticalFailed).toContain("node");
  });

  test("evaluate: only warn failures → ok but not ready (no false-alarm)", () => {
    const v = evaluate([
      { name: "node", level: "critical", ok: true },
      { name: "drift", level: "critical", ok: true },
      { name: "bridge", level: "warn", ok: false },
      { name: "launchagent", level: "warn", ok: false },
    ]);
    expect(v.ok).toBe(true); // installable invariants fine → exit 0
    expect(v.ready).toBe(false); // not fully running
    expect(v.warnFailed).toEqual(["bridge", "launchagent"]);
  });
});
