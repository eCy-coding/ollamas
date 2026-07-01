import { describe, test, expect } from "vitest";
import { parseSSEBuffer } from "../cli/lib/client";

// parseSSEBuffer (cli/lib/client.ts:24) — pure SSE frame parser: splits on "\n\n", the last (possibly
// incomplete) chunk is returned as `rest`; each complete chunk's `data:` lines are JSON.parsed; malformed
// frames are ignored. (test-coverage stream — the proposal, now real code.)
describe("parseSSEBuffer — pure SSE framing", () => {
  test("parses multiple complete events, keeps the partial trailing chunk as rest", () => {
    const { events, rest } = parseSSEBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    expect(rest).toBe('data: {"c"');
  });

  test("empty buffer → no events, empty rest", () => {
    expect(parseSSEBuffer("")).toEqual({ events: [], rest: "" });
  });

  test("a single complete event followed by \\n\\n → parsed, rest empty", () => {
    const { events, rest } = parseSSEBuffer('data: {"ok":true}\n\n');
    expect(events).toEqual([{ ok: true }]);
    expect(rest).toBe("");
  });

  test("malformed JSON frame is ignored, valid frames still parse", () => {
    const { events } = parseSSEBuffer("data: not-json\n\ndata: {\"n\":5}\n\n");
    expect(events).toEqual([{ n: 5 }]);
  });

  test("non-data lines and blank data payloads are skipped", () => {
    const { events } = parseSSEBuffer("event: step\ndata: {\"s\":1}\n\ndata:\n\n");
    expect(events).toEqual([{ s: 1 }]);
  });

  test("leading whitespace before data: is tolerated (trimStart)", () => {
    const { events } = parseSSEBuffer("   data: {\"w\":9}\n\n");
    expect(events).toEqual([{ w: 9 }]);
  });
});
