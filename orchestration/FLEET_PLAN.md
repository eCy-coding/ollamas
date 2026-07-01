# FLEET_PLAN.md — Local model-fleet (Terminal.app + iTerm2)

> Auto: `tsx orchestration/bin/fleet-launch.ts`. Single-GPU: local slots serialize (gpu claim); cloud parallel.
> ≤2 streams/model: ✅ OK · local slots 6 · cloud slots 6

| Stream | Concern | Terminal.app | iTerm2 |
|--------|---------|--------------|--------|
| typescript-core | security+types (all new logic) | `qwen3-coder:480b-cloud` (cloud) | `qwen3-coder:30b` (local) |
| errors-resilience | error-handling + exit-code + logging | `qwen3-coder:480b-cloud` (cloud) | `deepseek-r1:32b` (local) |
| concurrency-safety | race-condition + synchronization | `gpt-oss:120b-cloud` (cloud) | `deepseek-r1:32b` (local) |
| mjs-migration | type-safety (.mjs → .ts, 490 files) | `gpt-oss:120b-cloud` (cloud) | `qwen3-coder-64k:latest` (local) |
| shell-harden | env-guard + exit-code hardening | `gpt-oss:20b-cloud` (cloud) | `qwen3:8b` (local) |
| test-coverage | vitest coverage | `gpt-oss:20b-cloud` (cloud) | `qwen3:8b` (local) |

## Per-model load (≤2)
- `deepseek-r1:32b` → 2: errors-resilience, concurrency-safety
- `gpt-oss:120b-cloud` → 2: concurrency-safety, mjs-migration
- `gpt-oss:20b-cloud` → 2: shell-harden, test-coverage
- `qwen3-coder-64k:latest` → 1: mjs-migration
- `qwen3-coder:30b` → 1: typescript-core
- `qwen3-coder:480b-cloud` → 2: typescript-core, errors-resilience
- `qwen3:8b` → 2: shell-harden, test-coverage
