import { describe, it, expect } from "vitest";
import { buildImportGraph } from "../brain-teach-datasets";
import { findOrphans, findUnusedExports } from "../brain-code-audit";

const files: [string, string][] = [
  ["server.ts", 'import { a } from "./server/used";'],
  ["server/used.ts", 'export function a() {}\nexport function neverUsed() {}'],
  ["server/orphan.ts", 'export function b() {}'],
  ["server/testonly.ts", "export function onlyTested() {}"],
  ["tests/x.test.ts", 'import { onlyTested } from "../server/testonly"; onlyTested();'],
];

describe("brain-code-audit", () => {
  it("import graph resolves relative specifiers both ways", () => {
    const { importers, imports } = buildImportGraph(files);
    expect([...(importers.get("server/used.ts") || [])]).toEqual(["server.ts"]);
    expect([...(imports.get("tests/x.test.ts") || [])]).toEqual(["server/testonly.ts"]);
  });
  it("orphans exclude entry points; unused vs test-only exports separate", () => {
    const { importers } = buildImportGraph(files);
    expect(findOrphans(files, importers)).toEqual(["server/orphan.ts"]); // server.ts + tests excluded
    const unused = findUnusedExports(files);
    expect(unused.find((u) => u.symbol === "neverUsed")?.testOnly).toBe(false);
    expect(unused.find((u) => u.symbol === "onlyTested")?.testOnly).toBe(true);
    expect(unused.find((u) => u.symbol === "a")).toBeUndefined(); // really used
  });
});
