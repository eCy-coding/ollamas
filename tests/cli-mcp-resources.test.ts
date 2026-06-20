import { describe, it, expect } from "vitest";
import {
  renderResourceContents,
  renderPromptMessages,
  formatPromptSignature,
  promptArgsFromPairs,
  type McpPrompt,
} from "../cli/lib/mcp";

const ctx = { color: false } as any; // c() returns raw text when color is off

describe("renderResourceContents", () => {
  it("prints text contents raw", () => {
    expect(renderResourceContents({ contents: [{ uri: "f://a", text: "hello" }, { text: "world" }] })).toBe("hello\nworld");
  });
  it("summarizes a binary blob instead of dumping it", () => {
    const out = renderResourceContents({ contents: [{ blob: "QUJD", mimeType: "image/png" }] });
    expect(out).toContain("[blob image/png");
    expect(out).toContain("base64");
  });
  it("empty → empty string", () => {
    expect(renderResourceContents({})).toBe("");
  });
});

describe("renderPromptMessages", () => {
  it("renders the message chain as role: text with a description header", () => {
    const out = renderPromptMessages({
      description: "architect stage",
      messages: [
        { role: "system", content: { type: "text", text: "you are an architect" } },
        { role: "user", content: { type: "text", text: "design X" } },
      ],
    });
    expect(out).toBe("# architect stage\nsystem: you are an architect\nuser: design X");
  });
  it("tolerates a bare string content", () => {
    expect(renderPromptMessages({ messages: [{ role: "user", content: "hi" }] })).toBe("user: hi");
  });
});

describe("formatPromptSignature", () => {
  it("shows required bare and optional in [brackets]", () => {
    const p: McpPrompt = { name: "review", arguments: [{ name: "path", required: true }, { name: "depth" }] };
    expect(formatPromptSignature(p, ctx)).toBe("review(path, [depth])");
  });
  it("no args → name()", () => {
    expect(formatPromptSignature({ name: "ping" }, ctx)).toBe("ping()");
  });
});

describe("promptArgsFromPairs", () => {
  it("builds a string map (no schema coercion, unlike tool args)", () => {
    expect(promptArgsFromPairs(["path=src/x.ts", "depth=3"])).toEqual({ path: "src/x.ts", depth: "3" });
  });
  it("keeps '=' inside the value", () => {
    expect(promptArgsFromPairs(["q=a=b"])).toEqual({ q: "a=b" });
  });
  it("skips malformed pairs", () => {
    expect(promptArgsFromPairs(["noeq", "k=v"])).toEqual({ k: "v" });
  });
});
