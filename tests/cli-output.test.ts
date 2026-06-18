import { describe, it, expect } from "vitest";
import { shouldColor, resolveOutputCtx, c, formatDoctor, streamFooter, type DoctorReport } from "../cli/lib/output";

describe("shouldColor", () => {
  it("color only on a real TTY", () => {
    expect(shouldColor({ isTTY: true })).toBe(true);
    expect(shouldColor({ isTTY: false })).toBe(false);
  });
  it("NO_COLOR and --json suppress color even on a TTY", () => {
    expect(shouldColor({ isTTY: true, noColor: true })).toBe(false);
    expect(shouldColor({ isTTY: true, json: true })).toBe(false);
  });
});

describe("resolveOutputCtx", () => {
  it("honors NO_COLOR env", () => {
    expect(resolveOutputCtx({ NO_COLOR: "1" } as any, true, false).color).toBe(false);
    expect(resolveOutputCtx({} as any, true, false).color).toBe(true);
  });
});

describe("c (colorize)", () => {
  it("wraps in ANSI only when enabled", () => {
    expect(c("red", "x", false)).toBe("x");
    expect(c("red", "x", true)).toContain("\x1b[31m");
  });
});

const sample: DoctorReport = {
  ts: "2026-06-19T00:00:00Z",
  healthy: false,
  gateway: { ok: true, detail: "mode=live" },
  ollama: { ok: false, detail: "ECONNREFUSED" },
  bridge: { ok: false, detail: "not running (macOS-only)" },
};

describe("formatDoctor", () => {
  it("json mode emits raw report", () => {
    expect(JSON.parse(formatDoctor(sample, { color: false, json: true }))).toEqual(sample);
  });
  it("human mode is plain and mentions degraded", () => {
    const out = formatDoctor(sample, { color: false, json: false });
    expect(out).toContain("gateway");
    expect(out).toContain("degraded");
    expect(out).not.toContain("\x1b["); // no color when disabled
  });
});

describe("streamFooter", () => {
  it("composes source, latency and tok/s", () => {
    const out = streamFooter({ source: "ollama_local", latencyMs: 120, tokensPerSec: 33.33 }, { color: false, json: false });
    expect(out).toBe("[ollama_local · 120ms · 33.3 tok/s]");
  });
});
