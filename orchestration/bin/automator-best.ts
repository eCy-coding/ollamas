#!/usr/bin/env tsx
/**
 * orchestration/bin/automator-best.ts — synthesize the daily-loop's per-model recurring automations into a
 * single install-ready BEST bundle. Reads AUTOMATOR_DAILY.json (vO37 loop output), ranks the recurring
 * automations, VALIDATES the top candidates (plutil -lint the plist + bash -n the script — syntax only,
 * never executed), and copies the best VALID one to ~/Desktop/ollamas-daily/BEST/ with a one-command
 * install README. Nothing is installed or run — `launchctl load` stays the operator's explicit choice.
 *
 * Run:  tsx orchestration/bin/automator-best.ts [--from <json>] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { rankAutomations, scoreAutomation, installCommand, renderBestReport, type BestPick, type Validation } from "./lib/automator-best";
import type { DailyRow } from "./lib/automator-probe";
import { sanitizeModelDir } from "./lib/automator-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const DAILY_ROOT = join(homedir(), "Desktop", "ollamas-daily");
const BEST_DIR = join(DAILY_ROOT, "BEST");

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const FROM = flag("--from", join(ORCH_DIR, "AUTOMATOR_DAILY.json"))!;

function nowIso(): string {
  try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

/** Validate a candidate's produced files WITHOUT executing them: plutil -lint the plist, bash -n the shell. */
function validate(modelDir: string): Validation {
  if (!existsSync(modelDir)) return { ok: false, plist: "missing dir", script: "missing dir", detail: "model dir not found" };
  const files = readdirSync(modelDir);
  const plist = files.find((f) => f.toLowerCase().endsWith(".plist"));
  const script = files.find((f) => /\.(sh|command|bash|zsh)$/i.test(f));
  let plistR = "n/a", scriptR = "n/a", ok = true;
  if (plist) {
    try { execFileSync("plutil", ["-lint", join(modelDir, plist)], { encoding: "utf8", timeout: 5000 }); plistR = "OK"; }
    catch (e: any) { plistR = `INVALID: ${(e?.stdout || e?.message || "").toString().split("\n")[0].slice(0, 60)}`; ok = false; }
  } else { plistR = "no plist"; ok = false; } // a recurring automation must carry a schedule file
  if (script) {
    try { execFileSync("bash", ["-n", join(modelDir, script)], { encoding: "utf8", timeout: 5000 }); scriptR = "OK"; }
    catch (e: any) { scriptR = `SYNTAX ERR: ${(e?.stderr || e?.message || "").toString().split("\n")[0].slice(0, 60)}`; ok = false; }
  } else { scriptR = "no script"; }
  return { ok, plist: plistR, script: scriptR, detail: `plist ${plistR} · script ${scriptR}` };
}

function loadRows(): DailyRow[] {
  const j = JSON.parse(readFileSync(FROM, "utf8"));
  return (j.rows ?? []) as DailyRow[];
}

function main(): void {
  if (!existsSync(FROM)) {
    console.error(`automator-best: ${FROM} yok — önce \`tsx orchestration/bin/automator-probe.ts --loop\` koş.`);
    process.exit(2);
  }
  const rows = loadRows();
  const ranked = rankAutomations(rows);
  const ts = nowIso();

  if (!ranked.length) {
    console.error("automator-best: hiç recurring otomasyon yok (AUTOMATOR_DAILY.json).");
    process.exit(2);
  }

  // Pick the highest-scoring candidate that PASSES validation (walk the ranking until one validates).
  let winner: BestPick | null = null;
  for (const r of ranked) {
    const v = validate(join(DAILY_ROOT, sanitizeModelDir(r.model)));
    process.stderr.write(`[automator-best] ${r.model.padEnd(24)} score ${String(scoreAutomation(r)).padStart(2)} · ${v.ok ? "✅ valid" : "⚠️ " + v.detail}\n`);
    if (v.ok && !winner) winner = { row: r, score: scoreAutomation(r), validation: v };
  }

  if (DRY) {
    console.log(`automator-best (dry) — ${ranked.length} recurring · winner: ${winner ? winner.row.model : "(none valid)"}`);
    return;
  }

  // Package the winner into BEST/ (fresh) + INSTALL.md. Copy is read→write of validated files only.
  if (winner) {
    const srcDir = join(DAILY_ROOT, sanitizeModelDir(winner.row.model));
    rmSync(BEST_DIR, { recursive: true, force: true });
    mkdirSync(BEST_DIR, { recursive: true });
    for (const f of readdirSync(srcDir)) {
      try { copyFileSync(join(srcDir, f), join(BEST_DIR, f)); } catch { /* skip dirs/unreadable */ }
    }
    const plistName = winner.row.artifacts.find((a) => a.kind === "plist")?.name
      ?? readdirSync(BEST_DIR).find((f) => f.toLowerCase().endsWith(".plist")) ?? "com.ollamas.daily.plist";
    const install = [
      `# BEST daily automation — from \`${winner.row.model}\` (score ${winner.score}, validated ✅)`,
      ``,
      `Validation: ${winner.validation.detail} (plutil -lint + bash -n; not executed).`,
      ``,
      `## Install (one command — YOUR explicit choice; nothing was auto-installed)`,
      "```bash",
      installCommand(plistName),
      "```",
      ``,
      `## Uninstall`,
      "```bash",
      `launchctl unload ~/Library/LaunchAgents/${plistName} && rm ~/Library/LaunchAgents/${plistName}`,
      "```",
    ].join("\n");
    writeFileSync(join(BEST_DIR, "INSTALL.md"), install + "\n");
  }

  writeFileSync(join(ORCH_DIR, "AUTOMATOR_BEST.md"), renderBestReport(ranked, winner, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "AUTOMATOR_BEST.json"), JSON.stringify({ ts, winner: winner ? { model: winner.row.model, score: winner.score, validation: winner.validation } : null, ranked: ranked.map((r) => ({ model: r.model, score: scoreAutomation(r), mechanism: r.mechanism, kinds: r.kinds })) }, null, 2) + "\n");

  console.log(`\nAUTOMATOR BEST — ${ranked.length} recurring sıralandı:`);
  if (winner) {
    console.log(`  🏆 kazanan: ${winner.row.model} (skor ${winner.score}, ✅ valid — ${winner.validation.detail})`);
    console.log(`  📦 install-ready: ${BEST_DIR}/  (kur: cat ${BEST_DIR}/INSTALL.md — launchctl load OPERATÖR kararı, oto-kurulum YOK)`);
  } else {
    console.log(`  ⚠️ hiç aday validation'dan geçmedi (dürüst) — en-iyi recurring ama plutil/bash-n başarısız.`);
  }
  console.log(`Takip: orchestration/AUTOMATOR_BEST.md`);
}

main();
