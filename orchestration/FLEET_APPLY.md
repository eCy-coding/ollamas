# FLEET_APPLY.md — conductor apply-readiness triage (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts` · 2026-07-03T00:26:34Z. Extracts each gated proposal's diff and dry-runs
> `git apply --check`. "Apply-ready" = a shaped diff (real line-numbers or new-file) that applies to the
> current tree. The conductor applies only these (opt-in, gated); illustrative diffs are surfaced, not applied.

## Result: 1/15 proposals apply-ready

| Stream/slot | Model | Diff | Apply-ready | Files | Reason |
|-------------|-------|------|-------------|-------|--------|
| mjs-migration.terminal | `gpt-oss:120b-cloud` | ✅ | **✅** | scripts/agent-dispatch.ts | clean — applies to the current tree |
| concurrency-safety.conductor | `claude-conductor` | ✅ | — | server/host-bridge.ts | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | ✅ | — | — | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| errors-resilience.conductor | `claude-conductor` | ✅ | — | server/agent-events.ts | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| errors-resilience.iterm2 | `deepseek-r1:32b` | — | — | — | no diff block |
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | ✅ | — | server/agent-events.ts | diff shaped but `git apply --check` failed (stale vs current tree) |
| mjs-migration.conductor | `claude-conductor` | ✅ | — | — | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| shell-harden.conductor | `claude-conductor` | ✅ | — | start.sh | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| shell-harden.iterm2 | `qwen3:8b` | — | — | — | no diff block |
| shell-harden.terminal | `gpt-oss:20b-cloud` | — | — | — | no diff block |
| test-coverage.conductor | `claude-conductor` | ✅ | — | — | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| test-coverage.iterm2 | `qwen3:8b` | — | — | — | no diff block |
| test-coverage.terminal | `gpt-oss:20b-cloud` | ✅ | — | test/client.test.ts | illustrative diff (no real line-numbers / new-file marker) — not machine-applyable |
| typescript-core.iterm2 | `qwen3-coder:30b` | ✅ | — | src/ollama.ts | diff shaped but `git apply --check` failed (stale vs current tree) |
| typescript-core.terminal | `qwen3-coder:480b-cloud` | ✅ | — | server/analyzer.ts | diff shaped but `git apply --check` failed (stale vs current tree) |

## Apply-ready (conductor may `--apply`, gated)
- `mjs-migration.terminal` (gpt-oss:120b-cloud) → scripts/agent-dispatch.ts — `tsx orchestration/bin/fleet-apply.ts --apply mjs-migration.terminal`
