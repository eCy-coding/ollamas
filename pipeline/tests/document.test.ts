import { describe, it, expect } from "vitest";
import {
  buildDocument, validateDocument, isValid, renderIssues, citations,
  REQUIRED_KEYS, THOUGHT_PHASES, GAP_SECTIONS,
  type BuildDocumentInput, type PipelineDocument,
} from "../lib/document";
import { DEFAULT_THRESHOLDS } from "../lib/gates";

const meta = {
  run_id: "abcd", timestamp: "2026-07-24T14:00:00Z", workflow_version: "4.0",
  profile: "simple", git_sha: "deadbeef", status: "complete" as const,
};

const bench = {
  metrics: ["duration_histogram", "cpu_seconds"],
  percentiles: ["p50", "p95", "p99", "p999"],
  runs_per_config: 5,
  warmup_per_config: 1,
  load_models: { closed_loop: { max_concurrency: 2 }, open_loop: { arrival_rate_rps: 1 } },
  tools: { load_generator: "pipeline/lib/loadgen.ts", observability: "prom-client" },
  quality_gates: DEFAULT_THRESHOLDS,
};

const input = (over: Partial<BuildDocumentInput> = {}): BuildDocumentInput => ({
  meta,
  search_results: [{ title: "k6", url: "https://github.com/grafana/k6/", snippet: "load testing", ref_id: 2 }],
  thoughts: { research: "r", planning: "p", development: "d", verification: "v", production: "pr" },
  analysis: {
    research_gaps: [{ issue: "no caching", severity: "high", evidence: "[1]" }],
    planning_gaps: [], development_gaps: [], verification_gaps: [], production_gaps: [],
  },
  dag: [{ id: "search", action: "search", output: "search_results" }],
  todo_board: [{ id: "T1", description: "x", owner: "ci", estimate_h: 2, status: "todo" }],
  benchmark_configuration: bench,
  ci_cd_yaml: "name: pipeline\non: [push]\n",
  references: [{ ref_id: 1, title: "DSA", url: "https://example.com/a" }],
  ...over,
});

describe("buildDocument", () => {
  it("always produces all eight required keys", () => {
    const d = buildDocument(input());
    for (const k of REQUIRED_KEYS) expect(d).toHaveProperty(k);
    expect(d.schema).toBe("ecym-pipeline/document@1");
  });

  // Empty is a claim ("we looked, found none"); absent means nobody looked. The builder
  // guarantees shape so validation can distinguish the two.
  it("fills absent sections with empty values of the right shape", () => {
    const d = buildDocument(input({ thoughts: undefined, analysis: undefined, search_results: undefined, todo_board: undefined, references: undefined }));
    for (const p of THOUGHT_PHASES) expect(d.thoughts[p]).toBe("");
    for (const s of GAP_SECTIONS) expect(d.analysis[s]).toEqual([]);
    expect(d.search_results).toEqual([]);
    expect(d.todo_board).toEqual([]);
    expect(d.references).toEqual([]);
  });

  it("embeds the DAG under plan.dag", () => {
    expect(buildDocument(input()).plan.dag[0].id).toBe("search");
  });

  it("keeps a partially-supplied thoughts object and fills only the rest", () => {
    const d = buildDocument(input({ thoughts: { research: "only this" } }));
    expect(d.thoughts.research).toBe("only this");
    expect(d.thoughts.production).toBe("");
  });
});

describe("citations", () => {
  it("extracts every [n] index", () => {
    expect(citations("per [1] and [12], not [x]")).toEqual([1, 12]);
    expect(citations("")).toEqual([]);
    expect(citations(undefined as never)).toEqual([]);
  });
});

describe("validateDocument", () => {
  const errs = (d: unknown) => validateDocument(d).filter((i) => i.level === "error");
  const keysOf = (d: unknown) => errs(d).map((i) => i.key);

  it("accepts a well-formed document", () => {
    const issues = validateDocument(buildDocument(input()));
    expect(isValid(issues)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isValid(validateDocument(null))).toBe(false);
    expect(validateDocument("x")[0].key).toBe("document");
  });

  it("reports each missing required key by name", () => {
    const d = buildDocument(input()) as unknown as Record<string, unknown>;
    delete d.todo_board;
    delete d.ci_cd_yaml;
    expect(keysOf(d)).toEqual(expect.arrayContaining(["todo_board", "ci_cd_yaml"]));
  });

  // The prompt requires ISO-8601 UTC explicitly.
  it("rejects a non ISO-8601 timestamp", () => {
    const d = buildDocument(input({ meta: { ...meta, timestamp: "24/07/2026 14:00" } }));
    expect(keysOf(d)).toContain("meta.timestamp");
  });

  it("accepts an offset timestamp as well as Z", () => {
    const d = buildDocument(input({ meta: { ...meta, timestamp: "2026-07-24T14:00:00+03:00" } }));
    expect(keysOf(d)).not.toContain("meta.timestamp");
  });

  // The single most important check: a citation that points nowhere makes the whole
  // "evidence-based" claim hollow.
  it("rejects a citation that resolves to nothing", () => {
    const d = buildDocument(input({
      analysis: { research_gaps: [{ issue: "x", severity: "high", evidence: "[9]" }], planning_gaps: [], development_gaps: [], verification_gaps: [], production_gaps: [] },
    }));
    const e = errs(d).find((i) => i.key.includes("evidence"));
    expect(e?.message).toMatch(/\[9\] does not resolve/);
  });

  it("resolves citations against search_results as well as references", () => {
    const d = buildDocument(input({
      analysis: { research_gaps: [{ issue: "x", severity: "low", evidence: "[2]" }], planning_gaps: [], development_gaps: [], verification_gaps: [], production_gaps: [] },
    }));
    expect(isValid(validateDocument(d))).toBe(true); // ref_id 2 comes from search_results
  });

  it("rejects a gap with no citation at all — an unsourced finding is an opinion", () => {
    const d = buildDocument(input({
      analysis: { research_gaps: [{ issue: "x", severity: "high", evidence: "" }], planning_gaps: [], development_gaps: [], verification_gaps: [], production_gaps: [] },
    }));
    expect(errs(d).some((i) => i.message.includes("no citation"))).toBe(true);
  });

  it("rejects a severity outside the schema", () => {
    const d = buildDocument(input({
      analysis: { research_gaps: [{ issue: "x", severity: "catastrophic" as never, evidence: "[1]" }], planning_gaps: [], development_gaps: [], verification_gaps: [], production_gaps: [] },
    }));
    expect(errs(d).some((i) => i.message.includes("invalid severity"))).toBe(true);
  });

  it("rejects duplicate reference ids — a citation must be unambiguous", () => {
    const d = buildDocument(input({
      references: [{ ref_id: 1, title: "a", url: "u1" }, { ref_id: 1, title: "b", url: "u2" }],
    }));
    expect(errs(d).some((i) => i.message.includes("duplicate ref_id"))).toBe(true);
  });

  it("rejects an empty plan.dag", () => {
    expect(keysOf(buildDocument(input({ dag: [] })))).toContain("plan.dag");
  });

  it("rejects a non-numeric quality gate", () => {
    const d = buildDocument(input({
      benchmark_configuration: { ...bench, quality_gates: { ...DEFAULT_THRESHOLDS, coverage_min_pct: "90" as never } },
    }));
    expect(errs(d).some((i) => i.key.includes("coverage_min_pct"))).toBe(true);
  });

  it("allows array-valued gates (security_severity_block) without complaint", () => {
    expect(isValid(validateDocument(buildDocument(input())))).toBe(true);
  });

  it("rejects an empty ci_cd_yaml", () => {
    expect(keysOf(buildDocument(input({ ci_cd_yaml: "   " })))).toContain("ci_cd_yaml");
  });

  // Emptiness is reported but must not block: a run with no network legitimately has no
  // search results, and that has to be sayable without failing.
  it("treats empty sections as warnings, not errors", () => {
    const d = buildDocument(input({ search_results: [], references: [], thoughts: {} }));
    const issues = validateDocument(d);
    expect(issues.some((i) => i.level === "warn" && i.key === "search_results")).toBe(true);
    expect(issues.some((i) => i.level === "warn" && i.key === "thoughts.research")).toBe(true);
    expect(issues.filter((i) => i.level === "error").map((x) => x.key)).not.toContain("search_results");
  });

  it("flags a missing thoughts phase as an error, unlike an empty one", () => {
    const d = buildDocument(input()) as PipelineDocument;
    delete (d.thoughts as unknown as Record<string, unknown>).production;
    expect(keysOf(d)).toContain("thoughts.production");
  });

  it("flags a gap section that is not an array", () => {
    const d = buildDocument(input()) as unknown as Record<string, Record<string, unknown>>;
    d.analysis.development_gaps = "nope";
    expect(keysOf(d)).toContain("analysis.development_gaps");
  });

  it("flags todo entries missing id or a numeric estimate", () => {
    const d = buildDocument(input({ todo_board: [{ id: "", description: "x", owner: "o", estimate_h: "2" as never, status: "todo" }] }));
    const k = keysOf(d);
    expect(k).toContain("todo_board[0].id");
    expect(k).toContain("todo_board[0].estimate_h");
  });
});

describe("renderIssues", () => {
  it("counts first, then lists errors before warnings", () => {
    const d = buildDocument(input({ search_results: [], dag: [] }));
    const lines = renderIssues(validateDocument(d));
    expect(lines[0]).toMatch(/^document: \d+ error\(s\), \d+ warning\(s\)$/);
    expect(lines.find((l) => l.includes("ERROR"))).toBeTruthy();
    const firstWarn = lines.findIndex((l) => l.includes("warn "));
    const lastErr = lines.map((l) => l.includes("ERROR")).lastIndexOf(true);
    expect(lastErr).toBeLessThan(firstWarn);
  });
});
