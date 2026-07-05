#!/usr/bin/env tsx
/**
 * orchestration/bin/build-tasks-100.ts — build orchestration/TASKS_100.json from TASKS_100.src.txt.
 *
 * Parses `lane|target|goal|acceptance` lines, DROPS any whose target file does not exist (guarantees every
 * catalog target is a real file → the "eksiksiz" contract), assigns stable unique ids, caps at 100. Rerun
 * whenever the .src.txt changes. Deterministic (no clock/random).
 *
 * Run:  tsx orchestration/bin/build-tasks-100.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const SRC = join(ORCH_DIR, "TASKS_100.src.txt");
const OUT = join(ORCH_DIR, "TASKS_100.json");
const CAP = 100;

function slug(s: string): string {
  return s.toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface Task { id: string; lane: string; target: string; goal: string; acceptance: string; }

const lines = readFileSync(SRC, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const used = new Set<string>();
const out: Task[] = [];
const dropped: string[] = [];

for (const line of lines) {
  const [lane, target, goal, acceptance = ""] = line.split("|").map((x) => x.trim());
  if (!lane || !target || !goal) { dropped.push(`malformed: ${line.slice(0, 60)}`); continue; }
  if (!existsSync(join(REPO, target))) { dropped.push(`missing target: ${target}`); continue; }
  let id = `${lane}-${slug(basename(target))}`;
  let n = 1;
  while (used.has(id)) { n++; id = `${lane}-${slug(basename(target))}-${n}`; }
  used.add(id);
  out.push({ id, lane, target, goal, acceptance });
  if (out.length >= CAP) break;
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`[build-tasks-100] wrote ${out.length} tasks → ${OUT}`);
if (dropped.length) console.log(`[build-tasks-100] dropped ${dropped.length}:\n  ` + dropped.join("\n  "));
const byLane = out.reduce<Record<string, number>>((m, t) => ((m[t.lane] = (m[t.lane] || 0) + 1), m), {});
console.log(`[build-tasks-100] by lane: ${JSON.stringify(byLane)}`);
