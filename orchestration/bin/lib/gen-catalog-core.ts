// orchestration/bin/lib/gen-catalog-core.ts — pure taskable-file classifier for gen-catalog.ts (IO-free).
//
// gen-catalog.ts walks lane dirs (IO) and keeps SUBSTANTIAL exported-symbol source files, emitting a
// deterministic additive goal per file type. The classification (`isTaskable`) and the goal mapping
// (`goalFor`) are pure string transforms — extracted here so they are asserted without walking the disk.

import { extname, basename } from "node:path";

export const MIN_LOC = 25;

/** Is this a substantial, taskable source file? `content` is the file body (injected → IO-free). */
export function isTaskable(rel: string, content: string): boolean {
  const ext = extname(rel), base = basename(rel);
  if (![".ts", ".tsx", ".mjs"].includes(ext)) return false;
  if (/\.(test|spec|d)\.ts$/.test(base) || base === "index.ts" || base === "index.tsx") return false;
  if (content.split("\n").length < MIN_LOC) return false;
  return /(^|\n)\s*export\b/.test(content);
}

/** Deterministic additive goal by file type/path (calibratable — the model reads the inlined file). */
export function goalFor(rel: string): { goal: string; acceptance: string } {
  const ext = extname(rel);
  if (ext === ".tsx") return { goal: "add a null/empty-data guard or an aria-label to the main exported component", acceptance: "tsc clean; component renders safely on empty/undefined input" };
  if (ext === ".mjs") return { goal: "add a JSDoc block to the main exported function documenting its params and return", acceptance: "JSDoc present; no behavior change" };
  if (/\/lib\//.test(rel)) return { goal: "add a unit test for a pure exported function in this file", acceptance: "new assertion passes; tsc clean" };
  return { goal: "add JSDoc or an input-validation guard to the primary exported function", acceptance: "tsc clean; guard/JSDoc present; no behavior change" };
}
