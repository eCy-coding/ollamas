#!/usr/bin/env tsx
/**
 * orchestration/bin/gen-catalog.ts — derive the "enough" task set from the REAL project surface (iter-7).
 *
 * "Yeteri kadar sayı" = one grounded task per SUBSTANTIAL exported-symbol source file across every lane
 * (not a round 100). Walks the lane dirs, keeps files that (a) exist, (b) have an `export`, (c) are ≥ MIN_LOC
 * lines, (d) aren't tests/decls/barrels, and emits a `lane|target|goal|acceptance` line with a deterministic
 * additive goal by file type. Output → orchestration/TASKS.gen.txt, which build-tasks merges under the curated
 * TASKS_100.src.txt (curated wins on target-dedupe). Deterministic (no clock/random).
 *
 * Run:  tsx orchestration/bin/gen-catalog.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, type Stats } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTaskable, goalFor } from "./lib/gen-catalog-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const OUT = join(ORCH_DIR, "TASKS.gen.txt");

// lane label → { dir, maxDepth }
const LANES: { lane: string; dir: string; depth: number }[] = [
  { lane: "backend", dir: "server", depth: 3 },
  { lane: "frontend", dir: "src", depth: 3 },
  { lane: "cli", dir: "cli/lib", depth: 1 },
  { lane: "cli", dir: "cli/commands", depth: 1 },
  { lane: "scripts", dir: "scripts", depth: 1 },
  { lane: "orchestration", dir: "orchestration/bin/lib", depth: 1 },
  { lane: "contract", dir: "contract/src", depth: 2 },
  { lane: "tunnel", dir: "tunnel/src", depth: 2 },
  { lane: "host-bridge", dir: "bin/host-bridge", depth: 2 },
];

function walk(dir: string, depth: number, acc: string[] = []): string[] {
  const abs = join(REPO, dir);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    let st: Stats; try { st = statSync(join(REPO, rel)); } catch { continue; }
    if (st.isDirectory()) { if (depth > 1 && name !== "node_modules") walk(rel, depth - 1, acc); continue; }
    acc.push(rel);
  }
  return acc;
}

/** Thin IO wrapper: skip wrong-ext early (no read), else read body and defer to pure isTaskable. */
function taskable(rel: string): boolean {
  if (![".ts", ".tsx", ".mjs"].includes(extname(rel))) return false;
  let content: string;
  try { content = readFileSync(join(REPO, rel), "utf8"); } catch { return false; }
  return isTaskable(rel, content);
}

const lines: string[] = [];
const seen = new Set<string>();
for (const { lane, dir, depth } of LANES) {
  for (const rel of walk(dir, depth)) {
    if (seen.has(rel) || !taskable(rel)) continue;
    seen.add(rel);
    const { goal, acceptance } = goalFor(rel);
    lines.push(`${lane}|${rel}|${goal}|${acceptance}`);
  }
}

writeFileSync(OUT, lines.join("\n") + "\n");
const byLane = lines.reduce<Record<string, number>>((m, l) => { const k = l.split("|")[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`[gen-catalog] ${lines.length} taskable files → ${OUT}`);
console.log(`[gen-catalog] by lane: ${JSON.stringify(byLane)}`);
