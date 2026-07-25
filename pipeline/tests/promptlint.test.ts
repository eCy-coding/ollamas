import { describe, it, expect } from "vitest";
import { extractRefs, lintPrompt, isGrounded, renderLint, type PromptRef } from "../lib/promptlint";

describe("extractRefs", () => {
  it("finds repo paths, home paths and urls; dedups; ignores prose", () => {
    const refs = extractRefs(
      "Use pipeline/lib/htmlsite.ts and ~/ollamas-vault/_bin/cckb, see https://code.claude.com/docs. Again pipeline/lib/htmlsite.ts.",
    );
    const byKind = (k: string) => refs.filter((r) => r.kind === k).map((r) => r.value);
    expect(byKind("path")).toEqual(["pipeline/lib/htmlsite.ts"]); // deduped
    expect(byKind("home")).toEqual(["~/ollamas-vault/_bin/cckb"]);
    expect(byKind("url")).toEqual(["https://code.claude.com/docs"]);
  });

  it("strips trailing punctuation and ignores extension-less words", () => {
    const refs = extractRefs("run orchestrator.py, and the plan.");
    expect(refs.find((r) => r.value === "orchestrator.py")).toBeUndefined(); // no slash → not a path token
    expect(extractRefs("see server/routes/mcp.ts.").some((r) => r.value === "server/routes/mcp.ts")).toBe(true);
  });

  it("handles empty/nullish input", () => {
    expect(extractRefs("")).toEqual([]);
    expect(extractRefs(null as never)).toEqual([]);
  });
});

describe("lintPrompt + isGrounded", () => {
  const real = new Set(["pipeline/lib/htmlsite.ts", "~/ollamas-vault/_bin/cckb"]);
  const isReal = (r: PromptRef) => real.has(r.value);

  it("errors on a path that does not exist (fiction), passes a real one", () => {
    const issues = lintPrompt("real pipeline/lib/htmlsite.ts, fake orchestrator/main.py", isReal);
    expect(issues.some((i) => i.level === "error" && i.ref === "orchestrator/main.py")).toBe(true);
    expect(issues.some((i) => i.ref === "pipeline/lib/htmlsite.ts")).toBe(false);
    expect(isGrounded(issues)).toBe(false);
  });

  it("warns (not errors) on urls, and a fully-real prompt is grounded", () => {
    const issues = lintPrompt("~/ollamas-vault/_bin/cckb and https://x.y/z", isReal);
    expect(issues.every((i) => i.level === "warn")).toBe(true);
    expect(isGrounded(issues)).toBe(true);
  });

  it("skips templated refs (a pattern, not a literal file claim)", () => {
    const issues = lintPrompt("output to ~/ollamas-vault/_help/<system>/<system>-help.docx", isReal);
    expect(issues).toEqual([]); // no fiction — it's a template
  });
});

describe("renderLint", () => {
  it("counts fiction + unverified urls and lists errors", () => {
    const issues = lintPrompt("bad a/b.py and https://x.y", () => false);
    const lines = renderLint("eCym.md", issues);
    expect(lines[0]).toMatch(/eCym\.md: 1 fiction · 1 unverified-url/);
    expect(lines.some((l) => l.includes("HATA  a/b.py"))).toBe(true);
  });
});
