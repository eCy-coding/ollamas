// Scripts domain v13 — TDD scaffold planner. Pure plan + slug guard (path-traversal
// blocked) + roadmap slug hint. File writes are the CLI's job (not tested here).
import { describe, test, expect } from "vitest";
import { validSlug, scaffoldPlan, roadmapNextSlug } from "../../bin/host-bridge/scaffold.mjs";

describe("scaffold core", () => {
  test("validSlug accepts kebab/snake, rejects traversal/slash/empty", () => {
    expect(validSlug("budget-meter")).toBe(true);
    expect(validSlug("watch_loop")).toBe(true);
    expect(validSlug("../etc/passwd")).toBe(false);
    expect(validSlug("a/b")).toBe(false);
    expect(validSlug("Foo")).toBe(false);
    expect(validSlug("")).toBe(false);
    expect(validSlug("1bad")).toBe(false);
  });

  test("scaffoldPlan emits test + lib at lane-convention paths", () => {
    const plan = scaffoldPlan("budget-meter");
    const paths = plan.map((f) => f.path);
    expect(paths).toContain("scripts/tests/budget-meter.test.ts");
    expect(paths).toContain("bin/host-bridge/lib/budget-meter.mjs");
    // camelCased export referenced in both stubs
    expect(plan.find((f) => f.path.endsWith(".mjs")).content).toContain("export function budgetMeter()");
    expect(plan.find((f) => f.path.endsWith(".test.ts")).content).toContain("budgetMeter");
  });

  test("--tool adds the 4-point registration checklist", () => {
    const plan = scaffoldPlan("usage2", { tool: true });
    const note = plan.find((f) => f.path === "__REGISTER_CHECKLIST__");
    expect(note).toBeTruthy();
    expect(note.content).toMatch(/inventory\.json/);
    expect(note.content).toMatch(/schema\.mjs/);
    expect(note.content).toMatch(/BUILDERS/);
  });

  test("scaffoldPlan throws on invalid slug (no traversal)", () => {
    expect(() => scaffoldPlan("../x")).toThrow(/invalid feature slug/);
  });

  test("roadmapNextSlug extracts lib/<slug> hint or null", () => {
    expect(roadmapNextSlug("ilk hamle = bin/host-bridge/lib/watch.mjs iskeleti")).toBe("watch");
    expect(roadmapNextSlug("no hint here")).toBe(null);
  });
});
