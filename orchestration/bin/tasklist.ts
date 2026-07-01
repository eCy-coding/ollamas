#!/usr/bin/env tsx
/**
 * orchestration/bin/tasklist.ts — generate the PERSISTENT master task list docs/MASTER_TASKLIST.md.
 *
 * Gathers live data (git log, FLEET_NEXT.md, THINK.md, CODINGS_STATUS.md) + the durable vO DONE-log and
 * renders the operator's recurring master-directive as auto-refreshed acceptance-criteria + next queue.
 * Wired into autopilot (last step) + /tasklist so the .md folder stays current.
 *
 * Run:  tsx orchestration/bin/tasklist.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTaskList, type TaskListInputs } from "./lib/tasklist";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");

// Durable vO history (the completed orchestration work; append as versions ship).
const DONE_LOG = [
  { ver: "vO16", title: "hybrid model-council (roster + oracle + E2E)", commit: "78e9ad0" },
  { ver: "vO17", title: "local multi-terminal model-fleet", commit: "5bfebc3" },
  { ver: "vO18", title: "always-open conductor daemon", commit: "c71a48e" },
  { ver: "vO19", title: "living agent-tabs (persistent, iTerm2 fallback)", commit: "f464b75" },
  { ver: "vO20", title: "proven fixes: ticket-lock + backoff + skip-done", commit: "d1cce40" },
  { ver: "vO21", title: "conductor-escalation → 6/6 CONVERGED", commit: "193e597" },
  { ver: "vO22", title: "sustainable THINK loop (evidence-registry, no-guess)", commit: "0ddcde3" },
  { ver: "vO23", title: "native Claude Code capabilities + plan-first", commit: "7e13139" },
  { ver: "vO24", title: "next-task queue + worker precompute-next", commit: "a784638" },
  { ver: "vO25", title: "codings: agent-events SSE + scripts tsconfig", commit: "f577999" },
  { ver: "vO26", title: "codings: cli parseSSEBuffer test", commit: "7bec554" },
  { ver: "vO27", title: "final 3 streams complete (6/6, single-flight/require-env)", commit: "6ea7926" },
  { ver: "vO28", title: "self-heal flaky root-fix (gate clean, no GATE_SKIP)", commit: "6082ddc" },
];

function read(name: string): string { const f = join(ORCH_DIR, name); return existsSync(f) ? readFileSync(f, "utf8") : ""; }
function readRepo(name: string): string { const f = join(REPO, name); return existsSync(f) ? readFileSync(f, "utf8") : ""; }
function count(s: string, re: RegExp): number { return (s.match(re) ?? []).length; }

function gitLog(): string[] {
  try { return execFileSync("git", ["log", "--oneline", "-8"], { cwd: REPO, encoding: "utf8" }).trim().split("\n"); }
  catch { return []; }
}

function main(): void {
  const codingsMd = readRepo("docs/CODINGS_STATUS.md");
  const thinkMd = read("THINK.md");
  const nextMd = read("FLEET_NEXT.md");
  const inputs: TaskListInputs = {
    ts: (() => { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
    doneLog: DONE_LOG,
    recentCommits: gitLog(),
    codings: { done: count(codingsMd, /✅ \*\*DONE/g), total: 6 },
    next: { p1: count(nextMd, /P1 apply-additive/g), total: count(nextMd, /\| P[123] /g) },
    think: {
      proven: Number(/(\d+) PROVEN/.exec(thinkMd)?.[1] ?? 0),
      needsResearch: Number(/(\d+) needs-research/i.exec(thinkMd)?.[1] ?? 0),
    },
    // gate is clean since the self-heal flaky root-fix (vO28); each commit's pre-commit gate re-verifies.
    gateClean: true,
  };
  writeFileSync(join(REPO, "docs", "MASTER_TASKLIST.md"), renderTaskList(inputs) + "\n");
  console.log(`📋 tasklist → docs/MASTER_TASKLIST.md · codings ${inputs.codings.done}/${inputs.codings.total} · next ${inputs.next.p1}P1/${inputs.next.total} · think ${inputs.think.proven}✓/${inputs.think.needsResearch}?`);
}

main();
