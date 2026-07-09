#!/usr/bin/env node
// @ts-check
// Notification hook — surfaces long-run / permission-prompt notifications to a log (and a
// macOS desktop banner when idle). Fail-safe exit 0; never blocks. matcher = notification_type.

import { appendFileSync } from "node:fs";
import { execFile } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const type = p.notification_type || "?";
  const msg = String(p.message || "").slice(0, 200);
  try { appendFileSync(".claude/notifications.log", `${new Date().toISOString()} [${type}] ${msg}\n`); } catch { /* */ }
  // Desktop banner only for attention-needed events (permission / idle), best-effort.
  if (/permission|idle/i.test(type)) {
    try { execFile("osascript", ["-e", `display notification ${JSON.stringify(msg || "Claude Code needs attention")} with title "Claude Code"`], () => {}); } catch { /* */ }
  }
  process.exit(0);
});
