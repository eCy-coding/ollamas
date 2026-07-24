// Self-audit (pure) — the "no blind-spots" checklist.
//
// WHY THIS EXISTS
// The prompt's closing instruction: "before finishing, run a self-audit that checks the
// checklist (observability, caching, parallelism, warm-pool, CI-gate, security, chaos,
// reproducibility). If any item is missing, add a corrective task to `todo_board` and flag
// the overall status as `incomplete`."
//
// The point is not a checkbox list — it is that a missing capability must COST something.
// Without this, a run that never injected a fault and never scanned for vulnerabilities
// still reports green, because absent evidence reads as absence of problems. Here each
// unmet item downgrades the run to `incomplete` AND materialises a task with an owner, so
// the gap is carried forward instead of forgotten.
export interface AuditFacts {
  /** Prometheus histograms actually observed for at least one step. */
  metricsObserved: boolean;
  /** Cache consulted (hit or miss both count — it means the path is wired). */
  cacheExercised: boolean;
  /** ≥1 wave ran more than one step concurrently. */
  parallelismUsed: boolean;
  /** sandbox_test borrowed from a pre-warmed pool rather than cold-starting. */
  warmPoolUsed: boolean;
  /** A quality gate can actually block (pre-commit hook / CI workflow present). */
  ciGatePresent: boolean;
  /** semgrep/bandit ran and returned a parsed result. */
  securityScanRan: boolean;
  /** Faults were injected and the decision re-evaluated under them. */
  chaosRan: boolean;
  /** Coverage measured (not assumed). */
  coverageMeasured: boolean;
  /** run_id + env metadata + content-hashed artefact were all written. */
  reproducibleArtifact: boolean;
  /** ≥ min_runs independent repetitions behind the reported percentiles. */
  repeatedRuns: boolean;
}

export interface TodoItem {
  id: string;
  description: string;
  owner: string;
  estimate_h: number;
  status: "todo";
}

interface Check {
  key: keyof AuditFacts;
  label: string;
  owner: string;
  estimate_h: number;
  fix: string;
}

// Owners mirror the prompt's own todo_board vocabulary (devops/infra/ci/observability/sec/qa)
// so a generated task lands in the same lane a human would have filed it in.
const CHECKS: Check[] = [
  { key: "metricsObserved", label: "observability", owner: "observability", estimate_h: 8,
    fix: "Emit workflow_step_duration_seconds/cpu/memory for every step (pipeline/lib/metrics.ts)" },
  { key: "cacheExercised", label: "caching", owner: "devops", estimate_h: 4,
    fix: "Wire the search/think cache (24 h TTL) — pipeline/lib/cache.ts is unused this run" },
  { key: "parallelismUsed", label: "parallelism", owner: "devops", estimate_h: 3,
    fix: "Mark independent steps `parallel: true`; the DAG ran fully serial" },
  { key: "warmPoolUsed", label: "warm-pool", owner: "infra", estimate_h: 6,
    fix: "Start the warm sandbox pool — cold starts dominate sandbox_test latency" },
  { key: "ciGatePresent", label: "CI-gate", owner: "ci", estimate_h: 5,
    fix: "Enforce the gate in CI/pre-commit so a regression blocks the merge" },
  { key: "securityScanRan", label: "security", owner: "sec", estimate_h: 3,
    fix: "Run semgrep + bandit before merge and block on high/critical" },
  { key: "chaosRan", label: "chaos", owner: "qa", estimate_h: 4,
    fix: "Inject latency + partition and re-check the binary decision" },
  { key: "coverageMeasured", label: "coverage", owner: "ci", estimate_h: 2,
    fix: "Produce coverage json-summary; the coverage gate had nothing to read" },
  { key: "reproducibleArtifact", label: "reproducibility", owner: "devops", estimate_h: 3,
    fix: "Write run_id + env metadata + content-hashed benchmark_report.json" },
  { key: "repeatedRuns", label: "repetition", owner: "qa", estimate_h: 2,
    fix: "Repeat each configuration ≥3 times; percentiles from a single run are noise" },
];

export interface AuditResult {
  complete: boolean;
  /** Checklist labels that failed — embedded in the report and rendered by the CLI. */
  missing: string[];
  satisfied: string[];
  todo: TodoItem[];
  score: string;
}

export function audit(f: Partial<AuditFacts>): AuditResult {
  const missing: string[] = [];
  const satisfied: string[] = [];
  const todo: TodoItem[] = [];
  CHECKS.forEach((c, i) => {
    // Absent facts count as MISSING, never as satisfied: the auditor's whole job is to refuse
    // to infer that something happened just because nothing said it did not.
    if (f[c.key] === true) {
      satisfied.push(c.label);
    } else {
      missing.push(c.label);
      todo.push({
        id: `A${i + 1}`,
        description: `${c.label}: ${c.fix}`,
        owner: c.owner,
        estimate_h: c.estimate_h,
        status: "todo",
      });
    }
  });
  return {
    complete: missing.length === 0,
    missing,
    satisfied,
    todo,
    score: `${satisfied.length}/${CHECKS.length}`,
  };
}

/** Checklist view for the CLI and the vault note. */
export function renderAudit(r: AuditResult): string[] {
  const set = new Set(r.satisfied);
  return [
    ...CHECKS.map((c) => `  ${set.has(c.label) ? "✓" : "✗"} ${c.label}`),
    `  self-audit ${r.score}${r.complete ? " — no blind spots" : ` — ${r.missing.length} corrective task(s) filed`}`,
  ];
}

export { CHECKS as AUDIT_CHECKS };
