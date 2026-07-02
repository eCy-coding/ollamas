# FLEET_STATUS.md — conductor view (report to Claude, not user)

> Auto: `tsx orchestration/bin/fleet-conduct.ts` · reports 15 · active 0
> Convergence: ⏳ in-progress

| Stream | Ensemble | Gated | Detay |
|--------|----------|-------|-------|
| concurrency-safety | ✅ | 1/3 | conductor=✅(claude-conductor(escalation: fleet-blocked)) · iterm2=❌(deepseek-r1:32b) · terminal=❌(gpt-oss:120b-cloud) |
| errors-resilience | ✅ | 1/3 | conductor=✅(claude-conductor(escalation: fleet-blocked)) · iterm2=❌(deepseek-r1:32b) · terminal=❌(qwen3-coder:480b-cloud) |
| mjs-migration | ✅ | 1/3 | conductor=✅(claude-conductor(escalation: fleet-blocked)) · iterm2=❌(qwen3-coder-64k:latest) · terminal=❌(gpt-oss:120b-cloud) |
| shell-harden | ⏳ | 0/1 | terminal=❌(gpt-oss:20b-cloud) |
| test-coverage | ✅ | 1/3 | conductor=✅(claude-conductor(escalation: fleet-blocked)) · iterm2=❌(qwen3:8b) · terminal=❌(gpt-oss:20b-cloud) |
| typescript-core | ✅ | 1/2 | iterm2=❌(qwen3-coder:30b) · terminal=✅(qwen3-coder:480b-cloud) |
