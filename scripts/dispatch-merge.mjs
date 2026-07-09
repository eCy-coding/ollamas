#!/usr/bin/env node
// @ts-check
// dispatch-merge — fold N per-task dispatch reports into ONE merged epic report.
//
// Each per-task report is the JSON emitted by `agent-dispatch.mjs --json` (or the
// structured report any dispatch worker returns): { verdict, files[], errors[], steps[],
// demoSuspected, ... }. This aggregator collapses them into a single epic verdict per the
// orchestration soundness law (INVARIANTS I10):
//   allOk ⟺ every task verdict ∈ {DONE,OK} && no task demoSuspected
//   verdict = allOk ? "DONE" : "INCOMPLETE"
//
// Input: one JSON report per line on stdin, AND/OR file paths as positional args (each file
// holds one report — a single JSON object, or a JSON array of reports). Zero-dep node.
//
// Usage:
//   node scripts/agent-dispatch.mjs ... --json | node scripts/dispatch-merge.mjs
//   node scripts/dispatch-merge.mjs report1.json report2.json
//   cat reports.jsonl | node scripts/dispatch-merge.mjs extra.json

import { readFileSync } from "node:fs";

// ── pure core (no IO): fold an array of per-task reports → merged epic report ──
export function mergeReports(reports) {
  const tasks = [];
  const files = [];
  const errors = [];
  for (const r of reports) {
    const verdict = String(r?.verdict ?? "INCOMPLETE");
    const demoSuspected = r?.demoSuspected === true;
    const taskFiles = Array.isArray(r?.files) ? r.files : [];
    const taskErrors = Array.isArray(r?.errors) ? r.errors : [];
    const ok = (verdict === "DONE" || verdict === "OK") && !demoSuspected;
    tasks.push({
      taskId: r?.taskId ?? r?.id ?? null,
      verdict,
      ok,
      demoSuspected,
      steps: Array.isArray(r?.steps) ? r.steps.length : 0,
      files: taskFiles.length,
      errors: taskErrors.length,
    });
    for (const f of taskFiles) files.push(f);
    for (const e of taskErrors) errors.push(typeof e === "string" ? e : JSON.stringify(e));
  }
  const allOk = tasks.length > 0 && tasks.every((t) => t.ok);
  return {
    tasks,
    files: [...new Set(files)],
    errors,
    allOk,
    verdict: allOk ? "DONE" : "INCOMPLETE",
  };
}

// ── pure parse: turn raw text lines into report objects (one obj, or an array, per line) ──
export function parseReportLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let v;
    try { v = JSON.parse(s); } catch { continue; }
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") out.push(v);
  }
  return out;
}

// pretty-printed JSON object/array in a file (parseReportLines handles single-line JSONL).
function parseFile(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const v = JSON.parse(trimmed);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") return [v];
  } catch { /* fall through to per-line JSONL parse */ }
  return parseReportLines(trimmed);
}

// ── thin IO wrapper ──
function main() {
  const fileArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const reports = [];
  if (!process.stdin.isTTY) {
    let stdin = "";
    try { stdin = readFileSync(0, "utf8"); } catch { /* no stdin */ }
    reports.push(...parseReportLines(stdin));
  }
  for (const f of fileArgs) {
    reports.push(...parseFile(readFileSync(f, "utf8")));
  }
  const merged = mergeReports(reports);
  console.log(JSON.stringify(merged, null, 2));
  process.exit(merged.allOk ? 0 : 1);
}

// Run only as a script (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) main();
