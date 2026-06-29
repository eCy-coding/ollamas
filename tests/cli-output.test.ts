import { describe, it, expect } from "vitest";
import { shouldColor, resolveOutputCtx, c, formatDoctor, streamFooter, formatStep, formatDiff, formatTable, sparkline, bar, compactNum, type DoctorReport } from "../cli/lib/output";

describe("sparkline", () => {
  it("maps a ramp onto the 8 block levels", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe("▁▂▃▄▅▆▇█");
  });
  it("empty → empty string", () => {
    expect(sparkline([])).toBe("");
  });
  it("single value or all-equal → flat mid line (not all-min)", () => {
    expect(sparkline([5])).toBe("▄");
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
  });
  it("min and max anchor the ends", () => {
    const s = sparkline([0, 100]);
    expect(s[0]).toBe("▁");
    expect(s[1]).toBe("█");
  });
});

describe("bar (gauge)", () => {
  it("renders fill proportional to fraction, clamped", () => {
    expect(bar(0, 4)).toBe("░░░░");
    expect(bar(0.5, 4)).toBe("██░░");
    expect(bar(1, 4)).toBe("████");
    expect(bar(2, 4)).toBe("████"); // clamp >1
    expect(bar(-1, 4)).toBe("░░░░"); // clamp <0
  });
});

describe("compactNum", () => {
  it("compacts thousands and millions", () => {
    expect(compactNum(999)).toBe("999");
    expect(compactNum(1200)).toBe("1.2k");
    expect(compactNum(12000)).toBe("12k");
    expect(compactNum(3_400_000)).toBe("3.4M");
  });
});

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
  ready: { ok: true, detail: "ready" },
  agent: { ok: true, detail: "sessions=2" },
  saas: { ok: true, detail: "skipped (no admin token)" },
  mcp: { ok: true, detail: "tools=22 upstreams=0" },
  gemini: { ok: true, detail: "binary absent (optional)" },
};

describe("formatDoctor", () => {
  it("json mode emits raw report", () => {
    expect(JSON.parse(formatDoctor(sample, { color: false, json: true }))).toEqual(sample);
  });
  it("human mode is plain and mentions degraded", () => {
    const out = formatDoctor(sample, { color: false, json: false });
    expect(out).toContain("gateway");
    expect(out).toContain("ready");
    expect(out).toContain("agent");
    expect(out).toContain("mcp");
    expect(out).toContain("degraded");
    expect(out).not.toContain("\x1b["); // no color when disabled
  });
});

describe("formatStep", () => {
  it("renders ok mark, step/tool and latency without color", () => {
    const out = formatStep({ stepNum: 2, tool: "run_command", ok: true, latency: 30 }, { color: false, json: false });
    expect(out).toContain("[2] run_command");
    expect(out).toContain("30ms");
    expect(out).toContain("✓");
    expect(out).not.toContain("\x1b[");
  });
  it("flags a diff/applied tag", () => {
    const out = formatStep({ stepNum: 1, tool: "write_file", ok: true, diff: "+a", applied: false }, { color: false, json: false });
    expect(out).toContain("(diff)");
  });
});

describe("formatDiff", () => {
  it("returns plain diff when color off", () => {
    expect(formatDiff("+a\n-b\n c", { color: false, json: false })).toBe("+a\n-b\n c");
  });
  it("colorizes +/- lines when color on", () => {
    const out = formatDiff("+a\n-b", { color: true, json: false });
    expect(out).toContain("\x1b[32m"); // green +
    expect(out).toContain("\x1b[31m"); // red -
  });
  it("empty diff → empty string", () => {
    expect(formatDiff("", { color: true, json: false })).toBe("");
  });
});

describe("formatTable", () => {
  it("aligns columns to the widest cell", () => {
    const out = formatTable(["id", "name"], [["a", "short"], ["bbbb", "x"]], { color: false, json: false });
    const lines = out.split("\n");
    expect(lines[0]).toBe("id    name");
    expect(lines[1]).toBe("a     short");
    expect(lines[2]).toBe("bbbb  x");
  });
  it("shows (empty) for no rows", () => {
    expect(formatTable(["id"], [], { color: false, json: false })).toContain("(empty)");
  });
});

describe("streamFooter", () => {
  it("composes source, latency and tok/s", () => {
    const out = streamFooter({ source: "ollama_local", latencyMs: 120, tokensPerSec: 33.33 }, { color: false, json: false });
    expect(out).toBe("[ollama_local · 120ms · 33.3 tok/s]");
  });
});
