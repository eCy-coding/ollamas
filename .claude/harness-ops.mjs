#!/usr/bin/env node
// @ts-check
// harness-ops — autonomous READ-ONLY harness health runner (heartbeat §3 pattern: observe+report,
// NEVER mutate). Run by launchd periodically + /harness-ops manual. Writes a single report;
// auto-fix / auto-commit / auto-apply is intentionally NOT done (human-gated).
//   node .claude/harness-ops.mjs [--deep]   --deep adds slow scans (semgrep/trivy/knip/depcheck)
// Always exits 0 (autonomous-safe). Delta-notify (macOS banner) only when status changes.

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const DEEP = process.argv.includes("--deep");
const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const sh = (cmd, ms = 15000) => { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { return (e.stdout || "") + "ERR"; } };
const ok = (b) => (b ? "✓" : "✗");
const rows = [];

// FAST checks (every tick)
const settingsValid = !sh("node .claude/validate-settings.mjs 2>&1").includes("FAILED") && !sh("node .claude/validate-settings.mjs 2>&1").includes("✗");
rows.push(["settings-schema", ok(settingsValid), settingsValid ? "valid" : "INVALID — run apply-harness"]);

const hookSuite = sh("bash .claude/hooks/test-hooks.sh 2>&1", 30000);
const hookPass = /RESULT: \d+ passed, 0 failed/.test(hookSuite);
rows.push(["hook-suite", ok(hookPass), (hookSuite.match(/RESULT: .*/) || ["?"])[0]]);

// merge drift: would apply add anything? (means live settings is behind)
const drift = sh("node .claude/merge-settings.mjs 2>&1 1>/dev/null");
const driftItems = (drift.match(/would add: (.*)/) || [, ""])[1];
const noDrift = !driftItems || driftItems.includes("nothing");
rows.push(["settings-drift", ok(noDrift), noDrift ? "in sync" : `pending apply: ${driftItems.slice(0, 80)}`]);

const dirty = sh("git status --porcelain | wc -l").trim();
rows.push(["git-dirty", "•", `${dirty} files`]);
rows.push(["git-head", "•", sh("git log -1 --oneline").slice(0, 60)]);

const leaks = sh("gitleaks detect --no-banner --redact 2>&1", 60000);
const leakN = /no leaks found/.test(leaks) ? "0" : (leaks.match(/leaks found: (\d+)/) || [, "?"])[1];
rows.push(["gitleaks", leakN === "0" ? "✓" : "⚠", `${leakN} leaks (history)`]);

const lc = sh("launchctl list 2>/dev/null | grep -c ollamas.orchestration.autopilot").trim();
rows.push(["autopilot-launchd", ok(lc === "1"), lc === "1" ? "loaded" : "NOT loaded"]);
rows.push(["lsp-binary", ok(!sh("command -v typescript-language-server").includes("ERR")), "tsls"]);

// DEEP (slow — only with --deep)
if (DEEP) {
  const sem = sh("semgrep --config auto --severity ERROR cli/ --quiet --json 2>/dev/null", 120000);
  rows.push(["semgrep(cli)", "•", `${(JSON.parse(sem || "{}").results || []).length} findings`]);
  const tri = sh("trivy fs --scanners misconfig --severity HIGH,CRITICAL --quiet . 2>&1", 120000);
  rows.push(["trivy", "•", tri.includes("ERR") ? "err" : "scanned"]);
  const knip = sh("npx -y knip --no-progress 2>&1", 120000);
  rows.push(["knip", "•", (knip.match(/Unused \w+/g) || []).join(",") || "clean"]);
}

const issues = rows.filter((r) => r[1] === "✗" || r[1] === "⚠").length;
const report = [
  `# harness-ops report ${DEEP ? "(deep)" : "(fast)"}`,
  `ran: ${new Date().toISOString()} · issues: ${issues}`,
  ``,
  `| check | st | detail |`, `|---|:--:|---|`,
  ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
  ``,
  `> READ-ONLY observe (heartbeat §3). No auto-mutate. Fix: \`bash .claude/apply-harness.sh\` / human review.`,
  ``,
].join("\n");

try { writeFileSync(`${ROOT}/.claude/harness-ops-report.md`, report); } catch { /* */ }
process.stdout.write(report);

// Delta-notify: macOS banner only when issue-count changed since last run.
try {
  const stateF = `${ROOT}/.claude/.harness-ops-state`;
  const prev = existsSync(stateF) ? readFileSync(stateF, "utf8").trim() : "";
  if (String(issues) !== prev) {
    writeFileSync(stateF, String(issues));
    if (issues > 0) execSync(`osascript -e 'display notification "${issues} harness issue(s) — see harness-ops-report.md" with title "ollamas harness-ops"'`, { stdio: "ignore" });
  }
} catch { /* */ }
process.exit(0);
