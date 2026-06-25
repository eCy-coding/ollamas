# harness CHANGELOG

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
