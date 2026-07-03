# FLEET_APPLY.md — conductor apply-readiness triage (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts` · 2026-07-03T02:57:33Z. Extracts each gated proposal's diff and dry-runs
> `git apply --check`. "Apply-ready" = a shaped diff (real line-numbers or new-file) that applies to the
> current tree. The conductor applies only these (opt-in, gated); illustrative diffs are surfaced, not applied.

## Result: 4/6 proposals apply-ready

| Stream/slot | Model | Diff | Apply-ready | Files | Reason |
|-------------|-------|------|-------------|-------|--------|
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | server/host-bridge.ts | search/replace resolves cleanly against the current tree |
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | ✅ | **✅** | server/agent-events.ts | search/replace resolves cleanly against the current tree |
| mjs-migration.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | scripts/agent-dispatch.mjs | search/replace resolves cleanly against the current tree |
| shell-harden.terminal | `gpt-oss:20b-cloud` | ✅ | **✅** | start.sh | search/replace resolves cleanly against the current tree |
| test-coverage.terminal | `gpt-oss:20b-cloud` | ✅ | — | — | target tests/cli-http.test.ts not found |
| typescript-core.terminal | `qwen3-coder:480b-cloud` | ✅ | — | — | server/analyzer.ts: SEARCH snippet not found in target (stale / not an exact copy) |

## Apply-ready (conductor may `--apply`, gated)
- `concurrency-safety.terminal` (gpt-oss:120b-cloud) → server/host-bridge.ts — `tsx orchestration/bin/fleet-apply.ts --apply concurrency-safety.terminal`
- `errors-resilience.terminal` (qwen3-coder:480b-cloud) → server/agent-events.ts — `tsx orchestration/bin/fleet-apply.ts --apply errors-resilience.terminal`
- `mjs-migration.terminal` (gpt-oss:120b-cloud) → scripts/agent-dispatch.mjs — `tsx orchestration/bin/fleet-apply.ts --apply mjs-migration.terminal`
- `shell-harden.terminal` (gpt-oss:20b-cloud) → start.sh — `tsx orchestration/bin/fleet-apply.ts --apply shell-harden.terminal`
