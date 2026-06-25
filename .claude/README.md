# ollamas harness (.claude/) — operatör rehberi

Master-seviye Claude Code harness. Tek-kaynak `.claude/`; settings `merge-settings.mjs` ile additive uygulanır.

## Aktivasyon (operatör)
```bash
cd ~/Desktop/ollamas && bash .claude/apply-harness.sh   # settings merge + git gate + LSP/launchd reminder + 19-test suite
# sonra: Claude sekmesini restart (veya /clear) → settings yüklenir
/harness-check                                           # canlı doğrulama
```
Sistem-op (Terminal.app'ten, operatör):
```bash
bash orchestration/bin/autopilot-install.sh load        # launchd autopilot (GUI session şart)
npm i -g typescript-language-server typescript           # .lsp.json inline tip-tanı için
```

## Hook envanteri (`.claude/hooks/`)
| event | hook | iş |
|---|---|---|
| PreToolUse (Write\|Edit) | redact-tokens | literal secret VALUE yazımını deny |
| PreToolUse (Bash) | block-destructive | rm-rf/find-delete/force-push/mkfs deny |
| PreToolUse (Bash) | gate-before-commit | -A/--no-verify/empty-staged deny (amend hariç) |
| PostToolUse (Edit\|Write) | format-on-edit | dokunulan dosyayı format/lint |
| PreCompact | preserve-context | compaction öncesi durum snapshot |
| Stop | on-stop | tur-sonu durum |
| PostToolUseFailure | on-tool-failure | hata bağlamı → additionalContext |
| SubagentStop | on-subagent-stop | audit log |
| SessionEnd | on-session-end | flush + log trim |
| Notification | on-notification | log + macOS banner (permission/idle) |

Blockerlar `permissionDecision:"deny"` JSON (bypass-proof). Lifecycle hookları fail-safe exit 0.
Test: `bash .claude/hooks/test-hooks.sh` (golden suite).

## Sub-agentlar (`.claude/agents/`)
- `cli-coder` (sonnet, effort medium) — cli/** implementer.
- `cli-verifier` (opus, effort xhigh) — implementer≠verifier, bağımsız doğrular.
- `harness-reviewer` (opus, effort xhigh) — settings/hook/agent denetimi.

## Diğer
- `sandbox` (Seatbelt) + permissions allow/deny/ask + thinking effortLevel high.
- `.mcp.json` → mcp__ollamas__* · `.lsp.json` → TS diagnostics.
- Plugin: `bash .claude/build-plugin.sh` → `dist-plugin/ollamas-harness/`.

## OPT-IN (kasıtlı kapalı — gerekirse aç)
**OTel observability** — collector kurup `settings.json env`'e ekle:
```json
"env": { "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1",
  "CLAUDE_CODE_ENABLE_TELEMETRY":"1", "OTEL_METRICS_EXPORTER":"otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL":"grpc", "OTEL_EXPORTER_OTLP_ENDPOINT":"http://localhost:4317" }
```
**Proactive output style** — `settings.json`: `"outputStyle":"Proactive"` (sistem-prompt değişir; caveman/CLAUDE.md ile çakışabilir, dikkat).
**PreToolUse auto-allow** — gate'ten geçen komutları oto-onaylamak için hook'a `permissionDecision:"allow"` ekle (güvenlik/UX trade-off).

## KASITLI KURULMADI (kanıt yok)
`monitors/monitors.json` (resmi docs'ta yok) · `.claude/rules/ paths:` (buggy #17204/#23478) · `showThinkingSummaries` (uydurma key, prune edildi).
