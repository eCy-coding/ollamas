#!/usr/bin/env -S npx tsx
// stdin → readable log lines. The one CLI seam over lib/logfmt.
//
// WHY THIS EXISTS
// Both the watch tab and a `--visible` job need to pipe raw output through the SAME formatter
// so there is exactly one rendering of a log line, never two that drift. `watch.ts` inlines
// this logic for its own tab; this file is the standalone filter a job's tab (and any shell
// pipe) can call. Reuses lib/logfmt entirely — no second parser.
//
// Input is `job\ttext` (the caller tags its own lines); a line with no tab is rendered under
// the source "?". Fold-state persists across lines so a burst of identical output collapses
// to `… ×N` in the stream, not just in a static render.
import { createInterface } from "node:readline";
import { parseLine, renderLine, isNoise, fold, levelFilter, header, type FoldState } from "./logfmt";

const only = process.env.LOGFMT_ONLY || "";
const plain = process.env.LOGFMT_PLAIN === "1" || !process.stdout.isTTY;
const jobWidth = Number(process.env.LOGFMT_JOBW || 16);
const pass = levelFilter(only);
let st: FoldState = { lastKey: "", count: 0 };

if (process.env.LOGFMT_HEADER !== "0") for (const h of header(jobWidth)) console.log(h);

createInterface({ input: process.stdin }).on("line", (line) => {
  const tab = line.indexOf("\t");
  const job = tab > 0 ? line.slice(0, tab) : "?";
  const text = tab > 0 ? line.slice(tab + 1) : line;
  if (isNoise(text)) return;
  const parsed = parseLine(text, job);
  if (!parsed || !pass(parsed.level)) return;
  const f = fold(parsed, st);
  st = f.state;
  if (f.emit) console.log(f.emit);
  if (st.count === 1) {
    console.log(renderLine(parsed, { colour: !plain, jobWidth, width: Number(process.env.COLUMNS || 140) }));
  }
});
