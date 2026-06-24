import { describe, it, expect } from "vitest";
import { repairJson, getToolArgError, TOOL_ARG_ERROR } from "../server/providers";

// CRITICAL-3: cross-provider tool-call robustness. Malformed model-emitted tool-call
// arguments must be repaired (json-repair patterns) or flagged with a sentinel so the
// ReAct loop can ask the model to re-emit — never silently run a tool with empty {} args.
describe("repairJson — model JSON repair (post JSON.parse-failure)", () => {
  it("passes valid JSON through unchanged", () => {
    expect(repairJson('{"ok":true,"n":2}')).toEqual({ ok: true, n: 2 });
  });
  it("strips code fences", () => {
    expect(repairJson('```json\n{"n":2}\n```')).toEqual({ n: 2 });
  });
  it("removes trailing commas", () => {
    expect(repairJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("escapes raw control chars in strings (Claude/Bedrock bug)", () => {
    expect(repairJson('{"cmd":"echo\nhi"}')).toEqual({ cmd: "echo\nhi" });
  });
  it("balances truncated objects/strings (streaming cutoff)", () => {
    expect(repairJson('{"path":"x.js"')).toEqual({ path: "x.js" });
    expect(repairJson('{"a":{"b":1')).toEqual({ a: { b: 1 } });
  });
  it("slices an object out of surrounding prose", () => {
    expect(repairJson('Sure! {"x":5} done')).toEqual({ x: 5 });
  });
  it("returns null for unrepairable garbage", () => {
    expect(repairJson("not json at all")).toBeNull();
    expect(repairJson("")).toBeNull();
  });
  it("returns null for non-string input", () => {
    expect(repairJson(null as any)).toBeNull();
    expect(repairJson(42 as any)).toBeNull();
  });
});

describe("getToolArgError — the malformed-args sentinel the loop checks", () => {
  it("detects the sentinel and returns its message", () => {
    expect(getToolArgError({ [TOOL_ARG_ERROR]: "bad json" })).toBe("bad json");
  });
  it("returns null for valid args (real tool calls run normally)", () => {
    expect(getToolArgError({ path: "x.js" })).toBeNull();
    expect(getToolArgError({})).toBeNull();
    expect(getToolArgError(null)).toBeNull();
    expect(getToolArgError("string")).toBeNull();
  });
});
