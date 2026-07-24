#!/usr/bin/env -S npx tsx
// The readable watch tab — 45 jobs, one aligned stream.
//
// WHY THIS EXISTS
// `supervise.ts` (v5) made the background visible by prefixing raw `tail -F` output with a
// job label. Visible, but not readable: four timestamp formats, severity sometimes stated
// and sometimes not, component names in three different shapes. This runs the same tails
// through `lib/logfmt.ts` so every line arrives as
//
//   HH:MM:SS │ iş                   │ SEVİYE  │ kaynak: mesaj
//
// Two deliberate choices carried from the formatter: severity is always a WORD (colour is
// lost in a pipe, in a screenshot, and to a colour-blind reader), and repeated lines are
// FOLDED with a count rather than dropped — 200 identical errors is the signal.
//
// The renderer runs INSIDE the tab, not here: the tab must keep updating after this process
// exits, which is the whole point of a watch window.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TAB_ROOT, capability } from "../runtime/termtab";

const exec = promisify(execFile);
const REPO = process.env.OLLAMAS_REPO ?? join(homedir(), "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(homedir(), "ollamas-vault");

interface Job { label: string; owner: string; running: boolean; logs: string[]; log_age_min: number | null }

async function inventory(): Promise<Job[]> {
  const { stdout } = await exec("python3", [join(VAULT, "_bin", "bg-audit.py"), "--json"], {
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return (JSON.parse(stdout) as { jobs: Job[] }).jobs;
}

/**
 * The tab script: tail every log, tag each line, pipe through ONE formatter.
 *
 * `--raw` skips the formatter — that is the entire supervisor mode, folded in here so there
 * is a single watch surface instead of two files (`watch.ts` + `supervise.ts`) tailing the
 * same logs and drifting apart. The formatter is `lib/logfmt-stream.ts`, the same seam a
 * `--visible` job uses, so a line reads identically wherever it appears.
 */
function watchScript(jobs: Job[], opts: { only: string; plain: boolean; jobWidth: number; raw: boolean }): string {
  const title = opts.raw ? "SÜPERVİZÖR (ham)" : "İZLEME";
  const lines = [
    `printf '\\033]0;eCym · ${title}\\007'`,
    `clear`,
    `echo "eCym ${opts.raw ? "süpervizör — ham akış" : "izleme — okunabilir akış"} · ${jobs.length} arka plan işi"`,
    `echo "filtre: ${opts.only || "hepsi"}   ·   renk: ${opts.plain ? "kapalı" : "açık"}   ·   çıkmak: Ctrl-C"`,
    `echo "hiçbir iş durdurulmadı — yalnız ${opts.raw ? "tek pencerede toplandı" : "okunur hâle getirildi"}"`,
    `echo`,
    `export LOGFMT_ONLY='${opts.only}' LOGFMT_PLAIN='${opts.plain ? 1 : 0}' LOGFMT_JOBW='${opts.jobWidth}'`,
    // One process group so Ctrl-C takes every tail with it — a closed tab must not leave a
    // dozen orphaned `tail` processes behind (v5 lesson, kept).
    `trap 'kill 0' EXIT INT TERM`,
    `{`,
  ];
  for (const j of jobs) {
    const tag = j.label.replace(/^com\./, "");
    for (const log of j.logs) {
      // `-F` (not `-f`): launchd rotates and recreates logs, and lowercase `-f` follows the
      // deleted inode — the window would look calm exactly when a job restarted.
      lines.push(`  ( tail -F -n 1 "${log}" 2>/dev/null | sed -u "s|^|${tag}\\t|" ) &`);
    }
  }
  const sink = opts.raw ? "cat" : `npx tsx "${join(REPO, "pipeline/lib/logfmt-stream.ts")}"`;
  lines.push(`  wait`, `} | ${sink}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const get = (k: string, d = "") => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const only = get("--only");
  const source = get("--source");
  const plain = argv.includes("--plain");
  const raw = argv.includes("--raw");
  const max = Number(get("--max", "24"));

  const cap = await capability("terminal");
  if (!cap.ok) {
    console.error(`watch: ${cap.reason}\n  fix: ${cap.fix}`);
    return 1;
  }

  const all = await inventory();
  // Default to jobs that are alive or recently wrote: tailing 100 idle logs fills the window
  // with silence and buries the handful actually producing output.
  let jobs = all.filter((j) => j.logs.length && (j.running || (j.log_age_min ?? 9e9) < 120));
  if (source) jobs = jobs.filter((j) => j.label.includes(source));
  jobs = jobs.slice(0, max);

  if (!jobs.length) {
    console.log(`izlenecek log yok${source ? ` (--source ${source})` : ""}`);
    return 1;
  }

  const dir = join(TAB_ROOT, "_watch");
  mkdirSync(dir, { recursive: true });
  const jobWidth = Math.min(24, Math.max(12, ...jobs.map((j) => j.label.replace(/^com\./, "").length)));
  const script = join(dir, "watch.sh");
  writeFileSync(script, `#!/bin/bash\n${watchScript(jobs, { only, plain, jobWidth, raw })}\n`, { mode: 0o755 });

  await exec("open", ["-a", "Terminal", script]);

  const byOwner = jobs.reduce<Record<string, number>>((a, j) => ({ ...a, [j.owner]: (a[j.owner] ?? 0) + 1 }), {});
  const files = jobs.reduce((n, j) => n + j.logs.length, 0);
  console.log(`${raw ? "süpervizör (ham)" : "izleme"} sekmesi açıldı — ${jobs.length} iş · ${files} log dosyası`);
  console.log(`  sahiplik: ${Object.entries(byOwner).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(raw ? "  biçim: ham log (etiketli)" : `  biçim: saat │ iş │ SEVİYE │ kaynak: mesaj${only ? `   (filtre: ${only})` : ""}`);
  console.log(raw ? "  okunabilir akış: --raw'ı kaldır" : "  ham akış: --raw ekle");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c)).catch((e) => {
    console.error(`watch: ${(e as Error).message}`);
    process.exit(2);
  });
}
