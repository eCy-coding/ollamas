// gen-catalog.test.ts — behavior of gen-catalog.ts pure core (taskable classifier + goal mapping).
import { describe, it, expect } from "vitest";
import { isTaskable, goalFor, MIN_LOC } from "../bin/lib/gen-catalog-core";

const bigExport = (extra = "") => `export const x = 1;\n${"// line\n".repeat(MIN_LOC)}${extra}`;

describe("gen-catalog/isTaskable", () => {
  it("keeps a substantial exported .ts/.tsx/.mjs source file", () => {
    expect(isTaskable("server/lib/a.ts", bigExport())).toBe(true);
    expect(isTaskable("src/Comp.tsx", bigExport())).toBe(true);
    expect(isTaskable("bin/host-bridge/b.mjs", bigExport())).toBe(true);
  });
  it("rejects wrong extensions", () => {
    expect(isTaskable("a.md", bigExport())).toBe(false);
    expect(isTaskable("a.json", bigExport())).toBe(false);
  });
  it("rejects tests, decls, and barrels", () => {
    expect(isTaskable("a.test.ts", bigExport())).toBe(false);
    expect(isTaskable("a.d.ts", bigExport())).toBe(false);
    expect(isTaskable("dir/index.ts", bigExport())).toBe(false);
    expect(isTaskable("dir/index.tsx", bigExport())).toBe(false);
  });
  it("rejects thin files (< MIN_LOC) and files with no export", () => {
    expect(isTaskable("a.ts", "export const x = 1;")).toBe(false);         // too few lines
    expect(isTaskable("a.ts", "const x = 1;\n".repeat(MIN_LOC + 5))).toBe(false); // no export
  });
});

describe("gen-catalog/goalFor", () => {
  it("maps file type/path to a deterministic additive goal", () => {
    expect(goalFor("src/C.tsx").goal).toMatch(/component/i);
    expect(goalFor("bin/x.mjs").goal).toMatch(/JSDoc/);
    expect(goalFor("server/lib/pure.ts").goal).toMatch(/unit test/i);
    expect(goalFor("server/route.ts").goal).toMatch(/JSDoc or an input-validation guard/);
  });
  it("always returns both goal and acceptance, and is stable for a given path", () => {
    const g = goalFor("src/lib/z.ts");
    expect(g.goal.length).toBeGreaterThan(0);
    expect(g.acceptance.length).toBeGreaterThan(0);
    expect(goalFor("src/lib/z.ts")).toEqual(g);
  });
});
