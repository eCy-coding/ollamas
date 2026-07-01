import { describe, it, expect } from "vitest";
import {
  providerFor, isOpenerStep, looksLikeChrome, classifyChromeRun, buildRow, renderChromeProbe,
  type DispatchReport,
} from "../bin/lib/chrome-probe";

describe("providerFor — cloud vs local routing", () => {
  it("routes cloud tags to ollama-cloud", () => {
    for (const m of ["gpt-oss:20b-cloud", "qwen3-coder:480b-cloud", "kimi-k2.5:cloud"]) {
      expect(providerFor(m)).toBe("ollama-cloud");
    }
  });
  it("routes plain local tags to ollama-local", () => {
    for (const m of ["qwen3:8b", "qwen3-coder:30b", "deepseek-r1:32b", "phi4:latest"]) {
      expect(providerFor(m)).toBe("ollama-local");
    }
  });
});

describe("isOpenerStep — successful shell tool = opener", () => {
  it("true for a successful macos_terminal / run_command step", () => {
    expect(isOpenerStep({ tool: "macos_terminal", ok: true })).toBe(true);
    expect(isOpenerStep({ tool: "run_command", ok: true })).toBe(true);
  });
  it("false for a failed shell step or a non-shell tool", () => {
    expect(isOpenerStep({ tool: "macos_terminal", ok: false })).toBe(false);
    expect(isOpenerStep({ tool: "read_file", ok: true })).toBe(false);
    expect(isOpenerStep(undefined)).toBe(false);
  });
});

describe("looksLikeChrome — proof enrichment", () => {
  it("matches chrome-ish text", () => {
    expect(looksLikeChrome('open -a "Google Chrome"')).toBe(true);
    expect(looksLikeChrome("Google Chrome is running")).toBe(true);
  });
  it("does not match unrelated text", () => {
    expect(looksLikeChrome("hello world")).toBe(false);
    expect(looksLikeChrome(undefined)).toBe(false);
  });
});

describe("classifyChromeRun — capability decision", () => {
  it("capable: shell ok + DONE verdict, not demo", () => {
    const r: DispatchReport = {
      steps: [{ n: 1, tool: "macos_terminal", ok: true, out: "" }],
      messages: ["VERDICT: DONE Chrome opened"],
      verdict: "DONE",
      demoSuspected: false,
    };
    const c = classifyChromeRun(r);
    expect(c.capable).toBe(true);
    expect(c.calledOpener).toBe(true);
    expect(c.openerOk).toBe(true);
    expect(c.proof).toContain("Chrome opened");
  });

  it("NOT capable: demo/no-tool run even with a chatty DONE message", () => {
    const r: DispatchReport = {
      steps: [],
      messages: ["Sure, I opened Chrome. VERDICT: DONE"],
      verdict: "DONE",
      demoSuspected: true,
    };
    const c = classifyChromeRun(r);
    expect(c.capable).toBe(false);
    expect(c.calledOpener).toBe(false);
    expect(c.proof).toBe("Sure, I opened Chrome. VERDICT: DONE");
  });

  it("NOT capable: shell step failed", () => {
    const r: DispatchReport = {
      steps: [{ n: 1, tool: "macos_terminal", ok: false, out: "command not found" }],
      messages: ["VERDICT: BLOCKED"],
      verdict: "BLOCKED",
    };
    const c = classifyChromeRun(r);
    expect(c.capable).toBe(false);
    expect(c.calledOpener).toBe(true);
    expect(c.openerOk).toBe(false);
  });

  it("NOT capable: only non-shell tools called (INCOMPLETE)", () => {
    const r: DispatchReport = {
      steps: [{ n: 1, tool: "read_file", ok: true }],
      messages: [],
      verdict: "INCOMPLETE",
    };
    const c = classifyChromeRun(r);
    expect(c.capable).toBe(false);
    expect(c.calledOpener).toBe(false);
  });

  it("defaults verdict to INCOMPLETE when absent", () => {
    expect(classifyChromeRun({}).verdict).toBe("INCOMPLETE");
    expect(classifyChromeRun({}).capable).toBe(false);
  });
});

describe("buildRow + renderChromeProbe", () => {
  const rows = [
    buildRow("qwen3:8b", { steps: [{ n: 1, tool: "macos_terminal", ok: true }], messages: ["VERDICT: DONE"], verdict: "DONE" }),
    buildRow("gpt-oss:20b-cloud", { steps: [], messages: ["chatty"], verdict: "INCOMPLETE", demoSuspected: true }),
  ];

  it("buildRow attaches model + provider", () => {
    expect(rows[0].model).toBe("qwen3:8b");
    expect(rows[0].provider).toBe("ollama-local");
    expect(rows[1].provider).toBe("ollama-cloud");
    expect(rows[0].capable).toBe(true);
    expect(rows[1].capable).toBe(false);
  });

  it("render shows the count, table and ethics section", () => {
    const md = renderChromeProbe(rows, "2026-07-02T00:00:00Z");
    expect(md).toContain("# CHROME_PROBE.md");
    expect(md).toContain("Result: 1/2 models opened Chrome");
    expect(md).toContain("`qwen3:8b`");
    expect(md).toContain("**✅ YES**");
    expect(md).toContain("Ethics");
    expect(md).toContain("explicitly requested");
  });

  it("render escapes pipe chars in proof so the table stays valid", () => {
    const r = [buildRow("m", { steps: [{ n: 1, tool: "macos_terminal", ok: true }], messages: ["a | b | c DONE"], verdict: "OK" })];
    expect(renderChromeProbe(r, "t")).toContain("a \\| b \\| c DONE");
  });
});
