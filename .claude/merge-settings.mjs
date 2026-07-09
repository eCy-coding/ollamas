#!/usr/bin/env node
// @ts-check
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
      // $0 free CLIs — read-only / analysis only (no side effects). All locally installed.
      "Bash(gh search:*)", "Bash(gh pr view:*)", "Bash(gh pr list:*)", "Bash(gh issue list:*)",
      "Bash(gh run list:*)", "Bash(gh run view:*)", "Bash(gh repo view:*)",
      "Bash(semgrep:*)", "Bash(trivy fs:*)", "Bash(trivy repo:*)", "Bash(gitleaks:*)",
      "Bash(jq:*)", "Bash(fd:*)", "Bash(deno check:*)", "Bash(bun test:*)",
      "Bash(npx tsx:*)",
    ],
    deny: ["Read(./.env)", "Bash(rm -rf:*)", "Bash(git push --force:*)"],
    ask: [
      "Bash(git commit:*)", "Bash(git push:*)", "Bash(npm publish:*)",
      // side-effectful free CLIs — outward/mutating, need human confirm.
      "Bash(gh pr create:*)", "Bash(gh pr merge:*)", "Bash(gh release:*)",
      "Bash(vercel:*)", "Bash(wrangler deploy:*)", "Bash(supabase db push:*)",
      "Bash(cloudflared:*)", "Bash(docker:*)", "Bash(gcloud:*)", "Bash(aws:*)",
    ],
  },
  statusLine: { type: "command", command: `node ${PROJ}/.claude/statusline.mjs` },
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
  // Context resilience: only autoMemoryEnabled is a REAL schema key (Chrome-verified 2026-06-27).
  // autoCompactEnabled / fileCheckpointingEnabled are NOT schema keys (auto-compact + checkpointing
  // are always-on defaults) → removed (were silently ignored).
  resilience: { autoMemoryEnabled: true },
  // Auto-approve the project's own + $0 no-auth MCP servers declared in .mcp.json.
  enabledMcpjsonServers: ["ollamas", "context7", "deepwiki"],
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
const PRUNE = ["showThinkingSummaries", "autoCompactEnabled", "fileCheckpointingEnabled", "subagentStatusLine"];

let cfg = {};
try { cfg = JSON.parse(readFileSync(FILE, "utf8")); }
catch (e) { console.error(`cannot read/parse ${FILE}: ${e.message}`); process.exit(1); }

const changes = [];
for (const k of PRUNE) { if (k in cfg) { delete cfg[k]; changes.push(`-${k}`); } }

// Union missing entries from src[] into dst[] (idempotent; preserves order, no dup).
const union = (dst, src, label) => {
  const arr = Array.isArray(dst) ? dst : [];
  const add = src.filter((x) => !arr.includes(x));
  if (add.length) { arr.push(...add); changes.push(`${label}+${add.length}`); }
  return arr;
};

if (!cfg.permissions) { cfg.permissions = HARNESS.permissions; changes.push("permissions"); }
else {
  cfg.permissions.defaultMode = cfg.permissions.defaultMode || HARNESS.permissions.defaultMode;
  cfg.permissions.allow = union(cfg.permissions.allow, HARNESS.permissions.allow, "allow");
  cfg.permissions.deny = union(cfg.permissions.deny, HARNESS.permissions.deny, "deny");
  cfg.permissions.ask = union(cfg.permissions.ask, HARNESS.permissions.ask, "ask");
}
// User-added CLIs (add-cli.mjs writes cli-extensions.json) → union into permissions. Optional/back-compat.
try {
  const ext = JSON.parse(readFileSync(new URL("./cli-extensions.json", import.meta.url).pathname, "utf8"));
  cfg.permissions = cfg.permissions || { allow: [], deny: [], ask: [] };
  if (Array.isArray(ext.allow) && ext.allow.length) cfg.permissions.allow = union(cfg.permissions.allow, ext.allow, "ext-allow");
  if (Array.isArray(ext.ask) && ext.ask.length) cfg.permissions.ask = union(cfg.permissions.ask, ext.ask, "ext-ask");
} catch (e) {
  // Distinguish "no file" (fine) from "malformed file" (silently dropping perms = dangerous → warn).
  if (existsSync(new URL("./cli-extensions.json", import.meta.url).pathname))
    console.error(`⚠ cli-extensions.json malformed — extensions NOT applied: ${e.message}`);
}
// Safety: deny ALWAYS wins — drop any allow rule that exactly matches a deny rule (prevents add-cli
// or hand-edit from granting a denied/destructive command).
if (cfg.permissions?.allow && cfg.permissions?.deny) {
  const before = cfg.permissions.allow.length;
  cfg.permissions.allow = cfg.permissions.allow.filter((r) => !cfg.permissions.deny.includes(r));
  if (cfg.permissions.allow.length !== before) changes.push("deny-filtered-allow");
}
if (!cfg.env) { cfg.env = HARNESS.env; changes.push("env"); }
if (!cfg.statusLine)  { cfg.statusLine = HARNESS.statusLine; changes.push("statusLine"); }
for (const [k, v] of Object.entries(HARNESS.thinking)) {
  if (cfg[k] === undefined) { cfg[k] = v; changes.push(k); }
}
for (const [k, v] of Object.entries(HARNESS.resilience)) {
  if (cfg[k] === undefined) { cfg[k] = v; changes.push(k); }
}
if (!cfg.enabledMcpjsonServers) { cfg.enabledMcpjsonServers = HARNESS.enabledMcpjsonServers; changes.push("enabledMcpjsonServers"); }
else cfg.enabledMcpjsonServers = union(cfg.enabledMcpjsonServers, HARNESS.enabledMcpjsonServers, "enabledMcp");
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
