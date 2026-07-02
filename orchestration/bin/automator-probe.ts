#!/usr/bin/env tsx
/**
 * orchestration/bin/automator-probe.ts — hand every model the SAME task one-by-one (sequential; single-GPU
 * truth): author macOS Automator-compatible artifacts (Quick Action / Run Shell Script / AppleScript /
 * shell) that SUPPORT the ollamas project, into its own ~/Desktop/ollamas-automator/<model>/ directory.
 * Then track WHAT EACH MODEL PRODUCED by scanning its directory. Writes AUTOMATOR_PROBE.md/.json.
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
import { writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { providerFor, classifyAutomatorRun, renderAutomatorProbe, sanitizeModelDir, type AutomatorRow } from "./lib/automator-probe";
import type { DispatchReport } from "./lib/chrome-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const DISPATCH = join(REPO, "scripts", "agent-dispatch.mjs");
const ARTIFACT_ROOT = join(homedir(), "Desktop", "ollamas-automator");

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const JSON_OUT = argv.includes("--json");
const DRY = argv.includes("--dry");
const STEPS = flag("--steps", "6")!;
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const TIMEOUT_MS = Number(process.env.AUTOMATOR_PROBE_TIMEOUT_MS || "150000");

const SKIP = /embed|nomic/i; // embedding models can't drive a tool loop

function taskFor(rootDir: string): string {
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
function dispatchModel(model: string, rootDir: string): DispatchReport {
  const provider = providerFor(model);
  try {
    const out = execFileSync(
      "node",
      [DISPATCH, taskFor(rootDir), "--model", model, "--provider", provider, "--root", rootDir, "--steps", STEPS, "--json"],
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

function main(): void {
  const models = liveModels();
  const ts = nowIso();

  if (!models.length) {
    console.error("automator-probe: no models found (is `ollama list` available?). Use --models a,b to force.");
    process.exit(2);
  }

  if (DRY) {
    console.log(`automator-probe (dry) — ${models.length} model, sıralı. Root: ${ARTIFACT_ROOT}  Server: ${OLLAMAS_URL}`);
    for (const m of models) console.log(`  → ${m}  [${providerFor(m)}]  → ${join(ARTIFACT_ROOT, sanitizeModelDir(m))}`);
    console.log(`\nGörev örneği:\n${taskFor(join(ARTIFACT_ROOT, "<model>"))}`);
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
