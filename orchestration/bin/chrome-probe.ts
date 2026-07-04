#!/usr/bin/env tsx
/**
 * orchestration/bin/chrome-probe.ts — CAPABILITY verdict probe: can a local model actually OPEN Google
 * Chrome by driving a shell tool? Dispatches the open-Chrome job to every model sequentially (single-GPU
 * truth) and records which are capable.
 *
 * For each model it invokes scripts/agent-dispatch.mjs (reuse — POST /api/agent/chat, SSE, --json report),
 * then classifies the run (chrome-probe lib) into a capability verdict. Writes CHROME_PROBE.md/.json.
 *
 * Ethics: opening Chrome runs on the operator's OWN Mac and was explicitly requested → the request IS the
 * gate for the privileged macos_terminal tier. Bounded (per-model timeout, sequential). No other host.
 *
 * Run:  tsx orchestration/bin/chrome-probe.ts [--models a,b] [--steps 4] [--dry] [--json]
 * Env:  OLLAMAS_URL (default http://127.0.0.1:3000 — the live server), CHROME_PROBE_TIMEOUT_MS (default 90000).
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRow, renderChromeProbe, providerFor, buildShortcutRow, renderShortcutsProbe,
  type ChromeProbeRow, type ChromeShortcutRow, type DispatchReport,
} from "./lib/chrome-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const DISPATCH = join(REPO, "scripts", "agent-dispatch.mjs");

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const JSON_OUT = argv.includes("--json");
const DRY = argv.includes("--dry");
const STEPS = flag("--steps", "4")!;
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.CHROME_PROBE_TIMEOUT_MS || "90000");

// Embedding-only models can't drive a ReAct/tool loop → skip (they'd trivially fail and add noise).
const SKIP = /embed|nomic/i;

// --task open (default): pure open-Chrome capability. --task shortcuts (vO34): open Chrome AND enumerate
// the dev/AI keyboard shortcuts used to drive it (scored against the ground-truth in lib/chrome-probe.ts).
const MODE = (flag("--task", "open") || "open").toLowerCase();
const SHORTCUTS = MODE === "shortcuts";

const OPEN_TASK = [
  "Open the Google Chrome app on this Mac so it becomes visible.",
  'Run this exact terminal command:  open -a "Google Chrome"',
  'Then confirm Chrome is running with:  pgrep -x "Google Chrome"',
  "Do NOT write any files. Use a terminal/shell tool only.",
  'When Chrome is open, emit exactly:  VERDICT: DONE Chrome opened',
].join("\n");

const SHORTCUTS_TASK = [
  "Open the Google Chrome app on this Mac, then report the keyboard shortcuts a developer/AI uses to drive it.",
  'Step 1 — run this exact terminal command:  open -a "Google Chrome"',
  'Step 2 — confirm it is running with:  pgrep -x "Google Chrome"',
  "Step 3 — list the macOS Google Chrome keyboard shortcuts a developer or AI browser-agent uses to control",
  "the browser: focus address bar, new tab, close tab, reopen tab, reload, hard reload, open DevTools, open",
  "the JavaScript console, inspect element, view source, find in page, incognito, back, forward.",
  'Write each on its own line as:  Combo — purpose   (e.g.  Cmd+Opt+I — open DevTools).',
  "Do NOT write any files. Use a terminal/shell tool only for opening Chrome.",
  "When Chrome is open AND you have listed the shortcuts, end with:  VERDICT: DONE Chrome opened",
].join("\n");

const TASK = SHORTCUTS ? SHORTCUTS_TASK : OPEN_TASK;

/** Live models via `ollama list` (mission.ts pattern); embedding models filtered out. */
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
function dispatchModel(model: string): DispatchReport {
  const provider = providerFor(model);
  try {
    const out = execFileSync(
      "node",
      [DISPATCH, TASK, "--model", model, "--provider", provider, "--steps", STEPS, "--json"],
      { encoding: "utf8", timeout: TIMEOUT_MS, env: { ...process.env, OLLAMAS_URL }, maxBuffer: 8 * 1024 * 1024 }
    );
    return JSON.parse(out) as DispatchReport;
  } catch (e: any) {
    // execFileSync throws on non-zero exit (dispatch exits 1 when a run isn't fully OK) — the JSON report
    // is still on stdout in that case. Parse it; fall back to an error report only if stdout isn't JSON.
    const stdout = typeof e?.stdout === "string" ? e.stdout : "";
    try { return JSON.parse(stdout) as DispatchReport; } catch { /* not JSON */ }
    const reason = e?.killed ? `timeout after ${TIMEOUT_MS}ms` : (e?.message || String(e)).slice(0, 200);
    return { model, steps: [], messages: [], errors: [reason], verdict: "INCOMPLETE", demoSuspected: false };
  }
}

function main(): void {
  const models = liveModels();
  const ts = nowIso();

  if (!models.length) {
    console.error("chrome-probe: no models found (is `ollama list` available?). Use --models a,b to force.");
    process.exit(2);
  }

  if (DRY) {
    console.log(`chrome-probe (dry) — task=${MODE} — ${models.length} model, sıralı. Server: ${OLLAMAS_URL}`);
    for (const m of models) console.log(`  → ${m}  [${providerFor(m)}]  steps=${STEPS}`);
    console.log(`Görev:\n${TASK}`);
    return;
  }

  if (SHORTCUTS) {
    const rows: ChromeShortcutRow[] = [];
    for (const model of models) {
      process.stderr.write(`[chrome-probe:shortcuts] → ${model} (${providerFor(model)}) …\n`);
      const report = dispatchModel(model);
      const fullText = (report.messages ?? []).join("\n"); // full answer for shortcut extraction (not the 200-char proof)
      const row = buildShortcutRow(model, report, fullText);
      rows.push(row);
      process.stderr.write(`[chrome-probe:shortcuts]   ${row.capable ? "✅ opened" : "❌ no"}  shortcuts=${row.shortcutHits}/${row.shortcutTotal}\n`);
    }

    writeFileSync(join(ORCH_DIR, "CHROME_SHORTCUTS.md"), renderShortcutsProbe(rows, ts) + "\n");
    writeFileSync(join(ORCH_DIR, "CHROME_SHORTCUTS.json"), JSON.stringify({ ts, url: OLLAMAS_URL, rows }, null, 2) + "\n");

    if (JSON_OUT) { console.log(JSON.stringify({ ts, rows })); return; }

    const opened = rows.filter((r) => r.capable);
    const knew = rows.filter((r) => r.shortcutHits > 0);
    console.log(`\nCHROME SHORTCUTS PROBE — ${opened.length}/${rows.length} Chrome açtı · ${knew.length}/${rows.length} ≥1 gerçek kısa-yol adlandırdı:`);
    for (const r of rows) console.log(`  ${r.capable ? "✅" : "❌"} ${r.model.padEnd(26)} kısa-yol ${String(r.shortcutHits).padStart(2)}/${r.shortcutTotal}  ${r.provider}`);
    console.log(`Detay: orchestration/CHROME_SHORTCUTS.md`);
    return;
  }

  const rows: ChromeProbeRow[] = [];
  for (const model of models) {
    process.stderr.write(`[chrome-probe] → ${model} (${providerFor(model)}) …\n`);
    const report = dispatchModel(model);
    const row = buildRow(model, report);
    rows.push(row);
    process.stderr.write(`[chrome-probe]   ${row.capable ? "✅ CAPABLE" : "❌ no"}  verdict=${row.verdict}\n`);
  }

  writeFileSync(join(ORCH_DIR, "CHROME_PROBE.md"), renderChromeProbe(rows, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "CHROME_PROBE.json"), JSON.stringify({ ts, url: OLLAMAS_URL, rows }, null, 2) + "\n");

  if (JSON_OUT) { console.log(JSON.stringify({ ts, rows })); return; }

  const capable = rows.filter((r) => r.capable);
  console.log(`\nCHROME PROBE — ${capable.length}/${rows.length} model Chrome açabildi (sıralı test):`);
  for (const r of rows) console.log(`  ${r.capable ? "✅" : "❌"} ${r.model.padEnd(26)} ${r.verdict.padEnd(11)} ${r.provider}`);
  console.log(`\nAçabilenler: ${capable.length ? capable.map((r) => r.model).join(", ") : "(yok)"}`);
  console.log(`Detay: orchestration/CHROME_PROBE.md`);
}

main();
