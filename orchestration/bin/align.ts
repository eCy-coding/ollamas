#!/usr/bin/env tsx
/**
 * orchestration/bin/align.ts — Constitutional Alignment harness CLI.
 *
 *   align create <base>            Build the aligned variant `<base>-ca` (Ollama Modelfile: FROM <base> +
 *                                  SYSTEM <public-principle constitution> + family-calibrated PARAMs).
 *                                  Idempotent (skips if it exists; `--force` rebuilds). No weights copied,
 *                                  no fine-tuning — behavioral alignment via system prompt.
 *   align bench  <base> [--runs N] A/B the conformance suite: base (raw) vs `<base>-ca` at temperature 0,
 *                                  median over N runs → per-probe + overall conformance + Δ. → ALIGN_REPORT.md.
 *   align all [--runs N] [--only a,b]  Sweep every alignable local model: create (idempotent) + bench + rank
 *                                  by conformance × tok/s (optimize.ts) + regression-check → ALIGNMENT_MATRIX.md
 *                                  + ALIGNMENT_SELECTION.json (the production selection).
 *   align resolve <base>           Print the aligned variant tag ollamas should run for a base model.
 *   align list                     List aligned variants present in ollama.
 *
 * Ethical boundary: see bin/lib/claude-constitution.ts. Variants are openly named "-ca"; no impersonation,
 * no weight/data extraction, no fine-tuning on Claude/Fable outputs.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CONSTITUTION, CONSTITUTION_VERSION } from "./lib/claude-constitution";
import { renderModelfile, alignedTag } from "./lib/modelfile";
import { CONFORMANCE_SUITE, scoreHybrid, aggregateConformance, stripThinking, medianRuns, type ProbeResult } from "./lib/conformance";
import { buildJudgePrompt, parseJudgeVerdict } from "./lib/judge";
import { chatOnce, listModels } from "./lib/ollama-client";
import { median } from "./lib/bench";
import { optimalConfig } from "./lib/optimize";
import {
  isAlignableBase, paramProfileFor, selectBestAligned, regressionCheck, renderMatrix,
  alignedModelFor, type SweepRow,
} from "./lib/align-sweep";

const ORCH = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string, d = ""): string => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const JSON_OUT = argv.includes("--json");
const FORCE = argv.includes("--force");
const RUNS = Math.max(1, Number(flag("--runs", "1")) || 1);
const ONLY = flag("--only").split(",").map((s) => s.trim()).filter(Boolean);
// LLM-judge for the semantic dimensions (a local model, eval-only). "" or "none" → deterministic-only.
// Default qwen3:8b: small, usually already warm from the sweep, and reliable on a single YES/NO judgment.
const JUDGE = flag("--judge", process.env.ALIGN_JUDGE || "qwen3:8b");
const base = argv[1] && !argv[1].startsWith("--") ? argv[1] : "";

function usage(): never {
  console.error("usage: align create <base> | bench <base> [--runs N] | all [--runs N] [--only a,b] | resolve <base> | list [--json]");
  process.exit(2);
}
function log(m: string): void { if (!JSON_OUT) console.error(m); }

// ── system RAM (GB) for the VRAM-fit term of the selection ────────────────────────────────────────────
function sysRamGb(): number {
  try { return Math.round(Number(execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }).trim()) / 1e9); }
  catch { return 16; }
}
function sysInfo(): { chip: string; cores: number } {
  try {
    const chip = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim();
    const cores = Number(execFileSync("sysctl", ["-n", "hw.physicalcpu"], { encoding: "utf8" }).trim()) || 8;
    return { chip, cores };
  } catch { return { chip: "?", cores: 8 }; }
}

// ── create (idempotent) ───────────────────────────────────────────────────────────────────────────────
async function ensureVariant(baseModel: string, force = FORCE): Promise<string> {
  const tag = alignedTag(baseModel);
  if (!force) {
    const have = await listModels();
    if (have.some((m) => m === tag || m === `${tag}:latest` || m.startsWith(`${tag}:`))) { log(`[align] ${tag} exists — skip (use --force to rebuild)`); return tag; }
  }
  const mf = renderModelfile({ base: baseModel, system: CONSTITUTION, params: paramProfileFor(baseModel) });
  const tmp = join(tmpdir(), `Modelfile.${tag}`);
  writeFileSync(tmp, mf);
  execFileSync("ollama", ["create", tag, "-f", tmp], { stdio: JSON_OUT ? "ignore" : "inherit", timeout: 180_000 });
  log(`[align] created ${tag}  (constitution v${CONSTITUTION_VERSION}, from ${baseModel})`);
  return tag;
}

// ── conformance run (median over N runs) ──────────────────────────────────────────────────────────────
interface Row extends ProbeResult { sample: string }
const JUDGE_ON = JUDGE && JUDGE !== "none";
/** Grade a semantic probe with the LLM judge; null on any error/ambiguity → caller uses the deterministic rubric. */
async function judgeVerdict(probe: (typeof CONFORMANCE_SUITE)[number], response: string): Promise<number | null> {
  if (!JUDGE_ON || !probe.judge) return null;
  try {
    const r = await chatOnce(JUDGE, "", buildJudgePrompt(probe.judge.criterion, probe.prompt, response), { temperature: 0 });
    return parseJudgeVerdict(r.text);
  } catch { return null; }
}

async function runSuiteN(model: string, runs: number): Promise<{ rows: Row[]; tokS: number }> {
  const runScores: number[][] = [];
  const toks: number[] = [];
  const lastText: string[] = new Array(CONFORMANCE_SUITE.length).fill("");
  for (let run = 0; run < runs; run++) {
    const scores: number[] = [];
    for (let i = 0; i < CONFORMANCE_SUITE.length; i++) {
      const p = CONFORMANCE_SUITE[i];
      let text = "";
      try { const r = await chatOnce(model, "", p.prompt); text = stripThinking(r.text); if (r.tokS > 0) toks.push(r.tokS); }
      catch (e: any) { text = `«error: ${String(e?.message ?? e).slice(0, 80)}»`; }
      const verdict = await judgeVerdict(p, text); // semantic dims → LLM judge; null → deterministic fallback
      scores.push(scoreHybrid(p, text, verdict));
      lastText[i] = text;
    }
    runScores.push(scores);
  }
  const med = medianRuns(runScores);
  const rows: Row[] = CONFORMANCE_SUITE.map((p, i) => ({ id: p.id, dimension: p.dimension, score: med[i] ?? 0, sample: lastText[i].replace(/\s+/g, " ").slice(0, 100) }));
  return { rows, tokS: toks.length ? median(toks) : 0 };
}

function pct(n: number): string { return (n * 100).toFixed(0) + "%"; }

// ── create ────────────────────────────────────────────────────────────────────────────────────────────
async function cmdCreate(baseModel: string): Promise<void> {
  if (!baseModel) usage();
  const tag = await ensureVariant(baseModel);
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, base: baseModel, aligned: tag, constitution: CONSTITUTION_VERSION }));
}

// ── bench ─────────────────────────────────────────────────────────────────────────────────────────────
async function cmdBench(baseModel: string): Promise<void> {
  if (!baseModel) usage();
  const tag = alignedTag(baseModel);
  log(`[align] benchmarking ${baseModel} (raw) vs ${tag} (aligned) — ${CONFORMANCE_SUITE.length} probes × ${RUNS} run(s) × 2 …`);
  const b = await runSuiteN(baseModel, RUNS), a = await runSuiteN(tag, RUNS);
  const bSum = aggregateConformance(b.rows), aSum = aggregateConformance(a.rows);
  const delta = aSum.mean - bSum.mean;
  const lines = [`# Alignment conformance — ${baseModel} vs ${tag}`, "",
    `Constitution v${CONSTITUTION_VERSION} · temperature 0 · ${CONFORMANCE_SUITE.length} probes × ${RUNS} run(s) · behavioral rubric (no LLM judge)`, "",
    `**Overall Claude-conformance:** base ${pct(bSum.mean)} → aligned ${pct(aSum.mean)}  ·  **Δ ${delta >= 0 ? "+" : ""}${pct(delta)}**`, "",
    "| Probe | Dimension | base | aligned |", "|---|---|---|---|",
    ...b.rows.map((r, i) => `| ${r.id} | ${r.dimension} | ${pct(r.score)} | ${pct(a.rows[i].score)} |`),
    "", "_Ethical: behavioral alignment via a public-principle system prompt + calibrated params. No weights/data cloned, no fine-tuning, no impersonation._"];
  writeFileSync(join(ORCH, "ALIGN_REPORT.md"), lines.join("\n") + "\n");
  writeFileSync(join(ORCH, "ALIGN.json"), JSON.stringify({ base: baseModel, aligned: tag, constitution: CONSTITUTION_VERSION, baseMean: bSum.mean, alignedMean: aSum.mean, delta, baseRows: b.rows, alignRows: a.rows }, null, 2) + "\n");
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, base: baseModel, aligned: tag, baseMean: bSum.mean, alignedMean: aSum.mean, delta }));
  else { process.stdout.write("\n" + lines.join("\n") + "\n"); console.error(`[align] report → ${join(ORCH, "ALIGN_REPORT.md")}`); }
}

// ── all: sweep every alignable local model → matrix + production selection ─────────────────────────────
async function cmdAll(): Promise<void> {
  const inv = await listModels();
  const matches = (b: string) => !ONLY.length || ONLY.some((o) => b === o || b.split(":")[0] === o || b.startsWith(`${o}:`));
  const bases = [...new Set(inv.filter(isAlignableBase).filter(matches))];
  if (!bases.length) { console.error("align all: no alignable local models found (is ollama running?)"); process.exit(1); }
  log(`[align] sweeping ${bases.length} model(s): ${bases.join(", ")}  (${RUNS} run(s) each)`);
  const rows: (SweepRow & { regression: { ok: boolean; reason: string } })[] = [];
  for (const b of bases) {
    const tag = await ensureVariant(b);
    log(`[align] · ${b} → ${tag} …`);
    const baseR = await runSuiteN(b, RUNS), alignR = await runSuiteN(tag, RUNS);
    const bSum = aggregateConformance(baseR.rows), aSum = aggregateConformance(alignR.rows);
    rows.push({ base: b, aligned: tag, baseMean: bSum.mean, alignedMean: aSum.mean, delta: aSum.mean - bSum.mean, tokS: alignR.tokS, byDimension: aSum.byDimension, regression: regressionCheck(bSum.mean, aSum.mean) });
  }
  const ramGb = sysRamGb();
  const { chip, cores } = sysInfo();
  const best = selectBestAligned(rows, ramGb);
  const matrix = renderMatrix(rows) +
    (best ? `\n**Selected (conformance × tok/s):** ${best.model}  ·  conformance ${pct(best.correctRatio)}  ·  ${best.tokS.toFixed(0)} tok/s  ·  score ${best.score}\n` : "\n_No variant cleared the conformance gate._\n") +
    "\n### Regression check\n" + rows.map((r) => `- ${r.aligned}: ${r.regression.ok ? "✅" : "❌"} ${r.regression.reason}`).join("\n") + "\n";
  writeFileSync(join(ORCH, "ALIGNMENT_MATRIX.md"), matrix);
  const selection = {
    chip, ramGb, cores, ts: new Date().toISOString(), constitution: CONSTITUTION_VERSION,
    selection: best ? { model: best.model, score: best.score, tokS: best.tokS, conformance: best.correctRatio, reason: best.reason, config: optimalConfig(ramGb, cores, best.model) } : null,
    variants: rows.map((r) => ({ base: r.base, aligned: r.aligned, baseMean: r.baseMean, alignedMean: r.alignedMean, delta: r.delta, tokS: r.tokS, regression: r.regression })),
  };
  writeFileSync(join(ORCH, "ALIGNMENT_SELECTION.json"), JSON.stringify(selection, null, 2) + "\n");
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, swept: bases.length, best: best?.model ?? null, variants: selection.variants }));
  else { process.stdout.write("\n" + matrix); console.error(`[align] → ${join(ORCH, "ALIGNMENT_MATRIX.md")} + ALIGNMENT_SELECTION.json`); }
}

function cmdResolve(baseModel: string): void {
  if (!baseModel) usage();
  const tag = alignedModelFor(baseModel);
  console.log(JSON_OUT ? JSON.stringify({ base: baseModel, aligned: tag }) : tag);
}

function cmdList(): void {
  const out = execFileSync("ollama", ["list"], { encoding: "utf8", timeout: 15_000 });
  const aligned = out.split("\n").filter((l) => /-ca(\s|:|$)/.test(l));
  if (JSON_OUT) console.log(JSON.stringify({ aligned: aligned.map((l) => l.split(/\s+/)[0]).filter(Boolean) }));
  else console.log(aligned.length ? aligned.join("\n") : "no aligned (-ca) variants yet — run: align create <base>");
}

(async () => {
  if (cmd === "create") await cmdCreate(base);
  else if (cmd === "bench") await cmdBench(base);
  else if (cmd === "all") await cmdAll();
  else if (cmd === "resolve") cmdResolve(base);
  else if (cmd === "list") cmdList();
  else usage();
})().catch((e) => { console.error(`align: ${e?.message ?? e}`); process.exit(1); });
