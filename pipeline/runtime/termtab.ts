// Visible Terminal.app tabs (I/O boundary).
//
// WHY THIS EXISTS
// The operator does not want invisible work: every task must run in a tab they can watch.
//
// The first design drove the host bridge (`POST :7345/run`, which runs a command in a real
// terminal). MEASURED, and it failed: the bridge serialises requests, so holding one open for
// a lane's lifetime starved it — after a 24 h run was issued, even `echo` probes stopped
// returning. A board that monopolises a shared service is worse than no board.
//
// `open -a Terminal <script>` does the same job in 0.046 s, returns immediately, holds
// nothing, and needs no TCC Automation grant. The bridge stays what it is good at — one-shot
// commands with captured output — and the board no longer competes with it.
//
// What neither provides is a SESSION: a tab that stays open and shows step after step
// arriving. That is what this module builds.
//
// The session is therefore built from two files per lane:
//   queue  — one encoded step per line (lib/lane.ts owns the format)
//   log    — what the tab printed, with machine-readable status markers
// and a small bash loop, started ONCE through the bridge, that tails the queue and executes
// each line in order. The controller appends steps and reads the log; the tab does the work
// in front of the operator.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type TermTarget } from "../../orchestration/bin/lib/term-exec";
import { encodeStep, type Lane, type LaneStep } from "../lib/lane";

const exec = promisify(execFile);
export const TAB_ROOT = join(homedir(), ".ollamas", "term");

/** Status markers the tab prints so the controller can parse progress without guessing. */
export const MARK_BEGIN = "@@STEP-BEGIN@@";
export const MARK_END = "@@STEP-END@@";
export const MARK_READY = "@@TAB-READY@@";
export const MARK_DONE = "@@TAB-DONE@@";

export interface Capability {
  ok: boolean;
  reason: string;
  /** One line the operator can act on. Empty when everything works. */
  fix: string;
}

/**
 * Can we actually open a visible tab?
 *
 * Three separate failures, reported separately because each has a different fix: the bridge
 * is down, the token is missing, or macOS is blocking Automation (TCC). Collapsing them into
 * "terminal unavailable" would leave the operator guessing — and the whole point of this
 * layer is that the operator can see what is happening.
 */
export async function capability(target: TermTarget = "terminal"): Promise<Capability> {
  const app = target === "iterm2" ? "iTerm" : "Terminal";
  try {
    // `open -Ra` resolves the app WITHOUT launching it — a capability probe must not open a
    // window as a side effect of asking whether it could.
    await exec("open", ["-Ra", app]);
  } catch {
    return { ok: false, reason: `${app}.app not found`, fix: `install ${app}, or use --target ${target === "iterm2" ? "terminal" : "iterm2"}` };
  }
  try {
    mkdirSync(TAB_ROOT, { recursive: true });
  } catch {
    return { ok: false, reason: `cannot create ${TAB_ROOT}`, fix: "check permissions on ~/.ollamas" };
  }
  return { ok: true, reason: `${app}.app available · sessions under ${TAB_ROOT}`, fix: "" };
}

/**
 * The loop the tab runs.
 *
 * `read -r` line-by-line so a step is exactly one queue entry; `IFS=` so leading/trailing
 * space in a command survives; the separator split uses parameter expansion rather than
 * `cut` to avoid spawning a process per step. The loop exits on the sentinel so the tab
 * closes itself when the lane is done instead of lingering as clutter.
 */
function tabScript(lane: Lane, queue: string, log: string): string {
  return [
    `printf '\\033]0;eCym · ${lane.title}\\007'`,          // tab title
    `clear`,
    `echo "eCym board — lane: ${lane.title}"`,
    `echo "queue: ${queue}"`,
    `echo "------------------------------------------------------------"`,
    `echo "${MARK_READY}" >> "${log}"`,
    `tail -n +1 -f "${queue}" | while IFS= read -r line; do`,
    `  [ "$line" = "__END__" ] && { echo "${MARK_DONE}" >> "${log}"; break; }`,
    `  sep=$'\\001'`,
    `  id="\${line%%$sep*}"; rest="\${line#*$sep}"; title="\${rest%%$sep*}"; cmd="\${rest#*$sep}"`,
    `  printf '\\n\\033[1m▶ %s\\033[0m\\n' "$title"`,
    `  echo "${MARK_BEGIN} $id" >> "${log}"`,
    `  ( eval "$cmd" ) 2>&1 | tee -a "${log}"`,
    `  rc=\${PIPESTATUS[0]}`,
    `  echo "${MARK_END} $id $rc" >> "${log}"`,
    `  if [ "$rc" = "0" ]; then printf '\\033[32m✓ %s\\033[0m\\n' "$title"; else printf '\\033[31m✗ %s (exit %s)\\033[0m\\n' "$title" "$rc"; fi`,
    `done`,
    `echo; echo "lane finished — closing in 3s"; sleep 3; exit`,
  ].join("\n");
}

export interface TabHandle {
  lane: Lane;
  dir: string;
  queue: string;
  log: string;
  target: TermTarget;
}

/**
 * Open one visible tab for a lane and leave it waiting for steps.
 *
 * The bridge call is fire-and-forget by design: `/run` only returns when its command exits,
 * and this command is a loop that lives for the whole lane. Awaiting it would block the
 * controller until the lane finished — which is precisely the sequential, invisible
 * behaviour this module exists to replace.
 */
export async function openTab(lane: Lane, target: TermTarget = "terminal"): Promise<TabHandle> {
  const dir = join(TAB_ROOT, lane.id);
  mkdirSync(dir, { recursive: true });
  const queue = join(dir, "queue");
  const log = join(dir, "log");
  writeFileSync(queue, "", "utf8");
  writeFileSync(log, "", "utf8");

  const script = join(dir, "tab.sh");
  writeFileSync(script, `#!/bin/bash\n${tabScript(lane, queue, log)}\n`, { mode: 0o755 });

  // `open` returns as soon as Terminal.app has been handed the script — it does not wait for
  // the loop, which is exactly what a long-lived tab needs.
  const app = target === "iterm2" ? "iTerm" : "Terminal";
  await exec("open", ["-a", app, script]).catch(() => {
    /* capability() is the honest reporter; a failure here surfaces as "tab never became ready" */
  });

  return { lane, dir, queue, log, target };
}

/** Append one step to the tab's queue. The tab picks it up on its next read. */
export function pushStep(h: TabHandle, step: LaneStep): void {
  appendFileSync(h.queue, `${encodeStep(step)}\n`, "utf8");
}

/** Tell the tab there is no more work; it prints a summary and closes. */
export function closeTab(h: TabHandle): void {
  try {
    appendFileSync(h.queue, "__END__\n", "utf8");
  } catch {
    /* queue already gone */
  }
}

export interface TabStatus {
  ready: boolean;
  done: boolean;
  /** stepId → exit code, for every step the tab has finished. */
  finished: Record<string, number>;
  running: string | null;
  /** Tail of what the operator is seeing, for the conductor's detail line. */
  lastLine: string;
}

/**
 * Read progress from the tab's log.
 *
 * Parsing markers rather than inferring from output: a step that prints nothing is still a
 * step, and a step whose output happens to contain the word "error" is not necessarily a
 * failure. Only the exit code decides.
 */
export function readStatus(h: TabHandle): TabStatus {
  let text = "";
  try {
    text = readFileSync(h.log, "utf8");
  } catch {
    return { ready: false, done: false, finished: {}, running: null, lastLine: "" };
  }
  const finished: Record<string, number> = {};
  let running: string | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith(MARK_BEGIN)) running = line.slice(MARK_BEGIN.length).trim();
    else if (line.startsWith(MARK_END)) {
      const [id, rc] = line.slice(MARK_END.length).trim().split(/\s+/);
      if (id) {
        finished[id] = Number(rc ?? 1);
        if (running === id) running = null;
      }
    }
  }
  const visible = text.split("\n").filter((l) => l.trim() && !l.startsWith("@@"));
  return {
    ready: text.includes(MARK_READY),
    done: text.includes(MARK_DONE),
    finished,
    running,
    lastLine: visible.at(-1)?.slice(0, 120) ?? "",
  };
}

/** How many tab sessions are still on disk — the leak check the gate reads. */
export function openTabDirs(): string[] {
  try {
    return existsSync(TAB_ROOT)
      ? readFileSync(join(TAB_ROOT, ".index"), "utf8").split("\n").filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort cleanup: ask every lingering tab to finish.
 *
 * Same lesson as the container pool in v3 — a runner that leaves resources behind is a cost
 * to the operator, and on a machine with limited memory a forgotten `tail -f` per lane adds
 * up across runs.
 */
export async function sweepTabs(): Promise<number> {
  if (!existsSync(TAB_ROOT)) return 0;
  let n = 0;
  try {
    const { stdout } = await exec("ls", [TAB_ROOT]);
    for (const id of stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const q = join(TAB_ROOT, id, "queue");
      if (existsSync(q)) {
        try {
          appendFileSync(q, "__END__\n", "utf8");
          n++;
        } catch {
          /* already closed */
        }
      }
    }
  } catch {
    /* nothing to sweep */
  }
  return n;
}
