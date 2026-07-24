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
import { buildDocument, validateDocument, isValid, renderIssues, type Gap, type Reference, type SearchResult } from "../lib/document";
import { renderWorkflow } from "../lib/ci";
import { DEFAULT_THRESHOLDS } from "../lib/gates";
import { CacheStore } from "../runtime/cache-store";
import { WarmPool } from "../runtime/pool";
import { progress, shouldPrefetch, nextPlan, savedMs, renderLookahead, type LookaheadOutcome } from "../lib/lookahead";
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
  "The prompt's own Output Requirements were unmet until v4: `todo_board`, `benchmark_configuration`, `ci_cd_yaml` and `references` existed nowhere, so the pipeline passed its own gates while failing the contract it was built from. All eight keys are now emitted as `<run_id>.document.json` and validated (citations must resolve, severities must be in-schema).",
  "A cache must be versioned with the shape it stores: `search` gained a field and runs kept reading pre-change entries, producing a document with zero sources while reporting a cache hit. `CACHE_SCHEMA` is now part of every key.",
  "75/25 lookahead is real and measured, not a slogan: at 0.75 progress the next run's pool is warmed and its search/think cache filled while the tail finishes. Only the OVERLAPPING portion is counted as a gain (measured 555 ms) — preparation that outlived the run bought nothing.",
  "K1 dead-code: `openTabDirs()` read `${TAB_ROOT}/.index`, a file nothing ever wrote, so the tab-leak gate could never fail. It now reads the disk (a lane dir with a `queue` and no DONE marker), takes an optional root for real test isolation, and found 2 leaked smoke tabs the moment it worked.",
  "K4 flaky doctor test: root was SEQUENTIAL probes in buildDoctorReport — health(8s)+ollama(5s)+bridge(5s)+ready(5s) reached ~23s worst-case under load, past the 15s test budget. Fixed by running the independent probes concurrently (Promise.all): 7.14s → 0.90s under load, 5/5 green. Threshold NOT relaxed; the doctor was made faster.",
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
    case "analyze_search": return S.analyzeGaps(ctx, ["thoughts_search", "search_results"], "research");
    case "plan": return S.plan(ctx, "analysis_search");
    case "todo": return S.todo(ctx, "plan_outline");
    case "sandbox_test": return S.sandboxTest(ctx, PROFILES[o.profile]?.sandboxLines ?? 200);
    case "think_sandbox": return S.think(ctx, "sandbox_result");
    case "analyze_sandbox": return S.analyzeGaps(ctx, ["sandbox_result", "thoughts_sandbox"], "verification");
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

/**
 * `references` comes from the vault anchor source, never from a second hand-written list.
 * `_bin/pipe-anchors.py` owns the anchors and emits this JSON; TypeScript only reads it, so
 * the document and the vault notes cannot describe different sources.
 */
function loadReferences(): Reference[] {
  try {
    const f = join(VAULT, "_index", "pipe-references.json");
    return (JSON.parse(readFileSync(f, "utf8")) as { references?: Reference[] }).references ?? [];
  } catch {
    return [];
  }
}

/** Gap list produced by an `analyzeGaps` step, or [] when the step degraded. */
const gapsOf = (v: unknown): Gap[] => ((v as { gaps?: Gap[] })?.gaps ?? []);

/**
 * The prompt asks for five gap sections but the DAG only runs two `analyze` steps.
 *
 * Rather than paying for three more LLM calls to manufacture findings, the remaining sections
 * are derived from evidence the run ALREADY produced: a degraded plan/todo is a planning gap,
 * a degraded code/test step is a development gap, and every self-audit hole is — literally —
 * a production gap. These are measured, cite the run itself, and are marked `deterministic`
 * so nobody mistakes them for model judgement.
 */
function derivedGaps(ctx: S.StepCtx, missing: string[], selfRef: string): {
  planning_gaps: Gap[]; development_gaps: Gap[]; production_gaps: Gap[];
} {
  const deg = (key: string, label: string): Gap[] => {
    const v = ctx.bag[key] as { degraded?: boolean; reason?: string } | undefined;
    return v?.degraded
      ? [{ issue: `${label} degraded: ${v.reason ?? "no reason given"}`, severity: "medium", evidence: selfRef, source: "deterministic" }]
      : [];
  };
  return {
    planning_gaps: [...deg("plan_outline", "plan step"), ...deg("todo_list", "todo step")],
    development_gaps: [...deg("generated_code", "code step"), ...deg("code_test_report", "code test")],
    production_gaps: missing.map((m) => ({
      issue: `self-audit capability not exercised: ${m}`,
      severity: m === "security" || m === "chaos" ? "high" : "medium",
      evidence: selfRef,
      source: "deterministic",
    })),
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

  // ── 75/25 lookahead ──────────────────────────────────────────────────────────────────
  // The operator's rule: at 75% of a task, compute what the NEXT one needs so the final 25%
  // overlaps with preparing it. The tail of this DAG (merge/commit/push) is cheap and touches
  // nothing the next run needs, so the pool and caches were idle exactly when they could have
  // been filling. `prep` is started and deliberately NOT awaited inside the loop — a lookahead
  // that blocks the run it is riding on has made things worse, not better.
  const total = wf.steps.length;
  let fired = false;
  let prepStarted = 0;
  let prep: Promise<void> | null = null;
  const look: LookaheadOutcome = { fired: false };
  let nextPool: WarmPool | null = null;

  const maybeLookahead = () => {
    const p = progress(records.length, total);
    if (!shouldPrefetch(p, fired)) return;
    fired = true;
    look.fired = true;
    look.firedAt = p.ratio;
    const plan = nextPlan(o.profile, Object.keys(PROFILES), {
      poolSize: o.poolSize,
      questionOf: (pr) => PROFILES[pr]?.question ?? "",
    });
    if (!plan) return;
    look.plan = plan;
    prepStarted = Date.now();
    prep = (async () => {
      try {
        // Warm the next run's containers…
        nextPool = new WarmPool({ size: plan.poolSize });
        const mode = await nextPool.start();
        look.warmed = mode === "warm" ? nextPool.available : 0;
        // …and fill the caches its first two steps would otherwise pay for.
        const doneKeys: string[] = [];
        const probe: S.StepCtx = { ...ctx, question: plan.question, bag: {}, invocations: [] };
        const sr = await S.search(probe);
        if (!(sr as { degraded?: boolean }).degraded) doneKeys.push("search");
        probe.bag.search_results = sr;
        const th = await S.think(probe, "search_results");
        if (!(th as { degraded?: boolean }).degraded) doneKeys.push("think");
        look.prefetched = doneKeys;
      } catch (e) {
        // A failed preparation must never fail the run: the next run simply starts cold.
        look.error = (e as Error).message;
      }
    })();
  };

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
      maybeLookahead();
    }
    for (const id of b.serial) {
      const step = byId.get(id)!;
      const { record, value } = await benchmarkStep(
        { id, action: step.action, profile: o.profile },
        () => dispatch(step, ctx, o),
      );
      records.push(record);
      ctx.bag[step.output] = value;
      maybeLookahead();
    }
  }

  // Tail = the work that ran AFTER the trigger. Only that much of the preparation actually
  // overlapped, so only that much may be claimed as a gain.
  const tailMs = prepStarted ? Date.now() - prepStarted : 0;
  if (prep) {
    await prep;                       // settle before teardown so nothing leaks
    look.prepMs = Date.now() - prepStarted;
  }
  const lookaheadSavedMs = savedMs(look.prepMs, tailMs);
  if (nextPool) await (nextPool as WarmPool).stop();

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
    env: { ...env, notes: [...(env.notes ?? []), `pool=${poolMode}`, `containers_removed=${removed}`, `lookahead_saved_ms=${lookaheadSavedMs}`, renderLookahead(look, lookaheadSavedMs)] },
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

  // ── the master prompt's own output contract: ONE document with eight keys ────────────
  const searchStep = ctx.bag.search_results as { search_results?: SearchResult[] } | undefined;
  const refs = loadReferences();
  // Anchors occupy the low ref_ids; search results were numbered from 1 by the search step,
  // so they are re-based above the anchors to keep every citation index unique.
  const offset = refs.length;
  const searchResults = (searchStep?.search_results ?? []).map((r) => ({ ...r, ref_id: r.ref_id + offset }));
  const selfRef = refs.length ? `[${refs[0].ref_id}]` : searchResults.length ? `[${searchResults[0].ref_id}]` : "";
  const rebase = (gs: Gap[]): Gap[] =>
    gs.map((g) => ({ ...g, evidence: g.evidence.replace(/\[(\d+)\]/g, (_m, n) => `[${Number(n) + offset}]`) }));
  const derived = derivedGaps(ctx, a.missing, selfRef);

  const doc = buildDocument({
    meta: {
      run_id: env.run_id,
      timestamp: env.timestamp,
      workflow_version: wf.workflow_version,
      profile: o.profile,
      git_sha: env.git_sha,
      status: report.status,
    },
    search_results: searchResults,
    thoughts: {
      research: String((ctx.bag.thoughts_search as { text?: string })?.text ?? ""),
      planning: String((ctx.bag.plan_outline as { text?: string })?.text ?? ""),
      development: String((ctx.bag.generated_code as { text?: string })?.text ?? ""),
      verification: String((ctx.bag.thoughts_sandbox as { text?: string })?.text ?? ""),
      production: renderSummary(report).join("\n"),
    },
    analysis: {
      research_gaps: rebase(gapsOf(ctx.bag.analysis_search)),
      verification_gaps: rebase(gapsOf(ctx.bag.verification_report)),
      ...derived,
    },
    dag: wf.steps,
    todo_board: a.todo,
    benchmark_configuration: {
      metrics: ["duration_histogram", "cpu_seconds", "memory_bytes", "error_rate"],
      percentiles: ["p50", "p95", "p99", "p999"],
      runs_per_config: 5,
      warmup_per_config: 1,
      load_models: { closed_loop: { max_concurrency: 2 }, open_loop: { arrival_rate_rps: 1 } },
      tools: {
        load_generator: "pipeline/lib/loadgen.ts (zero-dep; k6 not installed)",
        observability: "prom-client on the existing /metrics registry",
        container_runtime: "docker (alpine:3.20 warm pool)",
      },
      quality_gates: DEFAULT_THRESHOLDS,
    },
    ci_cd_yaml: renderWorkflow(),
    references: refs,
  });

  // The workflow file on disk is a RENDER of the same function that fills `ci_cd_yaml`, so
  // the committed CI and the document can never describe different gates. Written every run
  // (idempotent) rather than by a separate command someone must remember to invoke.
  try {
    const wfDir = join(REPO, ".github", "workflows");
    mkdirSync(wfDir, { recursive: true });
    const wfFile = join(wfDir, "pipeline.yml");
    const next = renderWorkflow();
    if (!existsSync(wfFile) || readFileSync(wfFile, "utf8") !== next) writeFileSync(wfFile, next, "utf8");
  } catch { /* CI emission must not fail the run */ }

  const docIssues = validateDocument(doc);
  try {
    writeFileSync(join(dir, `${env.run_id}.document.json`), JSON.stringify(doc, null, 1), "utf8");
  } catch { /* see above */ }

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
    console.log(`\n\x1b[1mLOOKAHEAD\x1b[0m\n  ${renderLookahead(look, lookaheadSavedMs)}`);
    console.log("\n\x1b[1mDOCUMENT\x1b[0m");
    console.log(renderIssues(docIssues).join("\n"));
    console.log(`\nartifact: orchestra/runs/${artifactName(report)}`);
    console.log(`document: orchestra/runs/${env.run_id}.document.json  (${isValid(docIssues) ? "valid" : "INVALID"})`);
  }
  // `ev` is returned so a multi-run driver can aggregate the SAME evidence the single-run
  // gate used. bench.ts previously rebuilt it from the rendered gate table and lost the raw
  // security counts, so the aggregate reported MISS while the run had actually scanned.
  return { report, auditResult: a, wallMs, records, doc, docIssues, evidence: ev, lookahead: look, lookaheadSavedMs };
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
