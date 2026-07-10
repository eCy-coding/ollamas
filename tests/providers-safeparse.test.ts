// M-007 (V4) — extractTextToolCalls (server/providers.ts:200-224) recovers tool
// calls emitted as TEXT by local models. Its inner `safeParse` (line 204) wraps
// JSON.parse in try/catch → returns undefined on malformed JSON so the ReAct loop
// falls back gracefully instead of throwing. These tests lock that: garbage JSON
// never crashes the extractor. Kod DEĞİŞMEZ (test-only, ⊘).
import { describe, test, expect } from "vitest";
import { extractTextToolCalls } from "../server/providers";

describe("extractTextToolCalls safeParse fallback (M-007)", () => {
  test("<function=NAME> with malformed body → call kept, arguments default {}", () => {
    const calls = extractTextToolCalls("<function=search>{ not: valid json ,,, }</function>");
    expect(calls).toBeDefined();
    expect(calls![0].name).toBe("search");
    expect(calls![0].arguments).toEqual({});
  });

  test("<tool_call> with unparseable JSON → no call, no throw (undefined)", () => {
    expect(() => extractTextToolCalls("<tool_call>{ oops broken</tool_call>")).not.toThrow();
    expect(extractTextToolCalls("<tool_call>{ oops broken</tool_call>")).toBeUndefined();
  });

  test("fenced ```json block with garbage → no call (undefined), no throw", () => {
    const txt = "```json\n{ this is : not, json }\n```";
    expect(() => extractTextToolCalls(txt)).not.toThrow();
    expect(extractTextToolCalls(txt)).toBeUndefined();
  });

  test("valid JSON still parses (guard does not over-reject)", () => {
    const calls = extractTextToolCalls('<function=echo>{"msg":"hi"}</function>');
    expect(calls![0]).toMatchObject({ name: "echo", arguments: { msg: "hi" } });
  });
});
