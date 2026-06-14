#!/usr/bin/env node
// logbook (seyir defteri) — append to / read the shared ship's log.
//   logbook.mjs add "<text>"   -> append a note
//   logbook.mjs tail [n]       -> last n entries (default 20)
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { emit, main } from "./lib/bridge-client.mjs";

const DIR = process.env.MISSION_CONTROL_DATA_DIR || join(os.homedir(), ".llm-mission-control");
const FILE = join(DIR, "seyir-defteri.jsonl");

main(async () => {
  const cmd = process.argv[2] || "tail";
  if (cmd === "add") {
    const text = process.argv.slice(3).join(" ").trim();
    if (!text) throw new Error("usage: logbook add <text>");
    mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), kind: "note", entry: text }) + "\n");
    emit({ ok: true, added: text });
  } else if (cmd === "tail") {
    const n = Number(process.argv[3]) || 20;
    const lines = existsSync(FILE) ? readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean) : [];
    const entries = lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    emit({ ok: true, total: lines.length, shown: entries.length, entries });
  } else {
    throw new Error(`unknown subcommand '${cmd}' (add|tail)`);
  }
});
