# harness CHANGELOG

## 2026-06-27 — Chrome live-verification: 3 more hallucinated keys caught
- Verified settings.json + hook events against LIVE schemastore.org/claude-code-settings.json (Chrome MCP).
- Caught 3 invalid top-level keys (silently ignored): `autoCompactEnabled`, `fileCheckpointingEnabled`, `subagentStatusLine` → NOT in schema (auto-compact/checkpointing are always-on defaults; only statusLine exists). Added to PRUNE + KNOWN_BAD.
- validate-settings VALID_TOP_LEVEL rebuilt from authoritative schema (57 real keys; was wrong — accepted the 3 bad + missed ~40 real like fastMode/modelOverrides/respectGitignore/allowedMcpServers).
- Hook events all confirmed valid (PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop/SubagentStop/SessionEnd/Notification/UserPromptSubmit/SessionStart).
- Operator: apply re-run prunes the 3 live → validate then green.


## 2026-06-27 — gate live-verified
- Quality gate measured GREEN: `tsc --noEmit` 0 errors (3s) · `vitest run` 864 passed / 0 failed / 13 skipped (15s).
- pre-commit fix: removed redundant double `tsc` run (lint script IS `tsc --noEmit` → typecheck step skipped when lint covers it).
- This commit runs the gate LIVE (no GATE_SKIP) — first end-to-end proof the installed pre-commit (validate-settings + test-hooks + tsc + vitest) passes on a real commit.
- $0 slash-commands: /security-scan /deps-audit /lib-docs /repo-explain. MCP: +context7 +deepwiki. Protocols: A2A agent-card + llms.txt + PROTOCOLS.md.


## 2026-06-26 — master harness v1
- Güvenlik hookları: redact-tokens, block-destructive, gate-before-commit (permissionDecision deny JSON).
- Lifecycle: PostToolUse(format), PreCompact, Stop, PostToolUseFailure, SubagentStop, SessionEnd, Notification.
- permissions allow/deny/ask + defaultMode · sandbox (Seatbelt) · thinking effortLevel high + alwaysThinking.
- Resilience: autoCompact/autoMemory/fileCheckpointing · env (nonessential-traffic off).
- Sub-agents: cli-coder/cli-verifier/harness-reviewer (model+effort) · statusLine + subagentStatusLine.
- .mcp.json (mcp__ollamas__*) · .lsp.json (TS) · git pre-commit gate · hook test-suite (golden).
- Plugin packaging (.claude-plugin + build-plugin.sh) · GitHub Actions review · devcontainer.
- Fix: `showThinkingSummaries` uydurma key prune; portability `${CLAUDE_PROJECT_DIR}`; gate `--amend` istisnası; block-destructive find-delete/git-clean kapsamı.
- KASITLI HARİÇ: monitors (docs'ta yok), rules paths: (buggy), OTel/Proactive/auto-allow (opt-in, README).
