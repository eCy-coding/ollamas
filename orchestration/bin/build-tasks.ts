#!/usr/bin/env tsx
/**
 * orchestration/bin/build-tasks.ts — build orchestration/TASKS.json (iter-7, count-agnostic).
 *
 * Merges two sources, deduped BY TARGET (first-seen wins → curated priority):
 *   1. TASKS_100.src.txt  — iter-6 hand-curated tasks (specific goals) — highest priority
 *   2. TASKS.gen.txt      — gen-catalog.ts output (one generic task per substantial module) — coverage
 * Drops any row whose target file does not exist (every catalog target is real). Assigns stable unique ids.
 * NO cap — N = the project's real taskable surface ("yeteri kadar sayı"). Deterministic.
 *
 * Run:  tsx orchestration/bin/gen-catalog.ts && tsx orchestration/bin/build-tasks.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const SOURCES = [join(ORCH_DIR, "TASKS_100.src.txt"), join(ORCH_DIR, "TASKS.gen.txt")]; // curated first
const OUT = join(ORCH_DIR, "TASKS.json");

function slug(s: string): string {
  return s.toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
interface Task { id: string; lane: string; target: string; goal: string; acceptance: string; }

const usedId = new Set<string>();
const seenTarget = new Set<string>(); // dedupe by target — curated (read first) wins
const out: Task[] = [];
let dropped = 0;

for (const src of SOURCES) {
  if (!existsSync(src)) continue;
  for (const raw of readFileSync(src, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [lane, target, goal, acceptance = ""] = line.split("|").map((x) => x.trim());
    if (!lane || !target || !goal) { dropped++; continue; }
    if (seenTarget.has(target)) continue;             // curated priority
    if (!existsSync(join(REPO, target))) { dropped++; continue; }
    seenTarget.add(target);
    let id = `${lane}-${slug(basename(target))}`, n = 1;
    while (usedId.has(id)) { n++; id = `${lane}-${slug(basename(target))}-${n}`; }
    usedId.add(id);
    out.push({ id, lane, target, goal, acceptance });
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const byLane = out.reduce<Record<string, number>>((m, t) => ((m[t.lane] = (m[t.lane] || 0) + 1), m), {});
console.log(`[build-tasks] wrote ${out.length} tasks → ${OUT} (dropped ${dropped})`);
console.log(`[build-tasks] by lane: ${JSON.stringify(byLane)}`);
