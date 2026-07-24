import { describe, it, expect } from "vitest";
import { validate, deriveDeps, order, batches, parallelismFactor, explain, DagError, type Pipeline } from "../lib/dag";

const step = (id: string, output: string, input?: string[], extra: Partial<Pipeline["steps"][0]> = {}) =>
  ({ id, action: id, output, input: input ?? null, ...extra });

const simple: Pipeline = {
  workflow_version: "3.0",
  steps: [
    step("search", "search_results"),
    step("think", "thoughts", ["search_results"], { parallel: true }),
    step("analyze", "analysis", ["search_results"], { parallel: true }),
    step("plan", "plan_outline", ["thoughts", "analysis"]),
  ],
};

describe("validate", () => {
  it("accepts a well-formed pipeline", () => {
    expect(() => validate(simple)).not.toThrow();
  });

  it("rejects an empty pipeline", () => {
    expect(() => validate({ workflow_version: "1", steps: [] })).toThrow(DagError);
    expect(() => validate(undefined as unknown as Pipeline)).toThrow(/no steps/);
  });

  it("rejects a step missing id / action / output", () => {
    expect(() => validate({ workflow_version: "1", steps: [{ action: "a", output: "o" } as never] })).toThrow(/without id/);
    expect(() => validate({ workflow_version: "1", steps: [{ id: "x", output: "o" } as never] })).toThrow(/missing action/);
    expect(() => validate({ workflow_version: "1", steps: [{ id: "x", action: "a" } as never] })).toThrow(/missing output/);
  });

  it("rejects duplicate ids", () => {
    const p: Pipeline = { workflow_version: "1", steps: [step("a", "o1"), step("a", "o2")] };
    expect(() => validate(p)).toThrow(/duplicate step id/);
  });

  // Two producers for one key makes dependency derivation ambiguous — the exact failure the
  // derived-deps design exists to avoid, so it must be loud.
  it("rejects two steps producing the same output key", () => {
    const p: Pipeline = { workflow_version: "1", steps: [step("a", "same"), step("b", "same")] };
    expect(() => validate(p)).toThrow(/produced by both/);
  });

  it("rejects an input key nobody produces", () => {
    const p: Pipeline = { workflow_version: "1", steps: [step("a", "o", ["ghost"])] };
    expect(() => validate(p)).toThrow(/has no producer/);
  });

  it("rejects a step reading its own output", () => {
    const p: Pipeline = { workflow_version: "1", steps: [step("a", "o", ["o"])] };
    expect(() => validate(p)).toThrow(/reads its own output/);
  });

  it("rejects unknown / self depends_on", () => {
    expect(() => validate({ workflow_version: "1", steps: [step("a", "o", null, { depends_on: ["nope"] })] }))
      .toThrow(/unknown step/);
    expect(() => validate({ workflow_version: "1", steps: [step("a", "o", null, { depends_on: ["a"] })] }))
      .toThrow(/depends on itself/);
  });
});

describe("deriveDeps", () => {
  it("derives edges from data keys", () => {
    const d = deriveDeps(simple);
    expect(d.get("search")).toEqual([]);
    expect(d.get("think")).toEqual(["search"]);
    expect(new Set(d.get("plan"))).toEqual(new Set(["think", "analyze"]));
  });

  it("merges explicit depends_on with data edges and de-duplicates", () => {
    const p: Pipeline = {
      workflow_version: "1",
      steps: [
        step("a", "ka"),
        step("b", "kb", ["ka"], { depends_on: ["a"] }), // same edge from both sources
        step("c", "kc", null, { depends_on: ["b"] }),   // pure control edge, no data
      ],
    };
    expect(deriveDeps(p).get("b")).toEqual(["a"]);
    expect(deriveDeps(p).get("c")).toEqual(["b"]);
  });
});

describe("order", () => {
  it("topologically orders steps deterministically", () => {
    const o = order(simple);
    expect(o[0]).toBe("search");
    expect(o.indexOf("plan")).toBe(3);
    expect(order(simple)).toEqual(o); // stable across calls
  });

  it("throws on a cycle", () => {
    const p: Pipeline = {
      workflow_version: "1",
      steps: [step("a", "ka", null, { depends_on: ["b"] }), step("b", "kb", null, { depends_on: ["a"] })],
    };
    expect(() => order(p)).toThrow(/cycle/);
  });
});

describe("batches", () => {
  it("groups independent steps into one wave and splits by the parallel flag", () => {
    const b = batches(simple);
    expect(b[0]).toEqual({ level: 0, parallel: [], serial: ["search"] });
    expect(b[1].parallel).toEqual(["think", "analyze"]);
    expect(b[1].serial).toEqual([]);
    expect(b[2].serial).toEqual(["plan"]);
  });

  // Independence alone must NOT imply concurrency: commit/push are independent of unrelated
  // branches yet must stay serial. The flag is the authority.
  it("keeps independent-but-unflagged steps serial", () => {
    const p: Pipeline = {
      workflow_version: "1",
      steps: [step("a", "ka"), step("b", "kb"), step("c", "kc")],
    };
    const b = batches(p);
    expect(b).toHaveLength(1);
    expect(b[0].parallel).toEqual([]);
    expect(b[0].serial).toEqual(["a", "b", "c"]);
  });
});

describe("parallelismFactor", () => {
  it("is 1 for a fully serial pipeline", () => {
    const p: Pipeline = { workflow_version: "1", steps: [step("a", "ka"), step("b", "kb", ["ka"])] };
    expect(parallelismFactor(p)).toBe(1);
  });

  it("exceeds 1 when a wave runs concurrently", () => {
    expect(parallelismFactor(simple)).toBeGreaterThan(1);
  });
});

describe("explain", () => {
  it("renders parallel and serial waves plus a summary line", () => {
    const lines = explain(simple);
    expect(lines.some((l) => l.includes("∥") && l.includes("think"))).toBe(true);
    expect(lines.at(-1)).toMatch(/steps=4 waves=3 parallelism=/);
  });
});
