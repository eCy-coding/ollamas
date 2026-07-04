// gemini-run.test.ts — the pure seams bin/gemini-run.ts composes: CLI arg construction (read-only
// PROPOSE safety), JSON parse of a fake `gemini -o json` output, the overload-vs-quota classification
// that drives its retry/latch loop, and the --propose grounding (focusFile + geminiGroundedPrompt).
// Deeper lib edges live in gemini.test.ts / fleet-prompt.test.ts — this file tests the dispatch-level
// composition facts gemini-run.ts depends on.
import { describe, it, expect } from "vitest";
import { geminiArgs, parseGeminiJson, isGeminiOverload, isGeminiQuotaExhausted } from "../bin/lib/gemini";
import { focusFile, geminiGroundedPrompt, FOCUS } from "../bin/lib/fleet-prompt";

describe("geminiArgs — headless read-only invocation as dispatch() builds it", () => {
  it("default (plan) mode: prompt + model + plan approval + json + skip-trust, in order", () => {
    expect(geminiArgs("do the task", "gemini-2.5-flash")).toEqual([
      "-p", "do the task", "-m", "gemini-2.5-flash", "--approval-mode", "plan", "-o", "json", "--skip-trust",
    ]);
  });
  it("read-only is the DEFAULT — gemini-run never passes plan:false (PROPOSE safety)", () => {
    expect(geminiArgs("t", "m")).toContain("plan");
    expect(geminiArgs("t", "m")).not.toContain("default");
    expect(geminiArgs("t", "m", { plan: false })).toContain("default"); // opt-out exists but is explicit
  });
  it("empty model omits -m (CLI default model)", () => {
    const args = geminiArgs("t", "");
    expect(args).not.toContain("-m");
    expect(args[0]).toBe("-p");
  });
});

describe("parseGeminiJson — fake gemini CLI stdout", () => {
  const FAKE = 'Loaded cached credentials.\n{"session_id":"abc-123","response":"## Plan: add a guard\\nVERDICT: DONE","stats":{"tokens":42}}';
  it("tolerates leading non-JSON noise and extracts .response", () => {
    const g = parseGeminiJson(FAKE);
    expect(g.ok).toBe(true);
    expect(g.text).toContain("## Plan: add a guard");
    expect(g.text).toContain("VERDICT: DONE");
  });
  it("empty response field → ok:false (dispatch retries as 'empty gemini response')", () => {
    expect(parseGeminiJson('{"session_id":"x","response":""}').ok).toBe(false);
    expect(parseGeminiJson('{"session_id":"x","response":"   "}').ok).toBe(false);
  });
  it("no JSON object / unparseable → ok:false, never throws", () => {
    expect(parseGeminiJson("503 Service Unavailable")).toEqual({ text: "", ok: false });
    expect(parseGeminiJson("{not json")).toEqual({ text: "", ok: false });
    expect(parseGeminiJson("")).toEqual({ text: "", ok: false });
  });
});

describe("overload vs quota classification — the retry/latch fork in dispatch()", () => {
  const OVERLOAD_BLOBS = [
    "Error: 503 UNAVAILABLE", "the model is overloaded, try again", "high demand right now",
  ];
  const QUOTA_BLOBS = [
    "Error: 429 RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan",
    "daily quota reached for gemini-2.5-pro",
  ];
  it("503/high-demand → transient overload (retry with backoff)", () => {
    for (const b of OVERLOAD_BLOBS) expect(isGeminiOverload(b), b).toBe(true);
  });
  it("429/quota → terminal exhaustion (latch the day, fail fast — never backoff)", () => {
    for (const b of QUOTA_BLOBS) expect(isGeminiQuotaExhausted(b), b).toBe(true);
  });
  it("the two classes never overlap on their canonical signatures (quota is checked FIRST in dispatch)", () => {
    for (const b of OVERLOAD_BLOBS) expect(isGeminiQuotaExhausted(b), b).toBe(false);
    for (const b of QUOTA_BLOBS) expect(isGeminiOverload(b), b).toBe(false);
  });
  it("a plain non-transient error is neither (dispatch stops immediately)", () => {
    const b = "ENOENT: gemini binary not found";
    expect(isGeminiOverload(b)).toBe(false);
    expect(isGeminiQuotaExhausted(b)).toBe(false);
  });
});

describe("--propose grounding — focusFile + geminiGroundedPrompt composition", () => {
  it("focusFile resolves a stream to its bare target path (the file gemini-run inlines)", () => {
    expect(focusFile("errors-resilience")).toBe("server/agent-events.ts");
    expect(focusFile("shell-harden")).toBe("start.sh");
  });
  it("unknown stream → empty target (gemini-run exits 2 before dispatching)", () => {
    expect(focusFile("no-such-stream")).toBe("");
  });
  it("every FOCUS stream yields a non-empty target", () => {
    for (const s of Object.keys(FOCUS)) expect(focusFile(s).length, s).toBeGreaterThan(0);
  });

  const content = ["const a = 1;", "const b = 2;", "export const c = a + b;"].join("\n");
  const p = geminiGroundedPrompt("errors-resilience", "server/agent-events.ts", content);
  it("inlines the exact file content between BEGIN/END fences", () => {
    expect(p).toContain("--- BEGIN server/agent-events.ts ---");
    expect(p).toContain(content);
    expect(p).toContain("--- END server/agent-events.ts ---");
  });
  it("demands the apply-ready SEARCH/REPLACE shape fleet-apply triages", () => {
    expect(p).toContain("<<<<<<< SEARCH");
    expect(p).toContain(">>>>>>> REPLACE");
    expect(p).toContain("VERDICT: DONE");
  });
  it("bounds the inlined window (maxLines) and marks the truncation", () => {
    const big = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const bounded = geminiGroundedPrompt("errors-resilience", "t.ts", big, { maxLines: 10 });
    expect(bounded).toContain("line 9");
    expect(bounded).not.toContain("line 10\n");
    expect(bounded).toContain("… (truncated)");
  });
});
