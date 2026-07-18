#!/usr/bin/env tsx
/**
 * orchestration/bin/follow.ts — `ollamas follow`: the live Claude-Code-style progress viewer.
 *
 * Renders the current tracker run (status line "⏺ … (4m 56s · ↓ 18.7k tokens)", the ◼/◻ checklist,
 * the deterministic thinking spinner) and re-draws every second. Reads the shared blackboard state
 * written by any producer (orchestra `ollamas do`, ecym) — so tasks given to either surface stream
 * into the same view, including live task-set changes.
 *
 * Run:
 *   tsx orchestration/bin/follow.ts             # live watch (TTY: in-place redraw; pipe: line mode)
 *   tsx orchestration/bin/follow.ts --once      # single frame
 *   tsx orchestration/bin/follow.ts --json      # raw state
 *   tsx orchestration/bin/follow.ts --stay      # keep watching after the run finishes
 */
import { readTrackerState } from "./lib/tracker-io";
import { renderFrame } from "./lib/task-tracker";

const argv = process.argv.slice(2);
const ONCE = argv.includes("--once");
const JSON_OUT = argv.includes("--json");
const STAY = argv.includes("--stay");
const isTTY = process.stdout.isTTY === true;
const color = isTTY && !process.env.NO_COLOR;

function frame(): { text: string; finished: boolean } | null {
  const s = readTrackerState();
  if (!s) return null;
  return { text: renderFrame(s, new Date(), { color }), finished: s.finished };
}

async function main(): Promise<void> {
  if (JSON_OUT) { console.log(JSON.stringify(readTrackerState())); return; }
  if (ONCE) {
    const f = frame();
    process.stdout.write((f ? f.text : "⏳ aktif görev yok — `ollamas do \"<görev>\"` ile başlat") + "\n");
    return;
  }

  let prevLines = 0;
  let lastText = "";
  for (;;) {
    const f = frame();
    const text = f ? f.text : "⏳ aktif görev yok — `ollamas do \"<görev>\"` ile başlat";
    if (isTTY) {
      // In-place redraw: move up over the previous frame and clear each line.
      if (prevLines > 0) process.stdout.write(`\x1b[${prevLines}A`);
      const lines = text.split("\n");
      for (const line of lines) process.stdout.write(`\x1b[2K${line}\n`);
      // Frame shrank (task-change) → clear the leftover lines below, then move back up.
      const extra = prevLines - lines.length;
      if (extra > 0) {
        for (let i = 0; i < extra; i++) process.stdout.write("\x1b[2K\n");
        process.stdout.write(`\x1b[${extra}A`);
      }
      prevLines = lines.length;
    } else if (text !== lastText) {
      process.stdout.write(text + "\n---\n"); // pipe/log mode: append frames only on change
      lastText = text;
    }
    if (f?.finished && !STAY) { if (!isTTY) break; process.stdout.write("✅ görev tamamlandı\n"); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => { console.error("[follow] fatal:", (e as Error)?.message ?? e); process.exit(1); });
