import { describe, it, expect } from "vitest";
import { flattenTree, type FileItem } from "../server/files";

// H7: MCP resources/list did String(tree.tree) on a FileItem[] → "[object Object],..."
// so it never returned real files. flattenTree returns the actual file paths.
describe("flattenTree (H7)", () => {
  it("collects file relativePaths, recursing into dirs and skipping the dirs", () => {
    const tree: FileItem[] = [
      { name: "index.py", relativePath: "index.py", isDirectory: false },
      { name: "tests", relativePath: "tests", isDirectory: true, children: [
        { name: "test_basic.py", relativePath: "tests/test_basic.py", isDirectory: false },
      ] },
      { name: "README.md", relativePath: "README.md", isDirectory: false },
    ];
    expect(flattenTree(tree)).toEqual(["index.py", "tests/test_basic.py", "README.md"]);
  });

  it("never yields '[object Object]' (the bug)", () => {
    const out = flattenTree([{ name: "a", relativePath: "a.ts", isDirectory: false }]);
    expect(out.join(",")).not.toContain("[object Object]");
    expect(out).toEqual(["a.ts"]);
  });

  it("is defensive on non-array / empty input", () => {
    expect(flattenTree(undefined as any)).toEqual([]);
    expect(flattenTree("root/" as any)).toEqual([]);
    expect(flattenTree([])).toEqual([]);
  });
});
