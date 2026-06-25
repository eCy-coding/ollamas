#!/usr/bin/env node
// Stop hook — runs at turn end (success). Refreshes the durable context snapshot so the
// latest state survives a later compaction/crash. NEVER blocks the turn (no decision:block):
// a turn-end side effect must be fail-safe. exit 0 always.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { /* continue */ }
  const sh = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().trim(); } catch { return ""; } };

  const line = [
    `# turn-end @ Stop`,
    `session: ${p.session_id || "?"}`,
    `branch: ${sh("git rev-parse --abbrev-ref HEAD")}`,
    `dirty: ${sh("git status --porcelain | wc -l").trim()} files`,
    `last commit: ${sh("git log -1 --oneline")}`,
    `transcript: ${p.transcript_path || "?"}`,
    ``,
  ].join("\n");

  try { writeFileSync(".claude/last-turn.md", line); } catch { /* best-effort */ }
  process.exit(0);
});
