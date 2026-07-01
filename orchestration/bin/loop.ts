#!/usr/bin/env tsx
/**
 * orchestration/bin/loop.ts — the end-to-end convergence loop (single command).
 *
 * Each round runs the autopilot chain (reuse — NO new logic: benchprompt→council→fleet→critic→dod→
 * conduct→fuse→think→next→tasklist→status→dispatch→doctor), then reads the freshly-regenerated
 * MASTER_TASKLIST acceptance + FLEET_NEXT P1 queue → LoopState → isConverged? stop : repeat.
 * Bounded (default 3 rounds; --rounds N; --watch persistent). Writes docs/E2E_LOOP.md.
 *
 * Run:  tsx orchestration/bin/loop.ts [--rounds 3] [--watch] [--quiet]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHOR } from "./shared";
import { isConverged, shouldContinue, renderRound, renderLoopReport, type LoopState } from "./lib/loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(ANCHOR, "node_modules", ".bin", "tsx");

const QUIET = process.argv.includes("--quiet");
const WATCH = process.argv.includes("--watch");
const roundsArg = (() => { const i = process.argv.indexOf("--rounds"); return i >= 0 ? Number(process.argv[i + 1]) : NaN; })();
const MAX_ROUNDS = Number.isFinite(roundsArg) && roundsArg > 0 ? Math.floor(roundsArg) : 3;

/** Run the autopilot chain once (reuse; never-throw so a failed step never aborts the loop). */
function runAutopilotPass(): void {
  try {
    execFileSync(TSX, [join(HERE, "autopilot.ts"), "--quiet"], {
      stdio: ["ignore", "ignore", "pipe"], timeout: 600_000, cwd: ORCH_DIR,
    });
  } catch { /* autopilot summarizes its own step failures; the loop reads the resulting state below */ }
}

function readFileSafe(p: string): string { return existsSync(p) ? readFileSync(p, "utf8") : ""; }

/** Parse "## A. Master-directive acceptance (12/12)" → {done,total}. */
function readAcceptance(): { done: number; total: number } {
  const md = readFileSafe(join(REPO, "docs", "MASTER_TASKLIST.md"));
  const m = /acceptance \((\d+)\/(\d+)\)/.exec(md);
  return { done: Number(m?.[1] ?? 0), total: Number(m?.[2] ?? 0) };
}

/** Count P1 safe-additive rows still queued in FLEET_NEXT.md. */
function readNextP1(): number {
  const md = readFileSafe(join(ORCH_DIR, "FLEET_NEXT.md"));
  return (md.match(/P1 apply-additive/g) ?? []).length;
}

function nowIso(): string {
  try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function observeRound(round: number): LoopState {
  const acc = readAcceptance();
  return { acceptanceDone: acc.done, total: acc.total, gateClean: acc.done === acc.total, nextP1: readNextP1(), round };
}

async function runLoop(): Promise<LoopState[]> {
  const rounds: LoopState[] = [];
  let round = 1;
  // Loop the pass until convergence or the round cap; observe state AFTER each pass regenerates artefacts.
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    runAutopilotPass();
    const state = observeRound(round);
    rounds.push(state);
    if (!QUIET) console.error(`[loop] ${renderRound(state)}`);
    if (!shouldContinue(state, MAX_ROUNDS)) break;
    round += 1;
  }
  return rounds;
}

async function main(): Promise<void> {
  do {
    const rounds = await runLoop();
    const md = renderLoopReport(rounds, MAX_ROUNDS, nowIso());
    writeFileSync(join(REPO, "docs", "E2E_LOOP.md"), md.endsWith("\n") ? md : md + "\n");
    process.stdout.write(md + "\n");
    const last = rounds[rounds.length - 1];
    if (!QUIET) {
      console.error(`[loop] ${isConverged(last) ? "CONVERGED ✅" : `not converged after ${rounds.length} round(s)`} → docs/E2E_LOOP.md`);
    }
    // --watch: after converging (or hitting the cap) keep supervising — re-loop persistently, never exit.
  } while (WATCH);
}

if (process.argv[1] && /loop\.ts$/.test(process.argv[1])) main();
