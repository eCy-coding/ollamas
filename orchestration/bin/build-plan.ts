#!/usr/bin/env tsx
/**
 * orchestration/bin/build-plan.ts — read the completion-gap report (COMPLETION_GAPS.json) and emit a
 * step-by-step, section-by-section build PLAN (BUILD_PLAN.md): dependency-ordered phases, gaps by severity,
 * each with a fast/safe/correct recipe. This is a PLAN — it reads a JSON and writes markdown; it builds nothing.
 *
 * Run:  tsx orchestration/bin/build-plan.ts [--from <json>] [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, renderBuildPlan, type GapLike } from "./lib/build-plan";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes("--json");
const FROM = flag("--from", join(ORCH_DIR, "COMPLETION_GAPS.json"))!;

function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

function main(): void {
  if (!existsSync(FROM)) {
    console.error(`build-plan: ${FROM} yok — önce \`tsx orchestration/bin/completion-scan.ts\` koş.`);
    process.exit(2);
  }
  const gaps = (JSON.parse(readFileSync(FROM, "utf8")).gaps ?? []) as GapLike[];
  if (!gaps.length) { console.error("build-plan: COMPLETION_GAPS.json'da gap yok."); process.exit(2); }

  const phases = buildPlan(gaps);
  const ts = nowIso();
  writeFileSync(join(ORCH_DIR, "BUILD_PLAN.md"), renderBuildPlan(phases, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "BUILD_PLAN.json"), JSON.stringify({ ts, phases }, null, 2) + "\n");

  if (JSON_OUT) { console.log(JSON.stringify({ ts, phases })); return; }

  const totalSteps = phases.reduce((n, p) => n + p.steps.length, 0);
  console.log(`\nBUILD PLAN — ${phases.length} bölüm · ${totalSteps} adım (bağımlılık-sıralı):`);
  for (const p of phases) console.log(`  T${p.order} ${p.stream.padEnd(20)} ${p.steps.length} adım${p.p1 ? ` (${p.p1} P1)` : ""}`);
  console.log(`\nRapor: orchestration/BUILD_PLAN.md (adım-adım bölüm-bölüm + fast/safe/correct recipe + verify)`);
}

main();
