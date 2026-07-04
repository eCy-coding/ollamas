#!/usr/bin/env tsx
/**
 * orchestration/bin/automator-probe.ts — ARTIFACT tracker probe: WHAT did each model PRODUCE when asked
 * to author macOS Automator-compatible artifacts (Quick Action / Run Shell Script / AppleScript / shell)
 * supporting ollamas, into its own ~/Desktop/ollamas-automator/<model>/ dir? Tracked by directory scan
 * (each model gets the same task sequentially; single-GPU truth). Writes AUTOMATOR_PROBE.md/.json.
 *
 * Reuses scripts/agent-dispatch.mjs (POST /api/agent/chat) + the chrome-probe lib (providerFor, types).
 * Sibling of chrome-probe (that one = "can it open Chrome"; this one = "what did it produce").
 *
 * Ethics: producing files is on the operator's OWN Mac and explicitly requested (the request IS the gate
 * for the privileged write tier). Writes are scoped to a per-model subdir; artifacts are produced + tracked,
 * NEVER executed. Bounded (per-model timeout, sequential).
 *
 * Prereq for reliable write_host_file to Desktop: start the bridge with the artifact dir in its write roots:
 *   BRIDGE_WRITE_ROOTS="$PWD:/tmp/llm-bridge:$HOME/.llm-mission-control:$HOME/Desktop/ollamas-automator" \
 *     bash bin/host-bridge/start-bridge.sh
 * (macos_terminal shell writes work regardless.)
 *
 * Run:  tsx orchestration/bin/automator-probe.ts [--models a,b] [--steps 6] [--dry] [--json]
 * Env:  OLLAMAS_URL (default http://127.0.0.1:3000), AUTOMATOR_PROBE_TIMEOUT_MS (default 150000).
 */
import { writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  providerFor, classifyAutomatorRun, renderAutomatorProbe, classifyDailyRun, renderDailyProbe,
  sanitizeModelDir, type AutomatorRow, type DailyRow, type FileContent,
} from "./lib/automator-probe";
import {
  pendingModels, applyRound, isLoopConverged, shouldContinueLoop, renderAutomatorLoop,
  type AutomatorLoopRound,
} from "./lib/automator-loop";
import type { DispatchReport } from "./lib/chrome-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const DISPATCH = join(REPO, "scripts", "agent-dispatch.mjs");

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const JSON_OUT = argv.includes("--json");
const DRY = argv.includes("--dry");
const STEPS = flag("--steps", "6")!;
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.AUTOMATOR_PROBE_TIMEOUT_MS || "150000");

// --loop (vO37): wrap the daily probe in a bounded convergence loop (implies --task daily). --task support
// (default, vO35): general Automator artifacts. --task daily (vO36): DAILY recurring automations (launchd
// scheduled / Calendar Alarm) whose recurrence is verified by reading file content.
const LOOP = argv.includes("--loop");
const MAX_ROUNDS = Number(flag("--rounds", "3"));
const MAX_DRY = Number(flag("--max-dry", "1"));
const MODE = LOOP ? "daily" : (flag("--task", "support") || "support").toLowerCase();
const DAILY = MODE === "daily";
const ARTIFACT_ROOT = join(homedir(), "Desktop", DAILY ? "ollamas-daily" : "ollamas-automator");

const SKIP = /embed|nomic/i; // embedding models can't drive a tool loop

function taskFor(rootDir: string): string {
  if (DAILY) {
    return [
      "Author a DAILY, RECURRING, SUSTAINABLE macOS automation that makes daily ollamas dev work easier, in this directory:",
      `  ${rootDir}`,
      "Write REAL files there using the write_host_file tool (reliable for multi-line content).",
      "It MUST be recurring/scheduled, not a one-off. Produce:",
      "  • a launchd LaunchAgent plist named com.ollamas.<job>.daily.plist with a StartCalendarInterval (e.g. Hour 9, Minute 0)",
      "    — or a StartInterval — that runs your maintenance script on a schedule (label like com.ollamas.daily-health),",
      "  • the maintenance script it runs — pick a useful daily job: morning start the server (make up) + warm the model",
      "    + open the cockpit at http://127.0.0.1:3000; OR a daily health-check (curl http://127.0.0.1:3000/api/health",
      "    + npm run doctor) that shows an osascript notification; OR a daily benchmark that appends a tok/s log,",
      "  • a README.md with the exact `launchctl load ~/Library/LaunchAgents/...` install step (or how to import it as an",
      "    Automator Calendar Alarm). Make the job idempotent and safe to run every day.",
      "Do NOT install or execute anything (no launchctl load, no running the job) — only WRITE the files.",
      "After writing, list each file you created on its own line with a one-line description.",
      "End with:  VERDICT: DONE <comma-separated filenames>",
    ].join("\n");
  }
  return [
    "Author macOS Automator-compatible artifacts that SUPPORT the ollamas project, in this directory:",
    `  ${rootDir}`,
    "Write REAL files there using the write_host_file tool (reliable for multi-line content).",
    "Produce at least one of, ideally several:",
    '  • a "Run Shell Script" helper (start-ollamas.sh / .command) that runs `make up` or `npm run dev` in the repo to start the server,',
    "  • an AppleScript (.applescript) that opens the ollamas cockpit at http://127.0.0.1:3000 in the browser,",
    "  • a shell script that POSTs a prompt to the ollamas API (curl http://127.0.0.1:3000/api/generate),",
    "  • a README.md explaining how to import the script into Automator.app as a Quick Action / Service.",
    "Make each file self-contained and correct. Do NOT execute anything — only WRITE the files.",
    "After writing, list each file you created on its own line with a one-line description.",
    "End with:  VERDICT: DONE <comma-separated filenames>",
  ].join("\n");
}

/** Live models via `ollama list` (mission/chrome-probe pattern); embedding models filtered out. */
function liveModels(): string[] {
  const explicit = flag("--models");
  if (explicit) return explicit.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const out = execFileSync("ollama", ["list"], { encoding: "utf8", timeout: 8000 });
    return out.trim().split("\n").slice(1).map((l) => l.split(/\s+/)[0]).filter((m) => m && !SKIP.test(m));
  } catch {
    return [];
  }
}

function nowIso(): string {
  try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

/** One sequential dispatch → parsed --json report. Never throws (a failed dispatch = an INCOMPLETE run). */
function dispatchModel(model: string, rootDir: string, steps: string = STEPS): DispatchReport {
  const provider = providerFor(model);
  try {
    const out = execFileSync(
      "node",
      [DISPATCH, taskFor(rootDir), "--model", model, "--provider", provider, "--root", rootDir, "--steps", steps, "--json"],
      { encoding: "utf8", timeout: TIMEOUT_MS, env: { ...process.env, OLLAMAS_URL }, maxBuffer: 8 * 1024 * 1024 }
    );
    return JSON.parse(out) as DispatchReport;
  } catch (e: any) {
    const stdout = typeof e?.stdout === "string" ? e.stdout : "";
    try { return JSON.parse(stdout) as DispatchReport; } catch { /* not JSON */ }
    const reason = e?.killed ? `timeout after ${TIMEOUT_MS}ms` : (e?.message || String(e)).slice(0, 200);
    return { model, steps: [], messages: [], errors: [reason], verdict: "INCOMPLETE", demoSuspected: false };
  }
}

/** Recursively list files (relative to base) that a model produced in its subdir. */
function scanArtifacts(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      // A .workflow bundle is itself the artifact — record it, don't descend into it.
      if (ent.isDirectory() && ent.name.toLowerCase().endsWith(".workflow")) { out.push(relative(baseDir, abs)); continue; }
      if (ent.isDirectory()) { walk(abs); continue; }
      out.push(relative(baseDir, abs));
    }
  };
  walk(baseDir);
  return out;
}

/** Read each produced file's content (capped) so daily-mode can detect a recurring schedule. Skips
 *  .workflow bundle dirs and any file >256KB (reads first 4KB — schedule keys sit near the top). */
function readContents(baseDir: string, files: string[]): FileContent[] {
  return files.map((name) => {
    const abs = join(baseDir, name);
    try {
      if (statSync(abs).isDirectory()) return { name, content: "" }; // .workflow bundle
      return { name, content: readFileSync(abs, "utf8").slice(0, 4096) };
    } catch { return { name, content: "" }; }
  });
}

function main(): void {
  const models = liveModels();
  const ts = nowIso();

  if (!models.length) {
    console.error("automator-probe: no models found (is `ollama list` available?). Use --models a,b to force.");
    process.exit(2);
  }

  if (DRY) {
    console.log(`automator-probe (dry) — task=${MODE}${LOOP ? " --loop" : ""} — ${models.length} model, sıralı. Root: ${ARTIFACT_ROOT}  Server: ${OLLAMAS_URL}`);
    for (const m of models) console.log(`  → ${m}  [${providerFor(m)}]  → ${join(ARTIFACT_ROOT, sanitizeModelDir(m))}`);
    console.log(`\nGörev örneği:\n${taskFor(join(ARTIFACT_ROOT, "<model>"))}`);
    return;
  }

  if (LOOP) {
    // A single daily run for one model: dispatch → scan → classify (reads the accumulated dir state, so a
    // retry that adds the missing plist is reflected). Reused every round.
    const runModel = (model: string, steps: number): DailyRow => {
      const dir = join(ARTIFACT_ROOT, sanitizeModelDir(model));
      mkdirSync(dir, { recursive: true });
      const report = dispatchModel(model, dir, String(steps));
      const files = readContents(dir, scanArtifacts(dir));
      const row = classifyDailyRun(model, report, files);
      process.stderr.write(`[automator-loop]     ${model.padEnd(24)} ${row.scheduled ? `♻️ recurring(${row.mechanism})` : row.produced ? "one-off" : "nothing"}\n`);
      return row;
    };

    const summaries: AutomatorLoopRound[] = [];
    const baseSteps = Number(STEPS);

    // hesapla/planla/kodla — round 1: dispatch ALL models.
    process.stderr.write(`[automator-loop] round 1 — ${models.length} model (steps ${baseSteps})\n`);
    let rows: DailyRow[] = models.map((m) => runModel(m, baseSteps));
    let recurring = rows.filter((r) => r.scheduled).length;
    let pend = pendingModels(rows);
    let dryRounds = 0;
    let round = 1;
    summaries.push({ round, targets: models.length, steps: baseSteps, recurring, newRecurring: recurring, pending: pend.length });

    // rounds 2+: recompute pending (hesapla), retry-set with a bigger step budget (planla), re-dispatch (kodla).
    while (shouldContinueLoop(round, MAX_ROUNDS, pend.length, dryRounds, MAX_DRY)) {
      round++;
      const steps = baseSteps + (round - 1) * 2;
      process.stderr.write(`[automator-loop] round ${round} — retry ${pend.length} pending (steps ${steps})\n`);
      const roundRows = pend.map((m) => runModel(m, steps));
      rows = applyRound(rows, roundRows);
      const now = rows.filter((r) => r.scheduled).length;
      const newRecurring = now - recurring;
      dryRounds = newRecurring > 0 ? 0 : dryRounds + 1;
      recurring = now;
      pend = pendingModels(rows);
      summaries.push({ round, targets: roundRows.length, steps, recurring, newRecurring, pending: pend.length });
    }

    writeFileSync(join(ORCH_DIR, "AUTOMATOR_LOOP.md"), renderAutomatorLoop(summaries, rows, MAX_ROUNDS, ts) + "\n");
    writeFileSync(join(ORCH_DIR, "AUTOMATOR_LOOP.json"), JSON.stringify({ ts, url: OLLAMAS_URL, root: ARTIFACT_ROOT, rounds: summaries, rows }, null, 2) + "\n");
    writeFileSync(join(ORCH_DIR, "AUTOMATOR_DAILY.md"), renderDailyProbe(rows, ts) + "\n");

    if (JSON_OUT) { console.log(JSON.stringify({ ts, rounds: summaries, rows })); return; }

    const converged = isLoopConverged(rows);
    console.log(`\nAUTOMATOR LOOP — ${converged ? "CONVERGED ✅" : `NOT CONVERGED (${summaries.length} round)`} · ${recurring}/${rows.length} recurring:`);
    for (const s of summaries) console.log(`  round ${s.round}: ${s.targets} dispatched (steps ${s.steps}) → +${s.newRecurring} new → ${s.recurring}/${rows.length} recurring, ${s.pending} pending`);
    console.log(`\nRecurring üretenler: ${rows.filter((r) => r.scheduled).map((r) => r.model).join(", ") || "(yok)"}`);
    if (pend.length) console.log(`Hâlâ pending (dürüst, cap sonrası): ${pend.join(", ")}`);
    console.log(`Takip: orchestration/AUTOMATOR_LOOP.md  ·  artefaktlar: ${ARTIFACT_ROOT}/<model>/ (kurulmadı — sadece üretildi)`);
    return;
  }

  if (DAILY) {
    const rows: DailyRow[] = [];
    for (const model of models) {
      const dir = join(ARTIFACT_ROOT, sanitizeModelDir(model));
      mkdirSync(dir, { recursive: true });
      process.stderr.write(`[automator-daily] → ${model} (${providerFor(model)}) → ${dir}\n`);
      const report = dispatchModel(model, dir);
      const files = readContents(dir, scanArtifacts(dir));
      const row = classifyDailyRun(model, report, files);
      rows.push(row);
      process.stderr.write(`[automator-daily]   ${row.produced ? "✅ produced" : "❌ nothing"} ${row.fileCount} file(s) · ${row.scheduled ? `♻️ recurring(${row.mechanism})` : "one-off"}  verdict=${row.verdict}\n`);
    }

    writeFileSync(join(ORCH_DIR, "AUTOMATOR_DAILY.md"), renderDailyProbe(rows, ts) + "\n");
    writeFileSync(join(ORCH_DIR, "AUTOMATOR_DAILY.json"), JSON.stringify({ ts, url: OLLAMAS_URL, root: ARTIFACT_ROOT, rows }, null, 2) + "\n");

    if (JSON_OUT) { console.log(JSON.stringify({ ts, rows })); return; }

    const prod = rows.filter((r) => r.produced);
    const rec = rows.filter((r) => r.scheduled);
    console.log(`\nAUTOMATOR DAILY — ${prod.length}/${rows.length} üretti · ${rec.length}/${rows.length} RECURRING (sıralı):`);
    for (const r of rows) console.log(`  ${r.produced ? "✅" : "❌"} ${r.model.padEnd(26)} ${String(r.fileCount).padStart(2)} dosya  ${r.scheduled ? `♻️ ${r.mechanism}`.padEnd(14) : "one-off".padEnd(14)} ${r.verdict}`);
    console.log(`\nArtefaktlar: ${ARTIFACT_ROOT}/<model>/  (kurulmadı — sadece üretildi)`);
    console.log(`Takip: orchestration/AUTOMATOR_DAILY.md`);
    return;
  }

  const rows: AutomatorRow[] = [];
  for (const model of models) {
    const dir = join(ARTIFACT_ROOT, sanitizeModelDir(model));
    mkdirSync(dir, { recursive: true });
    process.stderr.write(`[automator-probe] → ${model} (${providerFor(model)}) → ${dir}\n`);
    const report = dispatchModel(model, dir);
    const files = scanArtifacts(dir);
    const row = classifyAutomatorRun(model, report, files);
    rows.push(row);
    process.stderr.write(`[automator-probe]   ${row.produced ? "✅ produced" : "❌ nothing"} ${row.fileCount} file(s) [${row.kinds.join(",")}]  verdict=${row.verdict}\n`);
  }

  writeFileSync(join(ORCH_DIR, "AUTOMATOR_PROBE.md"), renderAutomatorProbe(rows, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "AUTOMATOR_PROBE.json"), JSON.stringify({ ts, url: OLLAMAS_URL, root: ARTIFACT_ROOT, rows }, null, 2) + "\n");

  if (JSON_OUT) { console.log(JSON.stringify({ ts, rows })); return; }

  const producers = rows.filter((r) => r.produced);
  console.log(`\nAUTOMATOR PROBE — ${producers.length}/${rows.length} model artefakt üretti (sıralı):`);
  for (const r of rows) console.log(`  ${r.produced ? "✅" : "❌"} ${r.model.padEnd(26)} ${String(r.fileCount).padStart(2)} dosya  [${r.kinds.join(",") || "-"}]  ${r.verdict}`);
  console.log(`\nArtefaktlar: ${ARTIFACT_ROOT}/<model>/`);
  console.log(`Takip: orchestration/AUTOMATOR_PROBE.md`);
}

main();
