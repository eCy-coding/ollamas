import { describe, it, expect } from "vitest";
import { parseSearchReplace, applyEdit, applyEdits, hasSearchReplace } from "../bin/lib/search-replace";

const BLOCK = `### file: start.sh
<<<<<<< SEARCH
set -euo pipefail
=======
set -euo pipefail
require_env PORT
>>>>>>> REPLACE`;

describe("parseSearchReplace", () => {
  it("parses a block with its file header", () => {
    const e = parseSearchReplace(BLOCK);
    expect(e).toHaveLength(1);
    expect(e[0].file).toBe("start.sh");
    expect(e[0].search).toBe("set -euo pipefail");
    expect(e[0].replace).toContain("require_env PORT");
  });
  it("parses multiple blocks", () => {
    const two = BLOCK + "\n\n### file: x.ts\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE";
    expect(parseSearchReplace(two)).toHaveLength(2);
  });
  it("returns [] with no blocks", () => { expect(parseSearchReplace("just prose")).toEqual([]); });
});

describe("applyEdit — exact unique match", () => {
  it("replaces a uniquely-matching snippet", () => {
    const r = applyEdit("a\nset -euo pipefail\nb", { search: "set -euo pipefail", replace: "set -euo pipefail\nrequire_env PORT" });
    expect(r.ok).toBe(true);
    expect(r.content).toContain("require_env PORT");
  });
  it("fails when the SEARCH snippet is not found", () => {
    const r = applyEdit("a\nb", { search: "not here", replace: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not found");
  });
  it("fails (no mutation) when the snippet is ambiguous", () => {
    const r = applyEdit("dup\ndup", { search: "dup", replace: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("ambiguous");
    expect(r.content).toBe("dup\ndup");
  });
  it("empty SEARCH creates a new file when target is empty, else fails", () => {
    expect(applyEdit("", { search: "", replace: "hello" })).toMatchObject({ ok: true, content: "hello" });
    expect(applyEdit("existing", { search: "", replace: "x" }).ok).toBe(false);
  });
});

describe("applyEdits — all-or-nothing", () => {
  it("applies every edit sequentially", () => {
    const r = applyEdits("const a = 1;\nconst b = 2;", [
      { search: "const a = 1;", replace: "const a = 10;" },
      { search: "const b = 2;", replace: "const b = 20;" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.content).toBe("const a = 10;\nconst b = 20;");
  });
  it("aborts with NO partial write on first failure", () => {
    const orig = "const a = 1;";
    const r = applyEdits(orig, [{ search: "const a = 1;", replace: "const a = 2;" }, { search: "nope", replace: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.content).toBe(orig); // reverted to original, no partial
    expect(r.failures[0].reason).toContain("not found");
  });
});

describe("hasSearchReplace", () => {
  it("detects a block", () => { expect(hasSearchReplace(BLOCK)).toBe(true); });
  it("false for a plain diff", () => { expect(hasSearchReplace("```diff\n--- a\n+++ b\n```")).toBe(false); });
});
