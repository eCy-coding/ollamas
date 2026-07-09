#!/usr/bin/env node
// @ts-check
// SubagentStop hook — log a finished sub-agent for the audit trail. Fail-safe (exit 0, no block).
// (Quality-gating a sub-agent's output via decision:block is intentionally NOT done here —
//  the implementer≠verifier discipline is enforced by the cli-verifier agent, not a blind hook.)

import { appendFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const line = `${new Date().toISOString()} subagent-stop type=${p.agent_type || "?"} id=${String(p.agent_id || "?").slice(0, 12)} session=${String(p.session_id || "?").slice(0, 12)}\n`;
  try { appendFileSync(".claude/subagent-audit.log", line); } catch { /* best-effort */ }
  process.exit(0);
});
