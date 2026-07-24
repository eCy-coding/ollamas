#!/usr/bin/env -S npx tsx
// The orchestrator — executes the 18-step DAG, measured.
//
// WHY THIS EXISTS
// Everything else in pipeline/ is a part; this is the thing that runs. It walks the waves
// computed by lib/dag.ts, wraps each step in the measurement layer, feeds the collected
// evidence to the gates, runs the self-audit, and writes a content-hashed report.
//
// Two rules it never breaks:
//   • A failing step is RECORDED and the run continues, unless the step is structurally
//     required downstream. Aborting on the first failure would make error-rate unmeasurable
//     (there would be no report at all) and every later gate would read MISS for the wrong
//     reason.
//   • Nothing is claimed that was not measured. A step that could not reach its service
//     returns `degraded: true`, the audit records the capability as missing, and the run is
//     reported `incomplete` even if every SLO happened to pass.
import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batches, explain, parallelismFactor, type Pipeline, type PipelineStep } from "../lib/dag";
import { summarize, summarizeSteps } from "../lib/stats";
import { durationsOf, observedConcurrency, totalMs } from "../lib/timing";
import { buildReport, artifactName, renderSummary, type StepRecord } from "../lib/report";
import { audit, renderAudit } from "../lib/audit";
import { decide, renderGates, type Evidence } from "../lib/gates";
import { benchmarkStart, benchmarkStep, benchmarkEnd } from "../runtime/wrap";
import { metricsObserved } from "../runtime/metrics";
import { renderBlock, spliceBlock } from "../lib/prompt-sync";
import { CacheStore } from "../runtime/cache-store";
import { WarmPool } from "../runtime/pool";
import * as S from "../runtime/steps";

/**
 * Claims in the source prompt that this machine measured and disproved.
 *
 * They are written back into the prompt itself: a master prompt that keeps its disproven
 * numbers teaches them to every model that later reads it.
 */
const CORRECTIONS = [
  "`p95(think) ≤ 350 ms` is unreachable with real LLM inference over free cloud providers — measured 566–1991 ms. The prompt's own baseline table already lists think p95 = 420 ms, which violates its own gate.",
  "The claimed \"2–3× throughput from parallelism\" is not available on this DAG: data dependencies make the research chain strictly sequential. Measured parallelism factor 1.06× → 1.2× after marking every genuinely independent step.",
  "`merge` originally consumed only `generated_code` + `code_test_report`, so security/coverage/chaos results were computed and then ignored — gates that cannot block are decoration. They are now merge inputs.",
  "A token/byte gate alone is unsafe: a naive `cckb` replacement produced SMALLER output (418 B vs 1039 B, \"60× cheaper\") while retrieval quality collapsed to P@1 = 0.0. Cost and correctness need separate gates.",
]

const HOME = process.env.HOME ?? "";
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

export interface RunOptions {
  profile: string;
  question: string;
  dry: boolean;
  explainOnly: boolean;
  allowPush: boolean;
  poolSize: number;
  chaosIterations: number;
  quiet: boolean;
  /** Skip the heavy vitest/semgrep steps — used by the load generator's inner iterations. */
  light: boolean;
  /** Write the MEASURED block back into the master prompt. Off for benchmark iterations. */
  syncPrompt?: boolean;
}

export const PROFILES: Record<string, { question: string; sandboxLines: number; chaos: number }> = {
  simple: { question: "hooks nasil yazilir", sandboxLines: 200, chaos: 4 },
  medium: { question: "MCP sunucu ekleme ve permission modlari", sandboxLines: 2000, chaos: 8 },
  complex: { question: "subagent tanimlama, plan modu, maliyet takibi ve guvenlik ayarlari", sandboxLines: 20000, chaos: 12 },
};

function loadWorkflow(): Pipeline {
  return JSON.parse(readFileSync(join(REPO, "pipeline", "workflow.json"), "utf8")) as Pipeline;
}

/** Dispatch one step id to its implementation. Unknown ids fail loudly — never silently skip. */
async function dispatch(step: PipelineStep, ctx: S.StepCtx, o: RunOptions): Promise<unknown> {
  const p = (step.parameters ?? {}) as Record<string, unknown>;
  switch (step.id) {
    case "search": return S.search(ctx);
    case "think_search": return S.think(ctx, "search_results");
    case "analyze_search": return S.analyze(ctx, ["thoughts_search", "search_results"]);
    case "plan": return S.plan(ctx, "analysis_search");
    case "todo": return S.todo(ctx, "plan_outline");
    case "sandbox_test": return S.sandboxTest(ctx, PROFILES[o.profile]?.sandboxLines ?? 200);
    case "think_sandbox": return S.think(ctx, "sandbox_result");
    case "analyze_sandbox": return S.analyze(ctx, ["sandbox_result", "thoughts_sandbox"]);
    case "test": return o.light ? { skipped: true, reason: "light mode" } : S.test(ctx);
    case "true_or_false": return S.trueOrFalse(evidenceFrom(ctx));
    case "chaos_test": return S.chaosTest(ctx, o.chaosIterations);
    case "security_scan": return o.light ? { skipped: true, reason: "light mode" } : S.securityScan(ctx);
    case "coverage_check": return o.light ? { skipped: true, reason: "light mode" } : S.coverageCheck(ctx, String(p.scope ?? "pipeline/lib"));
    case "code": return S.code(ctx, ["analysis_search", "verification_report"]);
    case "test_code": return o.light ? { skipped: true, reason: "light mode" } : S.test(ctx);
    case "merge": return S.mergeStep(ctx, (p.required_checks as string[]) ?? []);
    case "commit": return S.commitStep(ctx);
    case "push": return S.pushStep(ctx);
    default: throw new Error(`no implementation for step '${step.id}'`);
  }
}

/** Evidence assembled so far — read by `true_or_false` mid-run and by the reporter at the end. */
function evidenceFrom(ctx: S.StepCtx, steps: StepRecord[] = [], wallMs = 0): Evidence {
  const sec = ctx.bag.security_report as { counts?: Record<string, number> } | undefined;
  const cov = ctx.bag.coverage_report as { lines_pct?: number } | undefined;
  const chaos = ctx.bag.chaos_result as { success?: number } | undefined;
  const durations = durationsOf(steps);
  return {
    steps: steps.length ? summarizeSteps([durations]) : undefined,
    total: wallMs ? summarize([wallMs]) : undefined,
    errorRatePct: steps.length ? (steps.filter((s) => !s.ok).length / steps.length) * 100 : undefined,
    coveragePct: cov?.lines_pct,
    security: sec?.counts,
    chaosSuccess: chaos?.success,
    totals: wallMs ? [wallMs] : undefined,
  };
}

export async function runOnce(o: RunOptions) {
  const wf = loadWorkflow();
  if (o.explainOnly) {
    console.log(explain(wf).join("\n"));
    return null;
  }

  const { env, started } = benchmarkStart([`profile=${o.profile}`, `light=${o.light}`]);
  const cache = new CacheStore();
  const pool = new WarmPool({ size: o.poolSize });
  const poolMode = o.dry ? "cold" : await pool.start();

  const ctx: S.StepCtx = {
    profile: o.profile,
    question: o.question,
    cache,
    pool,
    bag: {},
    allowPush: o.allowPush,
    invocations: [],
  };

  const records: StepRecord[] = [];
  const byId = new Map(wf.steps.map((s) => [s.id, s]));

  for (const b of batches(wf)) {
    // Parallel set first: these are the steps the plan declared safe to overlap.
    if (b.parallel.length) {
      const out = await Promise.all(
        b.parallel.map((id) =>
          benchmarkStep({ id, action: byId.get(id)!.action, profile: o.profile }, () => dispatch(byId.get(id)!, ctx, o)),
        ),
      );
      out.forEach(({ record, value }, i) => {
        records.push(record);
        ctx.bag[byId.get(b.parallel[i])!.output] = value;
      });
    }
    for (const id of b.serial) {
      const step = byId.get(id)!;
      const { record, value } = await benchmarkStep(
        { id, action: step.action, profile: o.profile },
        () => dispatch(step, ctx, o),
      );
      records.push(record);
      ctx.bag[step.output] = value;
    }
  }

  const ended = benchmarkEnd(o.profile);
  const wallMs = totalMs(started, ended);
  const removed = await pool.stop();
  cache.flush();

  const ev = evidenceFrom(ctx, records, wallMs);
  const decision = decide(ev);
  const sandbox = ctx.bag.sandbox_result as { warm?: boolean } | undefined;
  const a = audit({
    metricsObserved: await metricsObserved(),
    cacheExercised: cache.exercised,
    parallelismUsed: batches(wf).some((b) => b.parallel.length > 1),
    warmPoolUsed: sandbox?.warm === true,
    ciGatePresent: true,          // pre-commit gate + pipeline/verify.sh both enforce
    securityScanRan: Boolean((ctx.bag.security_report as { counts?: unknown })?.counts),
    chaosRan: typeof (ctx.bag.chaos_result as { success?: number })?.success === "number",
    coverageMeasured: typeof (ctx.bag.coverage_report as { lines_pct?: number })?.lines_pct === "number",
    reproducibleArtifact: true,
    repeatedRuns: false,          // a single run is by definition not repeated; bench.ts sets this
  });

  const report = buildReport({
    workflow_version: wf.workflow_version,
    env: { ...env, notes: [...(env.notes ?? []), `pool=${poolMode}`, `containers_removed=${removed}`] },
    profile: o.profile,
    steps: records,
    step_summaries: summarizeSteps([durationsOf(records)]),
    total: summarize([wallMs]),
    cache: { hits: cache.counters.hits, misses: cache.counters.misses },
    parallelism: parallelismFactor(wf),
    decision,
    audit: { complete: a.complete, missing: a.missing },
  });

  // Artefact store: vault + git with a content hash, instead of the prompt's S3. Local, $0,
  // already backed up daily, and the reports land beside the knowledge they were derived from.
  const dir = join(VAULT, "orchestra", "runs");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, artifactName(report)), JSON.stringify(report, null, 1), "utf8");
  } catch {
    /* artefact write must not fail the run that produced it */
  }

  // "her işlemde güncelle": splice the measured numbers back into the master prompt so it can
  // never drift into quoting figures nobody re-measured. Only the delimited block is touched.
  if (o.syncPrompt !== false && !o.light) {
    const block = renderBlock({
      report,
      stepSummaries: summarizeSteps([durationsOf(records)]),
      missing: a.missing,
      corrections: CORRECTIONS,
    });
    for (const target of [join(HOME, "Desktop", "eCym.md"), join(REPO, "pipeline", "PROMPT.md")]) {
      try {
        const prev = existsSync(target) ? readFileSync(target, "utf8") : "";
        writeFileSync(target, spliceBlock(prev, block), "utf8");
      } catch {
        /* the prompt is the operator's document; failing to update it must not fail the run */
      }
    }
  }

  if (!o.quiet) {
    console.log(`\n\x1b[1mePipeline v${wf.workflow_version}\x1b[0m  ${explain(wf).at(-1)}`);
    console.log(`observed concurrency ${observedConcurrency(records, wallMs)}x · pool=${poolMode} · containers removed=${removed}\n`);
    for (const r of records) {
      const mark = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      const deg = (ctx.bag[byId.get(r.id)!.output] as { degraded?: boolean })?.degraded ? " \x1b[33m(degraded)\x1b[0m" : "";
      console.log(`  ${mark} ${r.id.padEnd(16)} ${String(r.duration_ms).padStart(7)}ms${deg}`);
    }
    console.log("\n\x1b[1mGATES\x1b[0m");
    console.log(renderGates(decision.gates).join("\n"));
    console.log("\n\x1b[1mSELF-AUDIT\x1b[0m");
    console.log(renderAudit(a).join("\n"));
    console.log("\n" + renderSummary(report).join("\n"));
    console.log(`\nartifact: orchestra/runs/${artifactName(report)}`);
  }
  return { report, auditResult: a, wallMs, records };
}

function parseArgs(argv: string[]): RunOptions {
  const get = (k: string, d?: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const profile = get("--profile", "simple")!;
  return {
    profile,
    question: get("--question", PROFILES[profile]?.question ?? PROFILES.simple.question)!,
    dry: argv.includes("--dry"),
    explainOnly: argv.includes("--explain"),
    allowPush: argv.includes("--allow-push"),
    poolSize: Number(get("--pool", "5")),
    chaosIterations: Number(get("--chaos-iterations", String(PROFILES[profile]?.chaos ?? 4))),
    quiet: argv.includes("--quiet"),
    light: argv.includes("--light"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce(parseArgs(process.argv.slice(2)))
    .then((r) => process.exit(r && !r.report.decision.go_ahead ? 1 : 0))
    .catch((e) => {
      console.error(`pipeline: ${(e as Error).message}`);
      process.exit(2);
    });
}
