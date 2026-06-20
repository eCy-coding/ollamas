// vC1 P3 — triage pipeline. Hermetic: GenFn is injected (no live Gemini).

import { describe, test, expect } from "vitest";
import {
  extractJson,
  parseVerdict,
  parseRefutation,
  triageFinding,
  renderReport,
  type GenFn,
  type Finding,
} from "../bugfix/triage";

const F: Finding = { source: "semgrep", file: "tests/bugfix-triage.test.ts", line: 1, rule: "r", severity: "warning", message: "m" };

/** Scripted GenFn: returns queued responses in order (triage, then refute). */
function scriptedGen(...responses: string[]): GenFn {
  let i = 0;
  return async () => ({ text: responses[i++] ?? "{}" });
}

describe("extractJson", () => {
  test("pulls JSON out of fenced/prose text", () => {
    expect(extractJson('here:\n```json\n{"a":1}\n``` done')).toEqual({ a: 1 });
  });
  test("returns null on no/invalid json", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{not valid}")).toBeNull();
  });
});

describe("parseVerdict / parseRefutation", () => {
  test("verdict defaults severity to low and coerces", () => {
    expect(parseVerdict('{"isReal":true,"severity":"bogus","rootCause":"rc","proposedFix":"pf"}')).toEqual({
      isReal: true,
      severity: "low",
      rootCause: "rc",
      proposedFix: "pf",
    });
  });
  test("unparseable refutation is conservatively refuted", () => {
    expect(parseRefutation("garbage")).toEqual({ refuted: true, reason: "unparseable verifier response" });
  });
});

describe("triageFinding — implementer ≠ verifier", () => {
  test("kept when real AND not refuted", async () => {
    const gen = scriptedGen(
      '{"isReal":true,"severity":"high","rootCause":"rc","proposedFix":"pf"}',
      '{"refuted":false,"reason":"genuinely exploitable"}'
    );
    const t = await triageFinding(process.cwd(), F, gen);
    expect(t.kept).toBe(true);
    expect(t.verdict.severity).toBe("high");
  });

  test("dropped when verifier refutes a real-looking claim", async () => {
    const gen = scriptedGen(
      '{"isReal":true,"severity":"medium","rootCause":"rc","proposedFix":"pf"}',
      '{"refuted":true,"reason":"input is always trusted here"}'
    );
    const t = await triageFinding(process.cwd(), F, gen);
    expect(t.kept).toBe(false);
    expect(t.refutation.refuted).toBe(true);
  });

  test("dropped when triage says not-real (no refute call needed)", async () => {
    const gen = scriptedGen('{"isReal":false}');
    const t = await triageFinding(process.cwd(), F, gen);
    expect(t.kept).toBe(false);
    expect(t.refutation.reason).toMatch(/not-real/);
  });
});

describe("renderReport", () => {
  test("groups kept (severity-ordered) and dropped", async () => {
    const triaged = [
      { ...F, verdict: { isReal: true, severity: "low" as const, rootCause: "a", proposedFix: "x" }, refutation: { refuted: false, reason: "" }, kept: true },
      { ...F, verdict: { isReal: true, severity: "high" as const, rootCause: "b", proposedFix: "y" }, refutation: { refuted: false, reason: "" }, kept: true },
      { ...F, verdict: { isReal: false, severity: "low" as const, rootCause: "", proposedFix: "" }, refutation: { refuted: true, reason: "fp" }, kept: false },
    ];
    const md = renderReport(triaged);
    expect(md).toContain("doğrulanmış: 2");
    expect(md).toContain("elenen: 1");
    // HIGH must come before LOW in the kept section.
    expect(md.indexOf("[HIGH]")).toBeLessThan(md.indexOf("[LOW]"));
    expect(md).toContain("— fp");
  });
});
