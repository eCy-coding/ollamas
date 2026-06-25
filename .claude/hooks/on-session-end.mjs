#!/usr/bin/env node
// SessionEnd hook — flush a final state line + prune oversized audit logs. Cannot block
// (session is ending); fail-safe exit 0. matcher = reason (clear|resume|logout|other).

import { appendFileSync, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  try {
    appendFileSync(".claude/subagent-audit.log",
      `${new Date().toISOString()} session-end reason=${p.reason || "?"} session=${String(p.session_id || "?").slice(0, 12)}\n`);
    // keep the audit log from growing unbounded — trim to last 500 lines
    const f = ".claude/subagent-audit.log";
    if (existsSync(f) && statSync(f).size > 200_000) {
      const tail = readFileSync(f, "utf8").split("\n").slice(-500).join("\n");
      writeFileSync(f, tail);
    }
  } catch { /* best-effort */ }
  process.exit(0);
});
