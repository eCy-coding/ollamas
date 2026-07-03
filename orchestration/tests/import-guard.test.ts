import { describe, it, expect } from "vitest";
import { importSpecifiers, addedImportSpecifiers, isTypeOnlyRuntimeImport, isRelative } from "../bin/lib/import-guard";

describe("importSpecifiers", () => {
  it("extracts named, default, side-effect, require and dynamic imports", () => {
    const t = [
      `import { a } from "./x";`,
      `import def from '../y';`,
      `import "./side-effect.d.ts";`,
      `const z = require("node:fs");`,
      `const d = await import("./dyn.js");`,
    ].join("\n");
    expect(importSpecifiers(t)).toEqual(["./x", "../y", "./side-effect.d.ts", "node:fs", "./dyn.js"]);
  });
  it("returns [] for text with no imports", () => {
    expect(importSpecifiers("const a = 1;")).toEqual([]);
    expect(importSpecifiers("")).toEqual([]);
  });
});

describe("addedImportSpecifiers", () => {
  it("returns only imports present in after but not before (the mjs-migration class)", () => {
    const before = `#!/usr/bin/env node\n// agent-dispatch`;
    const after = `#!/usr/bin/env node\n// shim\nimport "./agent-dispatch.d.ts";\n// agent-dispatch`;
    expect(addedImportSpecifiers(before, after)).toEqual(["./agent-dispatch.d.ts"]);
  });
  it("ignores imports that already existed", () => {
    const before = `import { a } from "./x";`;
    const after = `import { a } from "./x";\nimport { b } from "./y";`;
    expect(addedImportSpecifiers(before, after)).toEqual(["./y"]);
  });
  it("no added imports → []", () => {
    expect(addedImportSpecifiers(`import "./x";`, `import "./x";\nconst a = 1;`)).toEqual([]);
  });
});

describe("isTypeOnlyRuntimeImport", () => {
  it("true for a .d.ts specifier (never runtime-loadable)", () => {
    expect(isTypeOnlyRuntimeImport("./agent-dispatch.d.ts")).toBe(true);
    expect(isTypeOnlyRuntimeImport("../types/foo.d.ts")).toBe(true);
  });
  it("false for real runtime modules", () => {
    expect(isTypeOnlyRuntimeImport("./x.ts")).toBe(false);
    expect(isTypeOnlyRuntimeImport("node:fs")).toBe(false);
  });
});

describe("isRelative", () => {
  it("true for ./ and ../, false for bare packages", () => {
    expect(isRelative("./x")).toBe(true);
    expect(isRelative("../y")).toBe(true);
    expect(isRelative("node:fs")).toBe(false);
    expect(isRelative("vitest")).toBe(false);
  });
});
