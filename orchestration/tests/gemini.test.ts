import { describe, it, expect } from "vitest";
import { isGeminiModel, geminiArgs, parseGeminiJson, isGeminiOverload } from "../bin/lib/gemini";

describe("isGeminiModel", () => {
  it("matches gemini tags, not ollama", () => {
    expect(isGeminiModel("gemini-2.5-flash")).toBe(true);
    expect(isGeminiModel("gemini-2.5-pro")).toBe(true);
    expect(isGeminiModel("qwen3-coder:30b")).toBe(false);
    expect(isGeminiModel("gpt-oss:120b-cloud")).toBe(false);
    expect(isGeminiModel("")).toBe(false);
  });
});

describe("geminiArgs", () => {
  it("builds headless read-only (plan) json args with trust bypass", () => {
    expect(geminiArgs("do x", "gemini-2.5-flash")).toEqual([
      "-p", "do x", "-m", "gemini-2.5-flash", "--approval-mode", "plan", "-o", "json", "--skip-trust",
    ]);
  });
  it("plan:false → default approval (not read-only)", () => {
    expect(geminiArgs("x", "gemini-2.5-flash", { plan: false })).toContain("default");
  });
  it("omits -m when model is empty", () => {
    expect(geminiArgs("x", "")).not.toContain("-m");
  });
});

describe("parseGeminiJson", () => {
  it("extracts .response from real output shape", () => {
    expect(parseGeminiJson(`{"session_id":"s","response":"PONG","stats":{}}`)).toEqual({ text: "PONG", ok: true });
  });
  it("tolerates leading noise before the JSON", () => {
    expect(parseGeminiJson(`[STARTUP] phase\nMCP issues detected.\n{"response":"hi"}`)).toEqual({ text: "hi", ok: true });
  });
  it("empty response → ok:false", () => {
    expect(parseGeminiJson(`{"response":""}`)).toEqual({ text: "", ok: false });
  });
  it("no JSON / unparseable → ok:false", () => {
    expect(parseGeminiJson("no json here")).toEqual({ text: "", ok: false });
    expect(parseGeminiJson("{broken")).toEqual({ text: "", ok: false });
  });
});

describe("isGeminiOverload", () => {
  it("detects transient overload signals", () => {
    expect(isGeminiOverload('{"error":{"code":503,"status":"UNAVAILABLE"}}')).toBe(true);
    expect(isGeminiOverload("This model is currently experiencing high demand")).toBe(true);
    expect(isGeminiOverload("RESOURCE_EXHAUSTED")).toBe(true);
    expect(isGeminiOverload("PONG")).toBe(false);
  });
});
