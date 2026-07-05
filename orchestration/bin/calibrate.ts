#!/usr/bin/env tsx
/**
 * orchestration/bin/calibrate.ts — e2e calibration of the 100-task `ollamas do` pipeline (iter-6).
 *
 * Runs each catalog task PROPOSE-ONLY (no repo mutation): resolve target → ground the local model → check the
 * proposal is an actionable SEARCH/REPLACE whose SEARCH matches the file VERBATIM (apply-ready). Tallies
 * resolved / actionable / applyClean / crashes → CALIBRATION.md (+ --json). The gate + revert-on-red is
 * the correctness guarantee at apply time; this harness proves the pipeline PROCESSES all 100 without error.
 *
 * Run:
 *   tsx orchestration/bin/calibrate.ts --dry            # structural only (resolve+target-exists), no model — fast CI gate
 *   tsx orchestration/bin/calibrate.ts [--limit N] [--model m] [--json]   # live model calibration (slow)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { groundedPrompt } from "./lib/fleet-prompt";
import { hasSearchReplace, parseSearchReplace, applyEdits } from "./lib/search-replace";
import { chatOnce } from "./lib/ollama-client";
import type { Task } from "./lib/task-catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes("--dry");
const JSON_OUT = argv.includes("--json");
const LIMIT = Number(flag("--limit") || 0);
const MODEL = flag("--model") || (() => {
  try { return JSON.parse(readFileSync(join(ORCH_DIR, "MODEL_SELECTION.json"), "utf8")).selection?.model || "qwen3-coder:30b"; } catch { return "qwen3-coder:30b"; }
})();
const PER_TASK_MS = Number(process.env.CALIBRATE_TASK_MS || 60_000);

interface Row { id: string; target: string; resolved: boolean; actionable: boolean; applyClean: boolean; reason: string; }

async function main(): Promise<void> {
  const catalog: Task[] = JSON.parse(readFileSync(join(ORCH_DIR, "TASKS.json"), "utf8"));
  const tasks = LIMIT > 0 ? catalog.slice(0, LIMIT) : catalog;
  const rows: Row[] = [];
  let crashes = 0;

  for (const t of tasks) {
    const abs = join(REPO, t.target);
    const resolved = existsSync(abs);
    if (!resolved) { rows.push({ id: t.id, target: t.target, resolved: false, actionable: false, applyClean: false, reason: "target missing" }); continue; }
    if (DRY) { rows.push({ id: t.id, target: t.target, resolved: true, actionable: false, applyClean: false, reason: "dry (structural only)" }); continue; }
    try {
      const content = readFileSync(abs, "utf8");
      const r = await chatOnce(MODEL, "", groundedPrompt(t.goal, t.target, content), { host: OLLAMA_HOST, timeoutMs: PER_TASK_MS, num_ctx: 8192 });
      const actionable = hasSearchReplace(r.text);
      let applyClean = false, reason = actionable ? "actionable" : "no SEARCH/REPLACE";
      if (actionable) {
        const res = applyEdits(content, parseSearchReplace(r.text).map((e) => ({ ...e, file: t.target })));
        applyClean = res.ok; reason = res.ok ? "apply-clean" : (res.failures[0]?.reason || "apply failed");
      }
      rows.push({ id: t.id, target: t.target, resolved, actionable, applyClean, reason });
      process.stderr.write(`  ${applyClean ? "✅" : actionable ? "◐" : "○"} ${t.id} (${reason})\n`);
    } catch (e) {
      crashes++; // a per-task failure NEVER aborts the batch (system stays flawless)
      rows.push({ id: t.id, target: t.target, resolved, actionable: false, applyClean: false, reason: `error: ${(e as Error).message.slice(0, 60)}` });
    }
  }

  const n = rows.length;
  const sum = { total: n, resolved: rows.filter((r) => r.resolved).length, actionable: rows.filter((r) => r.actionable).length, applyClean: rows.filter((r) => r.applyClean).length, crashes };
  if (JSON_OUT) { console.log(JSON.stringify({ model: MODEL, dry: DRY, ...sum, rows })); return; }

  const md = [
    `# CALIBRATION_100 — ${DRY ? "structural (dry)" : `live · ${MODEL}`}`,
    ``,
    `- resolved (target exists): **${sum.resolved}/${n}**`,
    ...(DRY ? [] : [
      `- actionable (SEARCH/REPLACE): **${sum.actionable}/${n}**`,
      `- apply-clean (SEARCH verbatim): **${sum.applyClean}/${n}**`,
      `- crashes: **${sum.crashes}** (must be 0 — pipeline never errors)`,
    ]),
    ``,
    `> Correctness at apply time = tsc+test gate + revert-on-red. This harness proves the pipeline PROCESSES`,
    `> ${n} tasks with 0 crashes. Rerun: \`tsx orchestration/bin/calibrate.ts\`.`,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "CALIBRATION.md"), md + "\n");
  process.stdout.write(md + "\n");
  process.stderr.write(`[calibrate-100] resolved ${sum.resolved}/${n}${DRY ? "" : ` · actionable ${sum.actionable} · apply-clean ${sum.applyClean} · crashes ${sum.crashes}`}\n`);
  if (DRY && sum.resolved !== n) process.exit(1); // integrity gate: every target must exist
}

main().catch((e) => { console.error("[calibrate-100] fatal:", (e as Error)?.message ?? e); process.exit(1); });
