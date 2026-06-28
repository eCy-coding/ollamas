import { describe, it, expect } from "vitest";
import { computeGaps } from "../server/analyzer";
import { parseGitPorcelain } from "../server/files";

// S6: tool-gap report had 100% false positives (every tool flagged because no
// tool name equals "<name>.py"). Now only tools whose .py entryPoint is missing.
describe("analyzer computeGaps (S6)", () => {
  it("flags only tools whose .py entryPoint is missing from scripts", () => {
    const tools = {
      a: { entryPoint: "internal" },
      b: { entryPoint: "proxy" },
      c: { entryPoint: "foo.py" }, // missing
      d: { entryPoint: "bar.py" }, // present
    };
    expect(computeGaps(tools, ["bar.py"])).toEqual(["c"]);
  });
  it("no false positives when nothing is script-backed", () => {
    expect(computeGaps({ x: { entryPoint: "internal" }, y: { capability: "API" } }, ["hello.py"])).toEqual([]);
  });
});

// S8: git-status overlay collapsed the porcelain XY columns via substring(0,2).trim(),
// misclassifying staged changes and never producing "staged". Parse X and Y separately.
describe("files parseGitPorcelain (S8)", () => {
  it("classifies staged vs worktree vs untracked from the XY columns", () => {
    const out = [
      "A  added.ts", // staged add
      " M worktree.ts", // worktree-only modified
      "M  staged.ts", // staged modified
      "MM both.ts", // index + worktree
      "?? new.ts", // untracked
      "D  del.ts", // staged delete
    ].join("\n");
    const m = parseGitPorcelain(out);
    expect(m["added.ts"]).toBe("staged");
    expect(m["worktree.ts"]).toBe("modified");
    expect(m["staged.ts"]).toBe("staged");
    expect(m["both.ts"]).toBe("staged");
    expect(m["new.ts"]).toBe("untracked");
    expect(m["del.ts"]).toBe("staged");
  });
});
