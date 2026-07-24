#!/usr/bin/env -S npx tsx
// `ollamas pipeline job <name> [--visible]` — run MY OWN background jobs in a watchable tab.
//
// WHY THIS EXISTS
// v5 made the launchd jobs visible-as-inventory; v6's plan promised a `--visible` path to run
// them in a tab and never delivered it. This closes that. The four jobs below are the ones
// THIS project owns (cc-health, cc-refresh, cc-sync-all, and a pipeline run). They otherwise
// only ever run under launchd, where the operator cannot watch them.
//
// HARD BOUNDARY: only these four names are recognised. Emre's `com.ecy*` automation is his,
// and a tool that could run an arbitrary launchd job in a tab would be one keystroke away
// from touching it — so an unknown name is REFUSED, not best-effort matched.
//
// No new tab mechanism: it reuses `makeLane` + `openTab` (the board's engine) and pipes each
// job's output through `lib/logfmt` so a job's tab reads the same way the watch tab does —
// one format, not two.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeLane, type Lane } from "../lib/lane";
import { capability, openTab, pushStep, closeTab, readStatus } from "../runtime/termtab";
import type { TermTarget } from "../../orchestration/bin/lib/term-exec";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pipe a command through the readable formatter so a tab reads like the watch tab. */
const fmt = (label: string, cmd: string) =>
  `${cmd} 2>&1 | sed -u "s|^|${label}\\t|" | npx tsx "${join(REPO, "pipeline/lib/logfmt-stream.ts")}"`;

/**
 * The jobs this project owns. Each is a real script whose body is unchanged — only the way it
 * is invoked changes. `com.ecy*` is deliberately absent: it is not ours to run.
 */
export const JOBS: Record<string, { title: string; steps: Array<[string, string]> }> = {
  "cc-health": {
    title: "cc-health",
    steps: [["günlük sağlık turu", fmt("cc-health", `zsh ${VAULT}/_bin/cc-health.sh`)]],
  },
  "cc-refresh": {
    title: "cc-refresh",
    steps: [["haftalık kaynak taraması", fmt("cc-refresh", `python3 ${VAULT}/_bin/cc-refresh.py`)]],
  },
  "cc-sync-all": {
    title: "cc-sync-all",
    steps: [["12-adım KB senkron zinciri", fmt("cc-sync-all", `bash ${VAULT}/_bin/cc-sync-all.sh`)]],
  },
  "pipeline-run": {
    title: "pipeline-run",
    steps: [["18-adım pipeline koşusu", fmt("pipeline", `cd ${REPO} && npx tsx pipeline/bin/run.ts --profile simple --light --pool 2`)]],
  },
};

export function jobNames(): string[] {
  return Object.keys(JOBS);
}

function laneFor(name: string): Lane | null {
  const j = JOBS[name];
  return j ? makeLane(name, j.title, j.steps) : null;
}

export interface JobOptions {
  name: string;
  visible: boolean;
  target: TermTarget;
  timeoutMs: number;
}

export async function runJob(o: JobOptions): Promise<number> {
  const lane = laneFor(o.name);
  if (!lane) {
    // The refusal is the point. Never fall back to running an unrecognised launchd label.
    console.error(`job: bilinmeyen iş '${o.name}'.`);
    console.error(`  tanınan (yalnız bu projeye ait): ${jobNames().join(", ")}`);
    console.error(`  Emre'nin com.ecy* işleri bu araçla ÇALIŞTIRILMAZ — onlar dokunulmaz.`);
    return 2;
  }

  if (o.visible) {
    const cap = await capability(o.target);
    if (!cap.ok) {
      console.error(`job: sekme açılamıyor — ${cap.reason}\n  çözüm: ${cap.fix}`);
      return 1;
    }
    const h = await openTab(lane, o.target);
    for (let i = 0; i < 40 && !readStatus(h).ready; i++) await sleep(200);
    if (!readStatus(h).ready) {
      console.error(`job: '${o.name}' sekmesi hazır olmadı`);
      return 1;
    }
    const step = lane.steps[0];
    step.startedMs = Date.now();
    pushStep(h, step);
    const deadline = Date.now() + o.timeoutMs;
    while (Date.now() < deadline) {
      const st = readStatus(h);
      if (st.finished[step.id] !== undefined) {
        step.exitCode = st.finished[step.id];
        break;
      }
      await sleep(400);
    }
    closeTab(h);
    console.log(`job '${o.name}' sekmede koşuyor — canlı izle. çıkış: ${step.exitCode ?? "(zaman aşımı)"}`);
    return step.exitCode ?? 124;
  }

  // Headless: run in-process, same command, no window. For CI / launchd wrappers.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  try {
    const { stdout } = await exec("bash", ["-lc", JOBS[o.name].steps[0][1]], {
      timeout: o.timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    return 0;
  } catch (e) {
    const err = e as { stdout?: string; code?: number };
    if (err.stdout) process.stdout.write(err.stdout);
    return err.code ?? 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const name = argv.find((a) => !a.startsWith("--")) ?? "";
  if (!name) {
    console.log(`ollamas pipeline job <ad> [--visible] [--target terminal|iterm2]\n  işler: ${jobNames().join(", ")}`);
    process.exit(0);
  }
  const get = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  runJob({
    name,
    visible: argv.includes("--visible"),
    target: get("--target", "terminal") as TermTarget,
    timeoutMs: Number(get("--timeout", "600000")),
  })
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`job: ${(e as Error).message}`);
      process.exit(2);
    });
}
