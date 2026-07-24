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
 * The formatter the tab runs, as a standalone script.
 *
 * Written to disk and invoked by the tab rather than piped from here, because this process
 * exits as soon as the window is open — a formatter living in it would take the stream with
 * it. It reads `job\ttext` on stdin (the tails tag their own lines) and prints the rendered
 * form.
 */
function formatterScript(): string {
  return `#!/usr/bin/env -S npx tsx
import { createInterface } from "node:readline";
import { parseLine, renderLine, isNoise, fold, levelFilter, header } from "${join(REPO, "pipeline/lib/logfmt.ts")}";

const only = process.env.WATCH_ONLY || "";
const plain = process.env.WATCH_PLAIN === "1";
const jobWidth = Number(process.env.WATCH_JOBW || 20);
const pass = levelFilter(only);
let st = { lastKey: "", count: 0 };

for (const h of header(jobWidth)) console.log(h);

createInterface({ input: process.stdin }).on("line", (line) => {
  const tab = line.indexOf("\\t");
  const job = tab > 0 ? line.slice(0, tab) : "?";
  const text = tab > 0 ? line.slice(tab + 1) : line;
  if (isNoise(text)) return;
  const parsed = parseLine(text, job);
  if (!parsed || !pass(parsed.level)) return;
  const f = fold(parsed, st);
  st = f.state;
  if (f.emit) console.log(f.emit);          // "  ×N" for the run that just ended
  if (st.count === 1) console.log(renderLine(parsed, { colour: !plain, jobWidth, width: Number(process.env.COLUMNS || 140) }));
});
`;
}

function watchScript(jobs: Job[], fmt: string, opts: { only: string; plain: boolean; jobWidth: number }): string {
  const lines = [
    `printf '\\033]0;eCym · İZLEME\\007'`,
    `clear`,
    `echo "eCym izleme — ${jobs.length} arka plan işi, okunabilir akış"`,
    `echo "filtre: ${opts.only || "hepsi"}   ·   renk: ${opts.plain ? "kapalı" : "açık"}   ·   çıkmak: Ctrl-C"`,
    `echo "hiçbir iş durdurulmadı — yalnız okunur hâle getirildi"`,
    `echo`,
    `export WATCH_ONLY='${opts.only}' WATCH_PLAIN='${opts.plain ? 1 : 0}' WATCH_JOBW='${opts.jobWidth}'`,
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
  lines.push(`  wait`, `} | npx tsx "${fmt}"`);
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
  const fmt = join(dir, "format.ts");
  writeFileSync(fmt, formatterScript(), { mode: 0o755 });
  const jobWidth = Math.min(24, Math.max(12, ...jobs.map((j) => j.label.replace(/^com\./, "").length)));
  const script = join(dir, "watch.sh");
  writeFileSync(script, `#!/bin/bash\n${watchScript(jobs, fmt, { only, plain, jobWidth })}\n`, { mode: 0o755 });

  await exec("open", ["-a", "Terminal", script]);

  const byOwner = jobs.reduce<Record<string, number>>((a, j) => ({ ...a, [j.owner]: (a[j.owner] ?? 0) + 1 }), {});
  const files = jobs.reduce((n, j) => n + j.logs.length, 0);
  console.log(`izleme sekmesi açıldı — ${jobs.length} iş · ${files} log dosyası`);
  console.log(`  sahiplik: ${Object.entries(byOwner).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`  biçim: saat │ iş │ SEVİYE │ kaynak: mesaj${only ? `   (filtre: ${only})` : ""}`);
  console.log(`  ham akış isteniyorsa: npx tsx pipeline/bin/supervise.ts`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c)).catch((e) => {
    console.error(`watch: ${(e as Error).message}`);
    process.exit(2);
  });
}
