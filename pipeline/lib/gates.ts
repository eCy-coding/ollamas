// Quality gates + the binary decision (pure).
//
// WHY THIS EXISTS
// The prompt's `true_or_false` step must emit `true` ONLY if every SLO holds:
// p95(think) ≤ 350 ms, p95(sandbox) ≤ 2 s, error-rate < 0.1 %, coverage ≥ 90 %, and no
// high/critical security finding. In the original workflow `true_or_false` checked a single
// pass-threshold and nothing else — latency, resources and security could all regress while
// the pipeline reported success. That is the "no explicit SLO / quality-gate" gap the prompt
// itself lists.
//
// Every gate returns its measured value next to its limit. A gate that only says FAIL forces
// the operator to re-run the benchmark to find out by how much.
import type { Summary } from "./stats";

export interface Thresholds {
  latency_p95_think_ms: number;
  latency_p95_sandbox_ms: number;
  latency_p95_total_ms: number;
  error_rate_pct: number;
  coverage_min_pct: number;
  security_severity_block: string[];
  chaos_pass_threshold: number;
  /** Reject a decision built on too few / too noisy runs (see stats.runSetQuality). */
  min_runs: number;
  max_cv: number;
}

/** The prompt's stated numbers, kept in one place so the report and the gate cannot disagree. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  latency_p95_think_ms: 350,
  latency_p95_sandbox_ms: 2000,
  latency_p95_total_ms: 3000,
  error_rate_pct: 0.1,
  coverage_min_pct: 90,
  security_severity_block: ["high", "critical"],
  chaos_pass_threshold: 0.95,
  min_runs: 3,
  max_cv: 0.3,
};

export interface GateResult {
  name: string;
  ok: boolean;
  /** null when the input was absent — reported as SKIP, never silently as a pass. */
  measured: number | string | null;
  limit: number | string;
  detail?: string;
}

export interface Evidence {
  /** Per-step latency distributions, keyed by step id. */
  steps?: Record<string, Summary>;
  /** Whole-workflow latency distribution. */
  total?: Summary;
  errorRatePct?: number;
  coveragePct?: number;
  /** Findings as `{severity: count}`, lower-cased by the caller. */
  security?: Record<string, number>;
  /** Fraction of chaos iterations that still produced a correct result. */
  chaosSuccess?: number;
  /** Raw per-run totals, used to judge whether the sample is trustworthy at all. */
  totals?: number[];
}

/**
 * A missing measurement is NOT a pass.
 *
 * The single most dangerous failure mode for this gate is an absent input silently reading
 * as 0 and clearing a "≤" threshold — the pipeline would go green precisely when a step
 * crashed and produced nothing. Absent inputs therefore yield `ok: false` with
 * `measured: null`, which the reporter renders as SKIP/MISSING rather than PASS.
 */
function le(name: string, measured: number | undefined, limit: number, unit = "ms"): GateResult {
  if (measured === undefined || measured === null || !Number.isFinite(measured)) {
    return { name, ok: false, measured: null, limit, detail: `no measurement (${unit})` };
  }
  return { name, ok: measured <= limit, measured, limit, detail: `${measured}${unit} ≤ ${limit}${unit}` };
}

function ge(name: string, measured: number | undefined, limit: number, unit = "%"): GateResult {
  if (measured === undefined || measured === null || !Number.isFinite(measured)) {
    return { name, ok: false, measured: null, limit, detail: `no measurement (${unit})` };
  }
  return { name, ok: measured >= limit, measured, limit, detail: `${measured}${unit} ≥ ${limit}${unit}` };
}

/**
 * Evaluate every SLO. Step-latency gates are matched by step id PREFIX, because the prompt's
 * DAG contains `think`, `think_sandbox` and `think_final` — all of them are "think" for
 * budget purposes, and the worst of them is the one that must fit.
 */
export function evaluate(ev: Evidence, t: Thresholds = DEFAULT_THRESHOLDS): GateResult[] {
  const worstP95 = (prefix: string): number | undefined => {
    const hits = Object.entries(ev.steps ?? {})
      .filter(([id]) => id === prefix || id.startsWith(`${prefix}_`) || id.startsWith(`${prefix}-`))
      .map(([, s]) => s.p95);
    return hits.length ? Math.max(...hits) : undefined;
  };

  const out: GateResult[] = [
    le("p95(think)", worstP95("think"), t.latency_p95_think_ms),
    le("p95(sandbox_test)", worstP95("sandbox_test"), t.latency_p95_sandbox_ms),
    le("p95(total)", ev.total?.p95, t.latency_p95_total_ms),
    le("error_rate", ev.errorRatePct, t.error_rate_pct, "%"),
    ge("coverage", ev.coveragePct, t.coverage_min_pct),
  ];

  // Security is a count gate, not a threshold gate: one high finding is one too many.
  const blocked = t.security_severity_block
    .map((sev) => ({ sev, n: ev.security?.[sev] ?? 0 }))
    .filter((x) => x.n > 0);
  out.push({
    name: "security",
    ok: ev.security !== undefined && blocked.length === 0,
    measured: ev.security === undefined ? null : blocked.map((b) => `${b.sev}=${b.n}`).join(",") || "0",
    limit: `no ${t.security_severity_block.join("/")}`,
    detail: ev.security === undefined ? "scan did not run" : blocked.length ? "blocking findings present" : "clean",
  });

  // Chaos is only meaningful once it has actually been injected; absent ⇒ not a pass.
  out.push(
    ev.chaosSuccess === undefined
      ? { name: "chaos", ok: false, measured: null, limit: t.chaos_pass_threshold, detail: "chaos did not run" }
      : {
          name: "chaos",
          ok: ev.chaosSuccess >= t.chaos_pass_threshold,
          measured: Number(ev.chaosSuccess.toFixed(3)),
          limit: t.chaos_pass_threshold,
          detail: `success ${(ev.chaosSuccess * 100).toFixed(1)}% ≥ ${(t.chaos_pass_threshold * 100).toFixed(0)}%`,
        },
  );

  return out;
}

export interface Decision {
  go_ahead: boolean;
  gates: GateResult[];
  failed: string[];
  /** True when the SLOs pass but the sample behind them is too small or too noisy. */
  weak_evidence: boolean;
  reason: string;
}

/**
 * The `true_or_false` step. `go_ahead` is the AND of every gate — and it is deliberately
 * NOT relaxed when evidence is weak; instead `weak_evidence` is surfaced alongside, so a
 * green built on 1 noisy run is visibly green-with-an-asterisk rather than silently trusted.
 */
export function decide(ev: Evidence, t: Thresholds = DEFAULT_THRESHOLDS): Decision {
  const gates = evaluate(ev, t);
  const failed = gates.filter((g) => !g.ok).map((g) => g.name);
  const totals = ev.totals ?? [];
  const n = totals.filter((v) => Number.isFinite(v)).length;
  const m = n ? totals.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(totals.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : 0;
  const cvv = m ? sd / m : 0;
  const weak = n < t.min_runs || cvv > t.max_cv;
  return {
    go_ahead: failed.length === 0,
    gates,
    failed,
    weak_evidence: weak,
    reason: failed.length
      ? `failed: ${failed.join(", ")}`
      : weak
        ? `all gates pass but evidence is weak (n=${n}, cv=${cvv.toFixed(2)})`
        : "all gates pass",
  };
}

/** Fixed-width gate table for the CLI and the vault report. */
export function renderGates(gates: GateResult[]): string[] {
  return gates.map((g) => {
    const mark = g.ok ? "PASS" : g.measured === null ? "MISS" : "FAIL";
    return `  ${mark}  ${g.name.padEnd(18)} ${String(g.measured ?? "—").padStart(10)}  (limit ${g.limit})`;
  });
}
