import { describe, it, expect } from "vitest";
import { runChecks, verdict, renderDoctor, type DoctorInput } from "../bin/lib/doctor";

const NOW = Date.parse("2026-06-20T00:00:00Z");

const notReady: DoctorInput = {
  settings: '{ "hooks": { "UserPromptSubmit": [{"command":"role-hook.ts"}] } }', // SessionStart + model-hook YOK
  launchctlOut: "12345 0 com.apple.something",                                   // autopilot agent YOK
  selection: { stale: true, ts: "2026-06-14T16:04:46Z", selection: { model: "qwen3-coder:30b" } },
  artifacts: { "MODEL_PROMPT.md": true, "CONDUCTOR.md": true, "AUTOPILOT.md": true },
  nowMs: NOW, staleDays: 2,
};

const ready: DoctorInput = {
  settings: '{ "hooks": { "SessionStart": [{"command":"autopilot.ts"}], "UserPromptSubmit": [{"command":"role-hook.ts"},{"command":"model-hook.ts"}] } }',
  launchctlOut: "999 0 com.ollamas.orchestration.autopilot",
  selection: { stale: false, ts: "2026-06-20T00:00:00Z", selection: { model: "qwen3-coder:30b" } },
  artifacts: { "MODEL_PROMPT.md": true, "CONDUCTOR.md": true, "AUTOPILOT.md": true },
  nowMs: NOW, staleDays: 2,
};

describe("runChecks — 0-manuel readiness denetimi (PURE)", () => {
  it("aktif-değil + stale → hook FAIL, launchd WARN, bench WARN", () => {
    const cs = runChecks(notReady);
    const by = Object.fromEntries(cs.map((c) => [c.id, c]));
    expect(by["hook-wiring"].status).toBe("fail");
    expect(by["launchd"].status).toBe("warn");
    expect(by["bench-fresh"].status).toBe("warn");
    expect(by["bench-fresh"].selfHealable).toBe(true);
    expect(by["artifacts"].status).toBe("ok");
  });
  it("tam-hazır → hepsi ok", () => {
    expect(runChecks(ready).every((c) => c.status === "ok")).toBe(true);
  });
  it("ts-yaşı staleDays'i aşınca bench WARN (stale flag olmasa bile)", () => {
    const cs = runChecks({ ...ready, selection: { stale: false, ts: "2026-06-10T00:00:00Z", selection: {} } });
    expect(cs.find((c) => c.id === "bench-fresh")!.status).toBe("warn");
  });
});

describe("verdict", () => {
  it("fail varsa NO-GO", () => {
    expect(verdict(runChecks(notReady)).go).toBe(false);
  });
  it("yalnız warn → GO (uyarılı)", () => {
    const warnOnly = runChecks({ ...ready, selection: { stale: true, ts: ready.selection.ts, selection: {} } });
    expect(verdict(warnOnly).go).toBe(true);
  });
  it("hepsi ok → GO", () => {
    expect(verdict(runChecks(ready)).go).toBe(true);
  });
});

describe("renderDoctor — DOCTOR.md", () => {
  it("verdict + remediation + ranked işaretler içerir; deterministik", () => {
    const cs = runChecks(notReady);
    const md = renderDoctor(cs, verdict(cs), "2026-06-20T00:00:00Z");
    expect(md).toMatch(/NO-GO|HAZIR DEĞİL/i);
    expect(md).toMatch(/AUTOPILOT_SETUP|settings\.json|launchctl/); // remediation
    expect(md).toContain("✗"); // hook fail işareti
    expect(renderDoctor(cs, verdict(cs), "2026-06-20T00:00:00Z")).toBe(md); // deterministik
  });
});
