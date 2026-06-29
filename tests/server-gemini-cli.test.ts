/**
 * Pure-core tests for server/gemini-cli.ts — the gemini-cli provider's prompt-flatten
 * and json-extract contract. Zero IO (no `gemini` binary). The spawn path
 * (generateViaGeminiCli/geminiCliAvailable) is thin-IO + env-gated (covered live in P5).
 */
import { describe, it, expect } from "vitest";
import { flattenForGemini, extractGeminiText } from "../server/gemini-cli";

describe("flattenForGemini", () => {
  it("system instruction precedes the user/assistant transcript", () => {
    const out = flattenForGemini([
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "fix the bug" },
    ]);
    expect(out.startsWith("be terse")).toBe(true);
    expect(out).toContain("User: hello");
    expect(out).toContain("Assistant: hi");
    expect(out).toContain("User: fix the bug");
  });
  it("drops tool turns; stringifies non-string content; total on junk", () => {
    expect(() => flattenForGemini(null as any)).not.toThrow();
    const out = flattenForGemini([
      { role: "tool", content: "tool result" },
      { role: "user", content: { parts: ["x"] } as any },
    ]);
    expect(out).not.toContain("tool result");
    expect(out).toContain('User: {"parts":["x"]}');
  });
  it("no system → just the transcript", () => {
    expect(flattenForGemini([{ role: "user", content: "q" }])).toBe("User: q");
  });
});

describe("extractGeminiText", () => {
  it("json {response} → the response", () => {
    expect(extractGeminiText('{"response":"the answer","stats":{}}')).toBe("the answer");
  });
  it("non-json → raw trimmed text", () => {
    expect(extractGeminiText("  plain text  ")).toBe("plain text");
  });
  it("json without response → raw fallback", () => {
    expect(extractGeminiText('{"stats":{}}')).toBe('{"stats":{}}');
  });
  it("empty → empty, never throws", () => {
    expect(extractGeminiText("")).toBe("");
    expect(extractGeminiText("   ")).toBe("");
  });
});
