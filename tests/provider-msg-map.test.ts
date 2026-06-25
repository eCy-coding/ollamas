// Faz11D D-003 — cross-provider message mappers. A ReAct history with an assistant
// tool-call turn + a tool result must serialize to each provider's tool shape; otherwise
// a tool result not preceded by the matching assistant tool_calls/tool_use → 400.
import { describe, it, expect } from "vitest";
import { toOpenAiMessages, toAnthropicMessages, toGeminiContents, type ProviderMessage } from "../server/providers";

const history: ProviderMessage[] = [
  { role: "user", content: "list files" },
  { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "grep_search", arguments: { query: "export function" } }] },
  { role: "tool", tool_call_id: "call_1", name: "grep_search", content: "f.ts:1: export function foo" },
];

describe("toOpenAiMessages (D-003)", () => {
  it("assistant tool_calls → OpenAI function shape; tool → role:tool + tool_call_id", () => {
    const m = toOpenAiMessages(history);
    expect(m[0]).toEqual({ role: "user", content: "list files" });
    expect(m[1].role).toBe("assistant");
    expect(m[1].tool_calls[0]).toEqual({
      id: "call_1", type: "function",
      function: { name: "grep_search", arguments: JSON.stringify({ query: "export function" }) },
    });
    expect(m[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "f.ts:1: export function foo" });
  });
  it("plain user/assistant-text history → no-op shape", () => {
    expect(toOpenAiMessages([{ role: "user", content: "hi" }])).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("toAnthropicMessages (D-003)", () => {
  it("assistant → tool_use block; tool → user tool_result block", () => {
    const m = toAnthropicMessages(history);
    expect(m[1].role).toBe("assistant");
    expect(m[1].content).toContainEqual({ type: "tool_use", id: "call_1", name: "grep_search", input: { query: "export function" } });
    expect(m[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "f.ts:1: export function foo" }] });
  });
});

describe("toGeminiContents (D-003)", () => {
  it("assistant → model functionCall; tool → user functionResponse; NO empty parts", () => {
    const c = toGeminiContents(history);
    expect(c[1]).toEqual({ role: "model", parts: [{ functionCall: { name: "grep_search", args: { query: "export function" } } }] });
    expect(c[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "grep_search", response: { result: "f.ts:1: export function foo" } } }] });
    for (const turn of c) for (const p of turn.parts) if ("text" in p) expect(String(p.text).length).toBeGreaterThan(0);
  });
});
