// Scripts domain v12 — auto-commit guard. The decision must stage only scope-owned
// files, BLOCK cross-lane tracked changes, and reject non-conventional messages.
import { describe, test, expect } from "vitest";
import { parsePorcelain, isInScope, isConventional, commitDecision } from "../../bin/host-bridge/lib/commit.mjs";

const MSG = "feat(scripts): v12 gate auto-commit";

describe("commit guard core", () => {
  test("parsePorcelain handles M/??/rename", () => {
    const txt = " M scripts/a.ts\n?? bin/host-bridge/new.mjs\nR  scripts/old.ts -> scripts/new.ts";
    const p = parsePorcelain(txt);
    expect(p).toEqual([
      { status: " M", path: "scripts/a.ts", tracked: true },
      { status: "??", path: "bin/host-bridge/new.mjs", tracked: false },
      { status: "R ", path: "scripts/new.ts", tracked: true },
    ]);
  });

  test("isInScope: scripts/bin/.github-workflows/Makefile yes; src/server/package.json no", () => {
    expect(isInScope("scripts/x.ts")).toBe(true);
    expect(isInScope("bin/host-bridge/gate.mjs")).toBe(true);
    expect(isInScope(".github/workflows/scripts-ci.yml")).toBe(true);
    expect(isInScope("Makefile")).toBe(true);
    expect(isInScope("src/App.tsx")).toBe(false);
    expect(isInScope("server/tool-registry.ts")).toBe(false);
    expect(isInScope("package.json")).toBe(false);
  });

  test("isConventional accepts spec, rejects junk", () => {
    expect(isConventional("feat(scripts): x")).toBe(true);
    expect(isConventional("fix: y")).toBe(true);
    expect(isConventional("refactor(bin)!: z")).toBe(true);
    expect(isConventional("updated stuff")).toBe(false);
    expect(isConventional("wip")).toBe(false);
    expect(isConventional("")).toBe(false);
  });

  test("decision OK stages only scope files; ignores untracked out-of-scope (node_modules)", () => {
    const txt = " M scripts/ROADMAP_SCRIPTS.md\n M bin/host-bridge/gate.mjs\n?? node_modules";
    const d = commitDecision(txt, MSG);
    expect(d.ok).toBe(true);
    expect(d.stage).toEqual(["scripts/ROADMAP_SCRIPTS.md", "bin/host-bridge/gate.mjs"]);
  });

  test("decision BLOCKS out-of-scope tracked change (cross-lane contamination)", () => {
    const txt = " M scripts/a.ts\n M server/tool-registry.ts";
    const d = commitDecision(txt, MSG);
    expect(d.ok).toBe(false);
    expect(d.violations).toContain("server/tool-registry.ts");
    expect(d.reason).toMatch(/contamination/);
  });

  test("decision BLOCKS non-conventional message", () => {
    const d = commitDecision(" M scripts/a.ts", "fixed things");
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/Conventional/);
  });

  test("decision BLOCKS empty stage (nothing in scope)", () => {
    const d = commitDecision("?? node_modules", MSG);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/nothing in scope/);
  });
});
