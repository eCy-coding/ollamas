import { describe, it, expect } from "vitest";
import { orderStreams, buildPlan, renderBuildPlan, RECIPE, type GapLike } from "../bin/lib/build-plan";

const gap = (over: Partial<GapLike>): GapLike => ({
  kind: "language-migration", title: "t", severity: "P1", ownerStream: "mjs-migration",
  justification: "why", evidence: "ev", ...over,
});

describe("orderStreams — DEFAULT_DEPS dependency order, present-filtered", () => {
  it("orders present streams foundation-first (mjs-migration before typescript-core before errors-resilience)", () => {
    const o = orderStreams(["errors-resilience", "typescript-core", "mjs-migration"]);
    expect(o.indexOf("mjs-migration")).toBeLessThan(o.indexOf("typescript-core"));
    expect(o.indexOf("typescript-core")).toBeLessThan(o.indexOf("errors-resilience"));
  });
  it("keeps an unknown stream, last, without throwing", () => {
    const o = orderStreams(["typescript-core", "ghost-stream"]);
    expect(o[o.length - 1]).toBe("ghost-stream");
  });
});

describe("RECIPE — a fast/safe/correct recipe per gap kind", () => {
  it("covers every gap kind with approach + steps + verify", () => {
    for (const k of ["language-migration", "route-missing", "route-unused", "stub", "sparse-folder"] as const) {
      expect(RECIPE[k].approach.length).toBeGreaterThan(0);
      expect(RECIPE[k].steps.length).toBeGreaterThan(0);
      expect(RECIPE[k].verify.length).toBeGreaterThan(0);
    }
  });
  it("route-missing verifies reality before implementing (false-positive aware)", () => {
    expect(RECIPE["route-missing"].approach).toMatch(/verify|real|artifact/i);
  });
  it("route-unused never removes without confirming a consumer", () => {
    expect(RECIPE["route-unused"].verify).toMatch(/never removed without|confirm/i);
  });
  it("language-migration is in-place @ts-check (not a runtime-breaking rename of node entry-points)", () => {
    expect(RECIPE["language-migration"].approach).toMatch(/in-place|@ts-check|node-executed/i);
    expect(RECIPE["language-migration"].steps.join(" ")).toMatch(/@ts-check/);
    expect(RECIPE["language-migration"].steps.join(" ")).toMatch(/do not rename|not rename/i);
  });
});

describe("buildPlan — sectioned + dependency-ordered + severity-sorted", () => {
  const gaps: GapLike[] = [
    gap({ ownerStream: "errors-resilience", kind: "route-unused", severity: "P3", title: "unused" }),
    gap({ ownerStream: "typescript-core", kind: "route-missing", severity: "P1", title: "missing" }),
    gap({ ownerStream: "typescript-core", kind: "stub", severity: "P2", title: "stub" }),
    gap({ ownerStream: "mjs-migration", kind: "language-migration", severity: "P1", title: "mjs" }),
  ];
  const phases = buildPlan(gaps);

  it("makes one phase per stream in dependency order", () => {
    expect(phases.map((p) => p.stream)).toEqual(["mjs-migration", "typescript-core", "errors-resilience"]);
    expect(phases[0].order).toBe(1);
  });
  it("orders gaps within a phase by severity (P1 before P2)", () => {
    const tsPhase = phases.find((p) => p.stream === "typescript-core")!;
    expect(tsPhase.steps.map((s) => s.gap.severity)).toEqual(["P1", "P2"]);
  });
  it("attaches the matching recipe to each gap", () => {
    expect(phases[0].steps[0].recipe).toBe(RECIPE["language-migration"]);
  });
});

describe("renderBuildPlan", () => {
  const phases = buildPlan([
    gap({ ownerStream: "mjs-migration", kind: "language-migration", severity: "P1", title: "98 .mjs → TS" }),
    gap({ ownerStream: "typescript-core", kind: "route-missing", severity: "P1", title: "/api/ghost missing" }),
  ]);
  const md = renderBuildPlan(phases, "2026-07-02T00:00:00Z");

  it("renders ordered sections with per-step approach + verify + sequence rationale", () => {
    expect(md).toContain("# BUILD_PLAN.md");
    expect(md).toContain("T1 — Section: `mjs-migration`");
    expect(md).toContain("T2 — Section: `typescript-core`");
    expect(md).toContain("98 .mjs → TS");
    expect(md).toContain("Approach (fast/safe/correct)");
    expect(md).toContain("**Verify:**");
    expect(md).toContain("Sequence rationale");
  });
});
