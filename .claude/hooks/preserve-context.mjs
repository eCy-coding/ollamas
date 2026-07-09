#!/usr/bin/env node
// @ts-check
// PreCompact hook — snapshot critical session state to a durable file BEFORE the context
// window is compacted, so nothing irreplaceable is lost. Best-effort, always exit 0
// (blocking compaction would be worse than a missed snapshot).

import { execSync } from "node:child_process";
import { writeFileSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { /* keep going with empty */ }

  const sh = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().trim(); } catch { return ""; } };

  // Most-recently-touched plan file (the live work focus).
  let latestPlan = "";
  try {
    const dir = `${process.env.HOME}/.claude/plans`;
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`);
      latestPlan = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || "";
    }
  } catch { /* none */ }

  let doctor = "";
  try { const d = readFileSync("orchestration/DOCTOR.md", "utf8"); doctor = (d.match(/\b(NO[- ]?GO|GO!?)\b/) || [])[0] || ""; } catch { /* */ }

  const snap = [
    `# context snapshot @ PreCompact`,
    `session: ${p.session_id || "?"}`,
    `cwd: ${p.cwd || process.cwd()}`,
    `branch: ${sh("git rev-parse --abbrev-ref HEAD")}`,
    `staged: ${sh("git diff --cached --name-only").split("\n").filter(Boolean).join(", ") || "(none)"}`,
    `dirty: ${sh("git status --porcelain | wc -l").trim()} files`,
    `last commit: ${sh("git log -1 --oneline")}`,
    `doctor: ${doctor || "?"}`,
    `active plan: ${latestPlan || "(none)"}`,
    `transcript: ${p.transcript_path || "?"}`,
    ``,
  ].join("\n");

  try { writeFileSync(".claude/last-context-snapshot.md", snap); process.stderr.write("context snapshot written\n"); } catch { /* */ }
  process.exit(0);
});
