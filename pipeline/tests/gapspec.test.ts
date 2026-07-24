import { describe, it, expect } from "vitest";
import { extractGaps, normalizeSeverity, bySeverity, severityCounts } from "../lib/gapspec";

describe("normalizeSeverity", () => {
  it("accepts the schema values", () => {
    expect(normalizeSeverity("high")).toBe("high");
    expect(normalizeSeverity(" MEDIUM ")).toBe("medium");
  });

  // A short, auditable synonym list — not a fuzzy match that quietly upgrades a finding.
  it("maps only the documented synonyms", () => {
    expect(normalizeSeverity("critical")).toBe("high");
    expect(normalizeSeverity("minor")).toBe("low");
    expect(normalizeSeverity("moderate")).toBe("medium");
  });

  it("rejects anything else instead of guessing", () => {
    expect(normalizeSeverity("catastrophic")).toBeNull();
    expect(normalizeSeverity("")).toBeNull();
    expect(normalizeSeverity(undefined)).toBeNull();
    expect(normalizeSeverity(7)).toBeNull();
  });
});

describe("extractGaps — structured input", () => {
  it("parses a JSON array of gaps", () => {
    const r = extractGaps([
      { issue: "no caching", severity: "high", evidence: "[1]" },
      { issue: "cold start", severity: "medium", evidence: "[2]" },
    ]);
    expect(r.source).toBe("llm");
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]).toMatchObject({ issue: "no caching", severity: "high", evidence: "[1]", source: "llm" });
  });

  it("parses a fenced JSON block out of prose", () => {
    const r = extractGaps('Here you go:\n```json\n[{"issue":"no chaos test","severity":"high","evidence":"[3]"}]\n```\nHope that helps.');
    expect(r.source).toBe("llm");
    expect(r.gaps[0].issue).toBe("no chaos test");
  });

  it("accepts a {gaps:[...]} wrapper and alternate field names", () => {
    const r = extractGaps({ gaps: [{ gap: "no SLO", severity: "critical", ref: "[1]" }] });
    expect(r.gaps[0]).toMatchObject({ issue: "no SLO", severity: "high", evidence: "[1]" });
  });

  it("drops rows missing issue, severity or citation, and says how many", () => {
    const r = extractGaps([
      { issue: "ok one", severity: "low", evidence: "[1]" },
      { issue: "", severity: "high", evidence: "[1]" },
      { issue: "no severity", severity: "weird", evidence: "[1]" },
      { issue: "no citation", severity: "high", evidence: "see above" },
    ]);
    expect(r.gaps).toHaveLength(1);
    expect(r.reason).toMatch(/3 row\(s\) rejected/);
  });

  it("applies the default citation when a row omits one", () => {
    const r = extractGaps([{ issue: "missing evidence field", severity: "low" }], { defaultEvidence: "[4]" });
    expect(r.gaps[0].evidence).toBe("[4]");
    expect(r.source).toBe("llm");
  });

  it("honours the max cap", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ issue: `issue ${i}`, severity: "low", evidence: "[1]" }));
    expect(extractGaps(rows, { max: 3 }).gaps).toHaveLength(3);
  });
});

describe("extractGaps — deterministic fallback", () => {
  // The core rule: never manufacture a severity. Prose findings get `medium` and are LABELLED
  // deterministic, because an unverified severity must neither block a merge as `high` nor be
  // dismissed as `low`.
  it("falls back to prose findings marked deterministic with medium severity", () => {
    const r = extractGaps(
      "- The pipeline has no caching layer at all, so repeated work repeats latency\n" +
      "- Cold container starts dominate the sandbox step and inflate p99",
      { defaultEvidence: "[1]" },
    );
    expect(r.source).toBe("deterministic");
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps.every((g) => g.severity === "medium" && g.source === "deterministic")).toBe(true);
    expect(r.reason).toMatch(/prose/);
  });

  it("prefers a citation found inside the sentence over the default", () => {
    const r = extractGaps("Tail latency is what users feel, not the average [3], so p50 is misleading here.", { defaultEvidence: "[1]" });
    expect(r.gaps[0].evidence).toBe("[3]");
  });

  it("splits sentences when there are no bullets", () => {
    const r = extractGaps(
      "The system never measures coverage anywhere. Security scanning is entirely absent from the flow.",
      { defaultEvidence: "[1]" },
    );
    expect(r.gaps.length).toBeGreaterThanOrEqual(2);
  });

  it("drops fragments too short to be findings", () => {
    const r = extractGaps("- N/A\n- None.\n- ok", { defaultEvidence: "[1]" });
    expect(r.gaps).toHaveLength(0);
  });

  it("produces nothing citable when there is no citation anywhere", () => {
    const r = extractGaps("This is a long enough sentence about a real problem with no reference.");
    expect(r.gaps).toHaveLength(0);
    expect(r.reason).toMatch(/no citable finding/);
  });

  it("falls back when structured rows all fail validation", () => {
    const r = extractGaps([{ issue: "x", severity: "nope", evidence: "none" }], { defaultEvidence: "[1]" });
    expect(r.source).toBe("deterministic");
    expect(r.reason).toMatch(/no row passed validation/);
  });

  it("handles empty and nullish answers without throwing", () => {
    expect(extractGaps("").gaps).toEqual([]);
    expect(extractGaps(null).gaps).toEqual([]);
    expect(extractGaps(undefined).gaps).toEqual([]);
  });
});

describe("ordering and counting", () => {
  const gaps = [
    { issue: "c", severity: "low" as const, evidence: "[1]" },
    { issue: "a", severity: "high" as const, evidence: "[1]" },
    { issue: "b", severity: "medium" as const, evidence: "[1]" },
  ];

  it("sorts high → medium → low so blocking findings come first", () => {
    expect(bySeverity(gaps).map((g) => g.severity)).toEqual(["high", "medium", "low"]);
  });

  it("does not mutate the input", () => {
    bySeverity(gaps);
    expect(gaps[0].severity).toBe("low");
  });

  it("counts per severity", () => {
    expect(severityCounts(gaps)).toEqual({ high: 1, medium: 1, low: 1 });
    expect(severityCounts([])).toEqual({ high: 0, medium: 0, low: 0 });
  });
});
