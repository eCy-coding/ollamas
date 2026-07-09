#!/usr/bin/env node
// @ts-check
// statusLine renderer — one line per turn. Reads session JSON from stdin.
// Shows: model · git branch · autopilot readiness (DOCTOR) · role stage.
// Fast + defensive: every lookup is best-effort; never throws (a crashing statusline
// blanks the bar). No secret values ever printed.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let s = {};
  try { s = JSON.parse(raw || "{}"); } catch { /* keep empty */ }
  const model = s?.model?.display_name || s?.model?.id || "claude";
  const dir = s?.workspace?.current_dir || process.env.HOME + "/Desktop/ollamas";

  const sh = (cmd) => { try { return execSync(cmd, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).toString().trim(); } catch { return ""; } };

  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const dirty = sh("git status --porcelain") ? "*" : "";

  // Autopilot readiness: scan orchestration/DOCTOR.md for a GO/NO-GO marker.
  let doctor = "";
  try {
    const d = readFileSync(dir + "/orchestration/DOCTOR.md", "utf8");
    if (/NO[- ]?GO/i.test(d)) doctor = "NO-GO";
    else if (/\bGO\b/.test(d)) doctor = /uyar|warn/i.test(d) ? "GO!" : "GO";
  } catch { /* none */ }

  const parts = [
    `\x1b[36m${model}\x1b[0m`,
    branch ? `\x1b[33m⎇ ${branch}${dirty}\x1b[0m` : "",
    doctor ? `\x1b[32m◉ ${doctor}\x1b[0m` : "",
  ].filter(Boolean);

  process.stdout.write(parts.join("  ·  "));
});
