#!/usr/bin/env -S npx tsx
// The supervisor tab — every background job's output in one visible window.
//
// WHY THIS EXISTS
// *"Arka planları görmek istemiyorum."* Measured on this machine: **100 launchd jobs, 35 of
// them running**, plus 26 independent node/python processes — none of it visible. The
// operator cannot watch what has no window.
//
// Nothing is stopped. `com.ecy*` is Emre's own automation and killing it would be an
// irreversible change nobody asked for; `com.ollamas.*` is this project's, and it still has
// work to do. What changes is that their output now lands somewhere the operator can see:
// one tab, one line per event, each line labelled with the job it came from.
//
// `tail -F` (capital F) rather than `-f`: launchd jobs rotate and recreate their logs, and
// lowercase `-f` silently follows a deleted inode — the tab would look calm precisely when a
// job restarted.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TAB_ROOT } from "../runtime/termtab";

const exec = promisify(execFile);
const VAULT = process.env.OBSIDIAN_VAULT ?? join(homedir(), "ollamas-vault");

interface Job {
  label: string;
  owner: string;
  running: boolean;
  logs: string[];
  log_age_min: number | null;
}

async function inventory(): Promise<{ jobs: Job[] }> {
  const { stdout } = await exec("python3", [join(VAULT, "_bin", "bg-audit.py"), "--json"], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout) as { jobs: Job[] };
}

/**
 * Build the supervisor script.
 *
 * One `tail -F` per log, each piped through a labeller, all backgrounded into a single tab.
 * The label is prefixed per line rather than printed once per file, because interleaved
 * output from a dozen jobs is unreadable otherwise — the operator needs to know which job
 * spoke without scrolling back.
 */
function superviseScript(jobs: Job[], maxFiles: number): string {
  const withLogs = jobs.filter((j) => j.logs.length).slice(0, maxFiles);
  const lines = [
    `printf '\\033]0;eCym · SÜPERVİZÖR\\007'`,
    `clear`,
    `echo "eCym süpervizör — arka plan işleri tek pencerede"`,
    `echo "izlenen log: ${withLogs.reduce((n, j) => n + j.logs.length, 0)} · iş: ${withLogs.length}"`,
    `echo "hiçbir iş durdurulmadı — yalnız görünür kılındı"`,
    `echo "çıkmak için Ctrl-C"`,
    `echo "------------------------------------------------------------"`,
    // Ctrl-C must take the whole group down, otherwise closing the tab leaves a dozen
    // orphaned `tail` processes behind — the same leak lesson as the container pool.
    `trap 'kill 0' EXIT INT TERM`,
  ];
  for (const j of withLogs) {
    const tag = j.label.replace(/^com\./, "").slice(0, 26);
    for (const log of j.logs) {
      lines.push(`( tail -F -n 2 "${log}" 2>/dev/null | sed -u "s|^|[${tag}] |" ) &`);
    }
  }
  lines.push(`wait`);
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const maxFiles = Number(argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : "24");
  const onlyRunning = !argv.includes("--all");
  const target = argv.includes("--iterm2") ? "iTerm" : "Terminal";

  const inv = await inventory();
  // Default to jobs that are actually alive: tailing 100 idle logs fills the window with
  // silence and hides the handful that are producing output right now.
  const jobs = inv.jobs.filter((j) => j.logs.length && (!onlyRunning || j.running || (j.log_age_min ?? 9e9) < 60));

  if (!jobs.length) {
    console.log("izlenecek log bulunamadı (bg-audit.py --json boş döndü)");
    return 1;
  }

  const dir = join(TAB_ROOT, "_supervisor");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "supervise.sh");
  writeFileSync(script, `#!/bin/bash\n${superviseScript(jobs, maxFiles)}\n`, { mode: 0o755 });

  await exec("open", ["-a", target, script]);

  const byOwner = jobs.reduce<Record<string, number>>((a, j) => ({ ...a, [j.owner]: (a[j.owner] ?? 0) + 1 }), {});
  console.log(`süpervizör sekmesi açıldı — ${jobs.length} iş izleniyor`);
  console.log(`  sahiplik: ${Object.entries(byOwner).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`  script: ${script}`);
  console.log(`  hiçbir iş durdurulmadı; Ctrl-C sekmedeki tüm tail'leri kapatır`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c)).catch((e) => {
    console.error(`supervise: ${(e as Error).message}`);
    process.exit(2);
  });
}
