// Benchmark report builder (pure) — the reproducibility contract.
//
// WHY THIS EXISTS
// "No reproducibility metadata — benchmark runs lack hardware / software version tagging,
// breaking repeatability" is one of the prompt's listed gaps, and its output requirement is
// specific: every run emits a unique `run_id`, records environment metadata, and stores a
// complete `benchmark_report.json` in a versioned artefact store.
//
// The builder is pure and takes the environment as an ARGUMENT rather than reading `os`
// itself. A report builder that reads the clock and the hostname cannot be unit-tested for
// the one property that matters most here: that the same inputs always produce the same
// document (and therefore the same content hash).
import { createHash } from "node:crypto";
import type { Summary } from "./stats";
import type { Decision } from "./gates";

export interface EnvMeta {
  /** ISO-8601 UTC, supplied by the caller (the prompt requires ISO-8601 timestamps). */
  timestamp: string;
  run_id: string;
  git_sha: string;
  os: string;
  arch: string;
  cpu_count: number;
  mem_gb: number;
  node: string;
  /** Free-form: "docker 27.x", "brain :3000 up", … — what else was true during the run. */
  notes?: string[];
}

export interface StepRecord {
  id: string;
  action: string;
  ok: boolean;
  duration_ms: number;
  cpu_ms?: number;
  mem_bytes?: number;
  cache_hit?: boolean;
  error?: string;
  /** The exact invocation — a summary is not evidence. */
  invocation?: string;
  /** Trimmed raw output, so a claim can be checked without re-running. */
  output_excerpt?: string;
}

export interface RunReport {
  schema: "ecym-pipeline/benchmark_report@1";
  workflow_version: string;
  env: EnvMeta;
  profile: string;
  steps: StepRecord[];
  step_summaries: Record<string, Summary>;
  total: Summary;
  error_rate_pct: number;
  cache: { hits: number; misses: number; ratio: number };
  parallelism: number;
  decision: Decision;
  audit: { complete: boolean; missing: string[] };
  status: "complete" | "incomplete";
}

export interface BuildInput {
  workflow_version: string;
  env: EnvMeta;
  profile: string;
  steps: StepRecord[];
  step_summaries: Record<string, Summary>;
  total: Summary;
  cache: { hits: number; misses: number };
  parallelism: number;
  decision: Decision;
  audit: { complete: boolean; missing: string[] };
}

/**
 * Error rate over executed steps, as a percentage.
 *
 * Denominator is steps ATTEMPTED, not steps declared: if the DAG aborts early, dividing by
 * the full step count would shrink the rate exactly when things went most wrong.
 */
export function errorRatePct(steps: StepRecord[]): number {
  if (!steps.length) return 0;
  const bad = steps.filter((s) => !s.ok).length;
  return Number(((bad / steps.length) * 100).toFixed(4));
}

export function buildReport(i: BuildInput): RunReport {
  const total = i.cache.hits + i.cache.misses;
  return {
    schema: "ecym-pipeline/benchmark_report@1",
    workflow_version: i.workflow_version,
    env: i.env,
    profile: i.profile,
    steps: i.steps,
    step_summaries: i.step_summaries,
    total: i.total,
    error_rate_pct: errorRatePct(i.steps),
    cache: { ...i.cache, ratio: total ? Number((i.cache.hits / total).toFixed(3)) : 0 },
    parallelism: i.parallelism,
    decision: i.decision,
    audit: i.audit,
    // The prompt's self-audit rule: a run whose checklist has holes is reported as
    // "incomplete" even when every SLO passed. Green gates on an incomplete harness are
    // exactly the blind spot this pipeline exists to prevent.
    status: i.audit.complete && i.decision.go_ahead ? "complete" : "incomplete",
  };
}

/**
 * Content address for the artefact store.
 *
 * `env` is excluded from the hash on purpose: run_id and timestamp differ on every run, so
 * including them would make every report "new" and defeat the point of a content hash —
 * noticing that two runs produced IDENTICAL results.
 */
export function contentHash(r: RunReport): string {
  const { env: _env, ...rest } = r;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

/** `<profile>-<utc-compact>-<run_id8>-<sha256_12>.json` — sorts by time, dedups by content. */
export function artifactName(r: RunReport): string {
  // Strip separators, fractional seconds AND the trailing zone designator: the timestamp is
  // already UTC by contract, so a stray "Z" in the middle of a filename is noise that also
  // breaks lexical sorting against timestamps written with an explicit +00:00 offset.
  const stamp = r.env.timestamp
    .replace(/\.\d+/, "")
    .replace(/(Z|[+-]\d{2}:?\d{2})$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `${r.profile}-${stamp}-${r.env.run_id.slice(0, 8)}-${contentHash(r).slice(0, 12)}.json`;
}

/** Operator-facing summary. Numbers only — no adjectives that a reader has to trust. */
export function renderSummary(r: RunReport): string[] {
  const t = r.total;
  return [
    `run_id=${r.env.run_id}  profile=${r.profile}  workflow=v${r.workflow_version}`,
    `env: ${r.env.os}/${r.env.arch} cpu=${r.env.cpu_count} mem=${r.env.mem_gb}GB node=${r.env.node} git=${r.env.git_sha.slice(0, 8)}`,
    `total  p50=${t.p50}ms  p95=${t.p95}ms  p99=${t.p99}ms  p999=${t.p999}ms  cv=${t.cv}  n=${t.n}`,
    `steps=${r.steps.length}  error_rate=${r.error_rate_pct}%  cache_hit=${r.cache.ratio}  parallelism=${r.parallelism}x`,
    `decision: go_ahead=${r.decision.go_ahead}${r.decision.weak_evidence ? " (weak evidence)" : ""} — ${r.decision.reason}`,
    `status=${r.status}${r.audit.missing.length ? `  missing: ${r.audit.missing.join(", ")}` : ""}`,
  ];
}
