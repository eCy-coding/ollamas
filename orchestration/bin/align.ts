#!/usr/bin/env tsx
/**
 * orchestration/bin/align.ts — Constitutional Alignment harness CLI.
 *
 *   align create <base>   Build an ethically-aligned variant `<base>-ca` (Ollama Modelfile: FROM <base> +
 *                         SYSTEM <public-principle constitution> + calibrated PARAMs). No weights copied, no
 *                         fine-tuning — behavioral alignment via system prompt.
 *   align bench  <base>   A/B the conformance suite: base (raw) vs `<base>-ca` (constitution-baked) at
 *                         temperature 0 → per-probe + overall Claude-conformance scores + Δ. Writes
 *                         orchestration/ALIGN_REPORT.md + ALIGN.json.
 *   align list            List aligned variants present in ollama.
 *
 * Ethical boundary: see bin/lib/claude-constitution.ts. Variants are openly named "-ca"; no impersonation.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CONSTITUTION, CONSTITUTION_VERSION } from "./lib/claude-constitution";
import { renderModelfile, alignedTag } from "./lib/modelfile";
import { CONFORMANCE_SUITE, scoreResponse, aggregateConformance, stripThinking, type ProbeResult } from "./lib/conformance";
import { chatOnce } from "./lib/ollama-client";

const ORCH = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const JSON_OUT = argv.includes("--json");
const base = argv[1] && !argv[1].startsWith("--") ? argv[1] : "";

function usage(): never { console.error("usage: align create <base> | bench <base> | list [--json]"); process.exit(2); }

function cmdCreate(baseModel: string): void {
  if (!baseModel) usage();
  const tag = alignedTag(baseModel);
  const mf = renderModelfile({ base: baseModel, system: CONSTITUTION });
  const tmp = join(tmpdir(), `Modelfile.${tag}`);
  writeFileSync(tmp, mf);
  execFileSync("ollama", ["create", tag, "-f", tmp], { stdio: JSON_OUT ? "ignore" : "inherit", timeout: 180_000 });
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, base: baseModel, aligned: tag, constitution: CONSTITUTION_VERSION }));
  else console.error(`[align] created ${tag}  (constitution v${CONSTITUTION_VERSION}, from ${baseModel})`);
}

interface Row extends ProbeResult { ms: number; sample: string }
async function runSuite(model: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (const p of CONFORMANCE_SUITE) {
    let text = "", ms = 0;
    try { const r = await chatOnce(model, "", p.prompt); text = stripThinking(r.text); ms = r.ms; }
    catch (e: any) { text = `«error: ${String(e?.message ?? e).slice(0, 80)}»`; }
    rows.push({ id: p.id, dimension: p.dimension, score: scoreResponse(p, text), ms, sample: text.replace(/\s+/g, " ").slice(0, 100) });
  }
  return rows;
}

function pct(n: number): string { return (n * 100).toFixed(0) + "%"; }

function renderReport(baseModel: string, tag: string, baseRows: Row[], alignRows: Row[]): string {
  const bSum = aggregateConformance(baseRows), aSum = aggregateConformance(alignRows);
  const delta = aSum.mean - bSum.mean;
  const lines: string[] = [];
  lines.push(`# Alignment conformance — ${baseModel} vs ${tag}`, "");
  lines.push(`Constitution v${CONSTITUTION_VERSION} · temperature 0 · ${CONFORMANCE_SUITE.length} probes · behavioral rubric (no LLM judge)`, "");
  lines.push(`**Overall Claude-conformance:** base ${pct(bSum.mean)} → aligned ${pct(aSum.mean)}  ·  **Δ ${delta >= 0 ? "+" : ""}${pct(delta)}**`, "");
  lines.push("| Probe | Dimension | base | aligned |", "|---|---|---|---|");
  for (let i = 0; i < baseRows.length; i++) {
    const b = baseRows[i], a = alignRows[i];
    lines.push(`| ${b.id} | ${b.dimension} | ${pct(b.score)} | ${pct(a.score)} |`);
  }
  lines.push("", "### Per-dimension (aligned)", "");
  for (const [d, v] of Object.entries(aSum.byDimension)) lines.push(`- ${d}: ${pct(v)}`);
  lines.push("", "_Ethical: behavioral alignment via a public-principle system prompt + calibrated params. No weights/data cloned, no fine-tuning on Claude outputs, no impersonation._");
  return lines.join("\n") + "\n";
}

async function cmdBench(baseModel: string): Promise<void> {
  if (!baseModel) usage();
  const tag = alignedTag(baseModel);
  if (!JSON_OUT) console.error(`[align] benchmarking ${baseModel} (raw) vs ${tag} (aligned) — ${CONFORMANCE_SUITE.length} probes × 2 …`);
  const baseRows = await runSuite(baseModel);
  const alignRows = await runSuite(tag);
  const bSum = aggregateConformance(baseRows), aSum = aggregateConformance(alignRows);
  const delta = aSum.mean - bSum.mean;
  const report = renderReport(baseModel, tag, baseRows, alignRows);
  writeFileSync(join(ORCH, "ALIGN_REPORT.md"), report);
  writeFileSync(join(ORCH, "ALIGN.json"), JSON.stringify({
    base: baseModel, aligned: tag, constitution: CONSTITUTION_VERSION,
    baseMean: bSum.mean, alignedMean: aSum.mean, delta,
    baseRows, alignRows,
  }, null, 2) + "\n");
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, base: baseModel, aligned: tag, baseMean: bSum.mean, alignedMean: aSum.mean, delta }));
  else { process.stdout.write("\n" + report); console.error(`[align] report → ${join(ORCH, "ALIGN_REPORT.md")}`); }
}

function cmdList(): void {
  const out = execFileSync("ollama", ["list"], { encoding: "utf8", timeout: 15_000 });
  const aligned = out.split("\n").filter((l) => /-ca(\s|:|$)/.test(l));
  if (JSON_OUT) console.log(JSON.stringify({ aligned: aligned.map((l) => l.split(/\s+/)[0]).filter(Boolean) }));
  else console.log(aligned.length ? aligned.join("\n") : "no aligned (-ca) variants yet — run: align create <base>");
}

(async () => {
  if (cmd === "create") cmdCreate(base);
  else if (cmd === "bench") await cmdBench(base);
  else if (cmd === "list") cmdList();
  else usage();
})().catch((e) => { console.error(`align: ${e?.message ?? e}`); process.exit(1); });
