# FLEET_APPLY.md — conductor apply-readiness triage (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts` · 2026-07-04T08:56:12Z. Extracts each gated proposal's diff and dry-runs
> `git apply --check`. "Apply-ready" = a shaped diff (real line-numbers or new-file) that applies to the
> current tree. The conductor applies only these (opt-in, gated); illustrative diffs are surfaced, not applied.

## Result: 8/9 proposals apply-ready

| Stream/slot | Model | Diff | Apply-ready | Tier | Files | Reason |
|-------------|-------|------|-------------|------|-------|--------|
| concurrency-safety.cerebras | `gpt-oss-120b` | ✅ | **✅** | review | server/host-bridge.ts | search/replace resolves cleanly against the current tree |
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | review | server/host-bridge.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.gemini | `gemini-2.5-flash` | ✅ | **✅** | safe-auto | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.groq | `llama-3.3-70b-versatile` | ✅ | **✅** | safe-auto | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | ✅ | **✅** | safe-auto | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| mjs-migration.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | safe-auto | scripts/agent-dispatch.mjs | search/replace resolves cleanly against the current tree |
| shell-harden.terminal | `gpt-oss:20b-cloud` | ✅ | **✅** | blocked | start.sh | search/replace resolves cleanly against the current tree |
| typescript-core.terminal | `qwen3-coder:480b-cloud` | ✅ | **✅** | review | server/analyzer.ts | search/replace resolves cleanly against the current tree |
| test-coverage.terminal | `gpt-oss:20b-cloud` | — | — | blocked | — | no diff block |

## Apply-ready (conductor may `--apply`, gated)
- `concurrency-safety.cerebras` (gpt-oss-120b) → server/host-bridge.ts — `tsx orchestration/bin/fleet-apply.ts --apply concurrency-safety.cerebras`
- `concurrency-safety.terminal` (gpt-oss:120b-cloud) → server/host-bridge.ts — `tsx orchestration/bin/fleet-apply.ts --apply concurrency-safety.terminal`
- `errors-resilience.gemini` (gemini-2.5-flash) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.gemini`
- `errors-resilience.groq` (llama-3.3-70b-versatile) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.groq`
- `errors-resilience.terminal` (qwen3-coder:480b-cloud) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.terminal`
- `mjs-migration.terminal` (gpt-oss:120b-cloud) → scripts/agent-dispatch.mjs — `tsx orchestration/bin/fleet-apply.ts --apply mjs-migration.terminal`
- `shell-harden.terminal` (gpt-oss:20b-cloud) → start.sh — `tsx orchestration/bin/fleet-apply.ts --apply shell-harden.terminal`
- `typescript-core.terminal` (qwen3-coder:480b-cloud) → server/analyzer.ts — `tsx orchestration/bin/fleet-apply.ts --apply typescript-core.terminal`
