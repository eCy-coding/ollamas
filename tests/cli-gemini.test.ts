/**
 * Pure-core tests for cli/lib/gemini.ts — zero IO (no `gemini` binary needed).
 * Covers the headless bridge contract: argv build, exit-code map, json/stream-json
 * parsing tolerance, and auth-mode detection. Hand-written cases (cli zero-dep, no proptest).
 */
import { describe, it, expect } from "vitest";
import {
  buildGeminiArgs, mapExitCode, exitHint, parseGeminiJson, foldStreamJson, detectAuthMode,
} from "../cli/lib/gemini";

describe("buildGeminiArgs", () => {
  it("prompt is the last (positional) token", () => {
    const a = buildGeminiArgs({ prompt: "hello" });
    expect(a[a.length - 1]).toBe("hello");
  });
  it("model + json format + include dirs", () => {
    const a = buildGeminiArgs({ prompt: "p", model: "gemini-3-flash", format: "json", includeDirs: ["/x", "/y"] });
    expect(a).toEqual(["--model", "gemini-3-flash", "--output-format", "json", "--include-directories", "/x", "--include-directories", "/y", "p"]);
  });
  it("yolo maps to --approval-mode=yolo (never the bare --yolo + --approval-mode clash)", () => {
    const a = buildGeminiArgs({ prompt: "p", yolo: true });
    expect(a).toContain("--approval-mode");
    expect(a[a.indexOf("--approval-mode") + 1]).toBe("yolo");
    expect(a).not.toContain("--yolo");
  });
  it("explicit approvalMode used when not yolo", () => {
    const a = buildGeminiArgs({ prompt: "p", approvalMode: "plan" });
    expect(a[a.indexOf("--approval-mode") + 1]).toBe("plan");
  });
});

describe("mapExitCode + exitHint", () => {
  it("0→success, 1→apiError, 42→inputError, 53→turnLimit, other→unknown", () => {
    expect(mapExitCode(0)).toEqual({ ok: true, kind: "success" });
    expect(mapExitCode(1)).toEqual({ ok: false, kind: "apiError" });
    expect(mapExitCode(42)).toEqual({ ok: false, kind: "inputError" });
    expect(mapExitCode(53)).toEqual({ ok: false, kind: "turnLimit" });
    expect(mapExitCode(137)).toEqual({ ok: false, kind: "unknown" });
    expect(mapExitCode(null)).toEqual({ ok: false, kind: "unknown" });
  });
  it("every kind has a non-empty hint", () => {
    for (const k of ["success", "apiError", "inputError", "turnLimit", "unknown"] as const) {
      expect(exitHint(k).length).toBeGreaterThan(0);
    }
  });
});

describe("parseGeminiJson (tolerant, never throws)", () => {
  it("valid object → response + stats + error", () => {
    const r = parseGeminiJson('{"response":"hi","stats":{"t":1},"error":{"message":"x"}}');
    expect(r?.response).toBe("hi");
    expect(r?.stats).toEqual({ t: 1 });
    expect(r?.error?.message).toBe("x");
  });
  it("missing response → empty string, not throw", () => {
    expect(parseGeminiJson('{"stats":{}}')?.response).toBe("");
  });
  it("malformed / empty / array → null", () => {
    expect(parseGeminiJson("not json")).toBeNull();
    expect(parseGeminiJson("")).toBeNull();
    expect(parseGeminiJson("   ")).toBeNull();
    expect(parseGeminiJson("[1,2]")).toBeNull();
  });
});

describe("foldStreamJson (JSONL)", () => {
  it("result event wins; counts tool_use; ignores malformed lines", () => {
    const jsonl = [
      '{"type":"init","model":"gemini-3"}',
      '{"type":"message","text":"thinking"}',
      'GARBAGE LINE',
      '{"type":"tool_use","name":"read_file"}',
      '{"type":"tool_result"}',
      '{"type":"result","response":"final answer"}',
    ].join("\n");
    const f = foldStreamJson(jsonl);
    expect(f.response).toBe("final answer");
    expect(f.toolCalls).toBe(1);
    expect(f.events.length).toBe(5); // garbage line skipped
  });
  it("no result → falls back to first message text", () => {
    expect(foldStreamJson('{"type":"message","text":"only msg"}').response).toBe("only msg");
  });
  it("empty input → empty, no throw", () => {
    expect(foldStreamJson("")).toEqual({ response: "", events: [], toolCalls: 0 });
  });
});

describe("detectAuthMode", () => {
  it("Vertex when GOOGLE_GENAI_USE_VERTEXAI=true", () => {
    expect(detectAuthMode({ GOOGLE_GENAI_USE_VERTEXAI: "true" } as any).mode).toBe("vertex");
  });
  it("api-key when GEMINI_API_KEY set", () => {
    expect(detectAuthMode({ GEMINI_API_KEY: "k" } as any).mode).toBe("api-key");
  });
  it("oauth by default (no env)", () => {
    expect(detectAuthMode({} as any).mode).toBe("oauth");
  });
});
