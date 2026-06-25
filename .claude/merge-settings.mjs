#!/usr/bin/env node
// Additive merge of the harness keys into .claude/settings.json.
// Preserves existing hooks (UserPromptSubmit/SessionStart) and any other keys.
// Only adds permissions / statusLine / PreToolUse if not already present (idempotent).
//   --dry   print the merged result to stdout, write nothing (default)
//   --write back up the original to settings.json.bak and write the merge
// Exits non-zero if the result is not valid JSON.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const FILE = new URL("./settings.json", import.meta.url).pathname;
const WRITE = process.argv.includes("--write");

// Portable: ${CLAUDE_PROJECT_DIR} is expanded by Claude Code to the project root at runtime,
// so hooks fire regardless of clone path/worktree (a hook that can't be found fails OPEN).
// NOTE: this is a LITERAL string in the emitted JSON — do NOT let node interpolate it.
const PROJ = "${CLAUDE_PROJECT_DIR}";
const H = (p) => `node ${PROJ}/.claude/hooks/${p}`;

const HARNESS = {
  permissions: {
    defaultMode: "default",
    allow: [
      "Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git rev-parse:*)",
      "Bash(npm run test:*)", "Bash(npm run lint:*)", "Bash(npx tsc --noEmit)",
      "Bash(node scripts/:*)", "Bash(npx tsx orchestration/bin/:*)",
      "Bash(grep:*)", "Bash(rg:*)", "Bash(ls:*)", "Bash(find:*)",
    ],
    deny: ["Read(./.env)", "Bash(rm -rf:*)", "Bash(git push --force:*)"],
    ask: ["Bash(git commit:*)", "Bash(git push:*)", "Bash(npm publish:*)"],
  },
  statusLine: { type: "command", command: `node ${PROJ}/.claude/statusline.mjs` },
  subagentStatusLine: { type: "command", command: `node ${PROJ}/.claude/statusline.mjs` },
  // Safe, reproducible env for all Bash + hooks. Telemetry/OTel is OPT-IN (see .claude/README.md):
  // enabling CLAUDE_CODE_ENABLE_TELEMETRY without a running OTLP collector spams errors — left off.
  env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  // OS-level Bash isolation (macOS Seatbelt / Linux bubblewrap) — the real 2026 autonomy gate.
  // Filesystem+network confinement enforces safety even if a regex blocklist is bypassed.
  // failIfUnavailable: hard-fail rather than silently run unsandboxed. Unix sockets off = no bypass.
  sandbox: { enabled: true, failIfUnavailable: false, autoAllowBashIfSandboxed: true, network: { allowUnixSockets: false } },
  // Thinking / reasoning effort. Opus 4.8 = ADAPTIVE (no budget_tokens; control = effort only).
  // "high" is the efficient session default (adaptive skips depth when unneeded); deep-reasoning
  // sub-agents (verify/review) override to "xhigh" in their own frontmatter. max/ultracode are
  // session-only and NOT accepted here. MAX_THINKING_TOKENS is intentionally NOT set (no-op on adaptive).
  thinking: { effortLevel: "high", alwaysThinkingEnabled: true },
  // Context resilience (master-level): survive long sessions + enable /rewind.
  resilience: { autoCompactEnabled: true, autoMemoryEnabled: true, fileCheckpointingEnabled: true },
  // Auto-approve the project's own MCP server declared in .mcp.json.
  enabledMcpjsonServers: ["ollamas"],
  preToolUse: [
    { matcher: "Write|Edit", hooks: [{ type: "command", command: H("redact-tokens.mjs") }] },
    { matcher: "Bash", hooks: [
      { type: "command", command: H("block-destructive.mjs") },
      { type: "command", command: H("gate-before-commit.mjs") },
    ] },
  ],
  postToolUse: [
    { matcher: "Edit|Write", hooks: [{ type: "command", command: H("format-on-edit.mjs") }] },
  ],
  preCompact: [
    { hooks: [{ type: "command", command: H("preserve-context.mjs") }] },
  ],
  stop: [
    { hooks: [{ type: "command", command: H("on-stop.mjs") }] },
  ],
  postToolUseFailure: [
    { hooks: [{ type: "command", command: H("on-tool-failure.mjs") }] },
  ],
  subagentStop: [
    { hooks: [{ type: "command", command: H("on-subagent-stop.mjs") }] },
  ],
  sessionEnd: [
    { hooks: [{ type: "command", command: H("on-session-end.mjs") }] },
  ],
  notification: [
    { hooks: [{ type: "command", command: H("on-notification.mjs") }] },
  ],
};

// Prune known-bad keys (hallucinated / silently-ignored) from an existing config.
const PRUNE = ["showThinkingSummaries"];

let cfg = {};
try { cfg = JSON.parse(readFileSync(FILE, "utf8")); }
catch (e) { console.error(`cannot read/parse ${FILE}: ${e.message}`); process.exit(1); }

const changes = [];
for (const k of PRUNE) { if (k in cfg) { delete cfg[k]; changes.push(`-${k}`); } }
if (!cfg.permissions) { cfg.permissions = HARNESS.permissions; changes.push("permissions"); }
if (!cfg.subagentStatusLine) { cfg.subagentStatusLine = HARNESS.subagentStatusLine; changes.push("subagentStatusLine"); }
if (!cfg.env) { cfg.env = HARNESS.env; changes.push("env"); }
else if (!cfg.permissions.ask) { cfg.permissions.ask = HARNESS.permissions.ask; changes.push("permissions.ask"); }
if (!cfg.statusLine)  { cfg.statusLine = HARNESS.statusLine; changes.push("statusLine"); }
for (const [k, v] of Object.entries(HARNESS.thinking)) {
  if (cfg[k] === undefined) { cfg[k] = v; changes.push(k); }
}
for (const [k, v] of Object.entries(HARNESS.resilience)) {
  if (cfg[k] === undefined) { cfg[k] = v; changes.push(k); }
}
if (!cfg.enabledMcpjsonServers) { cfg.enabledMcpjsonServers = HARNESS.enabledMcpjsonServers; changes.push("enabledMcpjsonServers"); }
if (!cfg.sandbox) { cfg.sandbox = HARNESS.sandbox; changes.push("sandbox"); }
cfg.hooks = cfg.hooks || {};
if (!cfg.hooks.PreToolUse) { cfg.hooks.PreToolUse = HARNESS.preToolUse; changes.push("hooks.PreToolUse"); }
if (!cfg.hooks.PostToolUse) { cfg.hooks.PostToolUse = HARNESS.postToolUse; changes.push("hooks.PostToolUse"); }
if (!cfg.hooks.PreCompact) { cfg.hooks.PreCompact = HARNESS.preCompact; changes.push("hooks.PreCompact"); }
if (!cfg.hooks.Stop) { cfg.hooks.Stop = HARNESS.stop; changes.push("hooks.Stop"); }
if (!cfg.hooks.PostToolUseFailure) { cfg.hooks.PostToolUseFailure = HARNESS.postToolUseFailure; changes.push("hooks.PostToolUseFailure"); }
if (!cfg.hooks.SubagentStop) { cfg.hooks.SubagentStop = HARNESS.subagentStop; changes.push("hooks.SubagentStop"); }
if (!cfg.hooks.SessionEnd) { cfg.hooks.SessionEnd = HARNESS.sessionEnd; changes.push("hooks.SessionEnd"); }
if (!cfg.hooks.Notification) { cfg.hooks.Notification = HARNESS.notification; changes.push("hooks.Notification"); }

// Portability normalization: rewrite any machine-specific absolute path in hook commands to
// ${CLAUDE_PROJECT_DIR} so legacy hooks (role-hook/model-hook/autopilot) don't fail-OPEN on
// another clone/worktree. Touches only the path STRING in settings, never the scripts. Idempotent.
{
  const before = JSON.stringify(cfg.hooks || {});
  const norm = before
    .replace(/\$\{HOME\}\/Desktop\/ollamas/g, "${CLAUDE_PROJECT_DIR}")
    .replace(/\$HOME\/Desktop\/ollamas/g, "${CLAUDE_PROJECT_DIR}");
  if (norm !== before) { cfg.hooks = JSON.parse(norm); changes.push("normalized-paths"); }
}

const out = JSON.stringify(cfg, null, 2) + "\n";
JSON.parse(out); // validate (throws → non-zero via uncaught)

if (WRITE) {
  if (existsSync(FILE)) copyFileSync(FILE, FILE + ".bak");
  writeFileSync(FILE, out);
  console.error(`✓ wrote ${FILE} (backup: settings.json.bak) — added: ${changes.join(", ") || "nothing (already complete)"}`);
} else {
  console.error(`[dry-run] would add: ${changes.join(", ") || "nothing (already complete)"}`);
  process.stdout.write(out);
}
