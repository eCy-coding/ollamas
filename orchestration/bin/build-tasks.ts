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
 * Pure parse/dedupe/id logic → ./lib/build-tasks-core (IO-free, unit-tested); this file is the FS shell only.
 *
 * Run:  tsx orchestration/bin/gen-catalog.ts && tsx orchestration/bin/build-tasks.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTaskLine, mergeTasks, type RawTask } from "./lib/build-tasks-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const SOURCES = [join(ORCH_DIR, "TASKS_100.src.txt"), join(ORCH_DIR, "TASKS.gen.txt")]; // curated first
const OUT = join(ORCH_DIR, "TASKS.json");

const rows: RawTask[] = [];
let parseDropped = 0;
for (const src of SOURCES) {
  if (!existsSync(src)) continue;
  for (const raw of readFileSync(src, "utf8").split("\n")) {
    const r = parseTaskLine(raw);
    if (!r) { if (raw.trim() && !raw.trim().startsWith("#")) parseDropped++; continue; } // incomplete row
    rows.push(r);
  }
}

const { tasks, dropped } = mergeTasks(rows, (t) => existsSync(join(REPO, t)));
writeFileSync(OUT, JSON.stringify(tasks, null, 2) + "\n");
const byLane = tasks.reduce<Record<string, number>>((m, t) => ((m[t.lane] = (m[t.lane] || 0) + 1), m), {});
console.log(`[build-tasks] wrote ${tasks.length} tasks → ${OUT} (dropped ${dropped + parseDropped})`);
console.log(`[build-tasks] by lane: ${JSON.stringify(byLane)}`);
