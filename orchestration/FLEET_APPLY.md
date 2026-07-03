# FLEET_APPLY.md — conductor apply-readiness triage (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts` · 2026-07-03T09:18:50Z. Extracts each gated proposal's diff and dry-runs
> `git apply --check`. "Apply-ready" = a shaped diff (real line-numbers or new-file) that applies to the
> current tree. The conductor applies only these (opt-in, gated); illustrative diffs are surfaced, not applied.

## Result: 5/7 proposals apply-ready

| Stream/slot | Model | Diff | Apply-ready | Tier | Files | Reason |
|-------------|-------|------|-------------|------|-------|--------|
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | review | server/host-bridge.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.gemini | `gemini-2.5-flash` | ✅ | **✅** | safe-auto | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | ✅ | **✅** | safe-auto | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| mjs-migration.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | blocked | scripts/agent-dispatch.mjs | search/replace resolves cleanly against the current tree · IMPORT-UNSAFE: adds a runtime import of a type-only file (./agent-dispatch.d.ts) → node crashes (ERR_MODULE_NOT_FOUND) |
| shell-harden.terminal | `gpt-oss:20b-cloud` | ✅ | **✅** | blocked | start.sh | search/replace resolves cleanly against the current tree |
| test-coverage.terminal | `gpt-oss:20b-cloud` | ✅ | — | blocked | — | target tests/cli-http.test.ts not found |
| typescript-core.terminal | `qwen3-coder:480b-cloud` | ✅ | — | blocked | — | server/analyzer.ts: SEARCH snippet not found in target (stale / not an exact copy) |

## Apply-ready (conductor may `--apply`, gated)
- `concurrency-safety.terminal` (gpt-oss:120b-cloud) → server/host-bridge.ts — `tsx orchestration/bin/fleet-apply.ts --apply concurrency-safety.terminal`
- `errors-resilience.gemini` (gemini-2.5-flash) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.gemini`
- `errors-resilience.terminal` (qwen3-coder:480b-cloud) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.terminal`
- `mjs-migration.terminal` (gpt-oss:120b-cloud) → scripts/agent-dispatch.mjs — `tsx orchestration/bin/fleet-apply.ts --apply mjs-migration.terminal`
- `shell-harden.terminal` (gpt-oss:20b-cloud) → start.sh — `tsx orchestration/bin/fleet-apply.ts --apply shell-harden.terminal`
