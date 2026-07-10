// calibrate.test.ts — behavior of calibrate.ts's edit engine (the SEARCH/REPLACE core it applies to each
// grounded target). calibrate.ts wires model output → parseSearchReplace → applyEdits; the network/model
// call is the only IO. Here we assert the deterministic parse + apply contract that gates every fix.
import { describe, it, expect } from "vitest";
import { hasSearchReplace, parseSearchReplace, applyEdit, applyEdits } from "../bin/lib/search-replace";

const block = (search: string, replace: string, file?: string) =>
  `${file ? `### file: ${file}\n` : ""}<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe("calibrate/hasSearchReplace", () => {
  it("detects a well-formed block and rejects prose", () => {
    expect(hasSearchReplace(block("a", "b"))).toBe(true);
    expect(hasSearchReplace("no edit here, just chatter")).toBe(false);
    expect(hasSearchReplace("")).toBe(false);
  });
});

describe("calibrate/parseSearchReplace", () => {
  it("extracts search/replace bodies and an optional file header", () => {
    const edits = parseSearchReplace(block("const x = 1;", "const x = 2;", "src/a.ts"));
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ file: "src/a.ts", search: "const x = 1;", replace: "const x = 2;" });
  });
  it("dedupes exact-duplicate blocks (workers sometimes emit the proposal twice)", () => {
    const one = block("a", "b", "f.ts");
    expect(parseSearchReplace(`${one}\n${one}`)).toHaveLength(1);
  });
});

describe("calibrate/applyEdit", () => {
  it("swaps a uniquely-matching SEARCH for REPLACE", () => {
    const r = applyEdit("let a = 1;\nlet b = 2;", { search: "let b = 2;", replace: "let b = 3;" });
    expect(r.ok).toBe(true);
    expect(r.content).toBe("let a = 1;\nlet b = 3;");
  });
  it("fails without mutating when SEARCH is missing or ambiguous", () => {
    const stale = applyEdit("x", { search: "nope", replace: "y" });
    expect(stale.ok).toBe(false);
    expect(stale.content).toBe("x");
    const ambiguous = applyEdit("dup dup", { search: "dup", replace: "z" });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.content).toBe("dup dup");
  });
  it("treats an empty SEARCH as new-file only when the target is empty", () => {
    expect(applyEdit("", { search: "", replace: "hello" })).toMatchObject({ ok: true, content: "hello" });
    expect(applyEdit("existing", { search: "", replace: "hello" }).ok).toBe(false);
  });
});

describe("calibrate/applyEdits", () => {
  it("applies all edits sequentially (all-or-nothing, no partial write)", () => {
    const edits = [
      { search: "a", replace: "A" },
      { search: "b", replace: "B" },
    ];
    const r = applyEdits("a\nb", edits);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.content).toBe("A\nB");
  });
  it("aborts with the original content and reports the failing edit", () => {
    const r = applyEdits("a\nb", [{ search: "a", replace: "A" }, { search: "zzz", replace: "Z" }]);
    expect(r.ok).toBe(false);
    expect(r.content).toBe("a\nb");     // no partial write
    expect(r.failures).toHaveLength(1);
  });
});
