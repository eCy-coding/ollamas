// Faz11C D-001 — flattenTreeFiles (MCP resources/list). getTree returns FileItem[];
// String(tree).split("\n") yielded "[object Object]" garbage resources. Flatten correctly.
import { describe, it, expect } from "vitest";
import { flattenTreeFiles, type FileItem } from "../server/files";

describe("flattenTreeFiles", () => {
  it("nested ağaç → düz non-dir relativePath listesi (dizinler hariç)", () => {
    const tree: FileItem[] = [
      { name: "a.ts", relativePath: "a.ts", isDirectory: false },
      {
        name: "sub", relativePath: "sub", isDirectory: true,
        children: [
          { name: "b.ts", relativePath: "sub/b.ts", isDirectory: false },
          {
            name: "deep", relativePath: "sub/deep", isDirectory: true,
            children: [{ name: "c.ts", relativePath: "sub/deep/c.ts", isDirectory: false }],
          },
        ],
      },
      { name: "README.md", relativePath: "README.md", isDirectory: false },
    ];
    expect(flattenTreeFiles(tree)).toEqual(["a.ts", "sub/b.ts", "sub/deep/c.ts", "README.md"]);
  });

  it("boş / children'sız dizin güvenli", () => {
    expect(flattenTreeFiles([])).toEqual([]);
    expect(flattenTreeFiles([{ name: "empty", relativePath: "empty", isDirectory: true }])).toEqual([]);
  });
});
