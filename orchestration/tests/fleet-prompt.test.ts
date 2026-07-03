import { describe, it, expect } from "vitest";
import { FOCUS, focusFile, streamTaskPrompt, geminiGroundedPrompt } from "../bin/lib/fleet-prompt";

describe("focusFile", () => {
  it("returns the target file before the ' — ' description", () => {
    expect(focusFile("errors-resilience")).toBe("server/agent-events.ts");
    expect(focusFile("shell-harden")).toBe("start.sh");
  });
  it("empty for an unknown stream", () => {
    expect(focusFile("nope")).toBe("");
  });
});

describe("streamTaskPrompt (ollama read_file flavor)", () => {
  const p = streamTaskPrompt("errors-resilience");
  it("instructs read_file of the focus target and forbids write", () => {
    expect(p).toContain('read_file "server/agent-events.ts"');
    expect(p).toContain("NEVER call write_file");
  });
  it("carries the SEARCH/REPLACE shape", () => {
    expect(p).toContain("<<<<<<< SEARCH");
    expect(p).toContain(">>>>>>> REPLACE");
    expect(p).toContain("VERDICT: DONE");
  });
});

describe("geminiGroundedPrompt (inlined content → exact SEARCH)", () => {
  const content = "line A\nexport function foo() { return 1; }\nline C";
  const p = geminiGroundedPrompt("errors-resilience", "server/agent-events.ts", content);
  it("inlines the exact file content between delimiters", () => {
    expect(p).toContain("--- BEGIN server/agent-events.ts ---");
    expect(p).toContain("export function foo() { return 1; }");
    expect(p).toContain("--- END server/agent-events.ts ---");
  });
  it("requires the SEARCH to be a verbatim copy of the content", () => {
    expect(p).toContain("EXACT, VERBATIM copy");
    expect(p).toContain("<<<<<<< SEARCH");
  });
  it("bounds the inlined window to maxLines", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `L${i}`).join("\n");
    const gp = geminiGroundedPrompt("x", "f.ts", big, { maxLines: 10 });
    expect(gp).toContain("… (truncated)");
    expect(gp).toContain("L9");
    expect(gp).not.toContain("L50");
  });
});

describe("FOCUS map", () => {
  it("covers the six streams", () => {
    expect(Object.keys(FOCUS)).toHaveLength(6);
  });
});
