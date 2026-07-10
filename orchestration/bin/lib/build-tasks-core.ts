// orchestration/bin/lib/build-tasks-core.ts — pure task-merge core for build-tasks.ts (IO-free → unit-tested).
//
// build-tasks.ts merges curated + generated catalog rows into TASKS.json. The parse + dedupe + stable-id
// logic is deterministic and socket/disk-free; it lives here so it can be asserted without touching the FS.
// The tool keeps only the readFileSync/writeFileSync shell.

import { basename } from "node:path";

export interface RawTask { lane: string; target: string; goal: string; acceptance: string; }
export interface Task { id: string; lane: string; target: string; goal: string; acceptance: string; }

/** Stable id slug: lowercase, drop trailing ext, non-alnum → single hyphen, trim edge hyphens. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Parse one `lane|target|goal|acceptance` line. null for blank/comment/incomplete (missing lane|target|goal). */
export function parseTaskLine(raw: string): RawTask | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  const [lane, target, goal, acceptance = ""] = line.split("|").map((x) => x.trim());
  if (!lane || !target || !goal) return null;
  return { lane, target, goal, acceptance };
}

/** Merge rows curated-first: dedupe BY TARGET (first-seen wins), drop rows whose target fails `targetExists`,
 *  assign stable unique id `<lane>-<slug(basename(target))>` (numeric suffix on collision). Deterministic. */
export function mergeTasks(rows: RawTask[], targetExists: (target: string) => boolean): { tasks: Task[]; dropped: number } {
  const usedId = new Set<string>();
  const seenTarget = new Set<string>();
  const tasks: Task[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (seenTarget.has(r.target)) continue;        // curated priority (first source read wins)
    if (!targetExists(r.target)) { dropped++; continue; }
    seenTarget.add(r.target);
    let id = `${r.lane}-${slug(basename(r.target))}`, n = 1;
    while (usedId.has(id)) { n++; id = `${r.lane}-${slug(basename(r.target))}-${n}`; }
    usedId.add(id);
    tasks.push({ id, lane: r.lane, target: r.target, goal: r.goal, acceptance: r.acceptance });
  }
  return { tasks, dropped };
}
