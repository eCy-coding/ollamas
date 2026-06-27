// Pure-core tests for buildRemoteCheck + formatRemoteCheck. Zero IO.
import { describe, it, expect } from "vitest";
import { buildRemoteCheck, formatRemoteCheck } from "../cli/lib/remote";
import type { RemoteCheckReport } from "../cli/lib/remote";

const GW = "http://gw:3000";

describe("buildRemoteCheck", () => {
  it("live + qwen3:8b present → pass=true", () => {
    const r = buildRemoteCheck({ mode: "live" }, ["qwen3:8b", "llama3:8b"], { gateway: GW });
    expect(r.pass).toBe(true);
    expect(r.mode).toBe("live");
    expect(r.reachable).toBe(true);
    expect(r.modelCount).toBe(2);
    expect(r.missing).toEqual([]);
  });

  it("degraded-live → pass=false", () => {
    const r = buildRemoteCheck({ mode: "degraded-live" }, ["qwen3:8b"], { gateway: GW });
    expect(r.pass).toBe(false);
    expect(r.mode).toBe("degraded-live");
  });

  it("demo → pass=false", () => {
    const r = buildRemoteCheck({ mode: "demo" }, ["qwen3:8b"], { gateway: GW });
    expect(r.pass).toBe(false);
    expect(r.mode).toBe("demo");
  });

  it("live but qwen3:8b missing → pass=false, missing=[qwen3:8b]", () => {
    const r = buildRemoteCheck({ mode: "live" }, ["llama3:8b"], { gateway: GW });
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(["qwen3:8b"]);
  });

  it("custom required list — all present → pass=true", () => {
    const r = buildRemoteCheck(
      { mode: "live" },
      ["mistral:7b", "gemma:2b"],
      { required: ["mistral:7b", "gemma:2b"], gateway: GW },
    );
    expect(r.pass).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("custom required list — partial → pass=false", () => {
    const r = buildRemoteCheck(
      { mode: "live" },
      ["mistral:7b"],
      { required: ["mistral:7b", "gemma:2b"], gateway: GW },
    );
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(["gemma:2b"]);
  });

  it("empty models → reachable=false, pass=false", () => {
    const r = buildRemoteCheck({ mode: "live" }, [], { gateway: GW });
    expect(r.reachable).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.modelCount).toBe(0);
  });

  it("null health (unreachable) → reachable=false, mode=unknown", () => {
    const r = buildRemoteCheck(null, [], { gateway: GW });
    expect(r.reachable).toBe(false);
    expect(r.mode).toBe("unknown");
    expect(r.pass).toBe(false);
  });
});

describe("formatRemoteCheck", () => {
  const passReport: RemoteCheckReport = {
    mode: "live",
    reachable: true,
    modelCount: 1,
    required: ["qwen3:8b"],
    missing: [],
    pass: true,
    gateway: GW,
  };

  const failReport: RemoteCheckReport = {
    mode: "demo",
    reachable: false,
    modelCount: 0,
    required: ["qwen3:8b"],
    missing: ["qwen3:8b"],
    pass: false,
    gateway: GW,
  };

  it("json ctx → valid JSON matching report shape", () => {
    const out = formatRemoteCheck(passReport, { color: false, json: true });
    const parsed = JSON.parse(out);
    expect(parsed.pass).toBe(true);
    expect(parsed.mode).toBe("live");
    expect(parsed.gateway).toBe(GW);
  });

  it("plain ctx → contains PASS", () => {
    const out = formatRemoteCheck(passReport, { color: false, json: false });
    expect(out).toContain("PASS");
    expect(out).toContain("live");
    expect(out).toContain(GW);
  });

  it("plain ctx fail → contains FAIL", () => {
    const out = formatRemoteCheck(failReport, { color: false, json: false });
    expect(out).toContain("FAIL");
    expect(out).toContain("demo");
  });

  it("plain ctx → shows ✓ for present model, ✗ for missing", () => {
    const mixedReport: RemoteCheckReport = {
      mode: "live",
      reachable: true,
      modelCount: 1,
      required: ["qwen3:8b", "llama3:8b"],
      missing: ["llama3:8b"],
      pass: false,
      gateway: GW,
    };
    const out = formatRemoteCheck(mixedReport, { color: false, json: false });
    expect(out).toContain("✓");
    expect(out).toContain("✗");
  });

  it("color ctx → contains ANSI codes for live mode", () => {
    const out = formatRemoteCheck(passReport, { color: true, json: false });
    expect(out).toMatch(/\x1b\[/);
  });
});
