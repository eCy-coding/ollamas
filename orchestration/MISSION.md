# MISSION.md — sequenced ethical mission (auto-generated)

> Auto: `tsx orchestration/bin/mission.ts` · 2026-07-01T22:16:41Z. Step-by-step (T1→Tn) dependency-ordered tasks the
> council executes end-to-end. Each step is PROPOSE-only (isolated --root) and capped at the shown
> tool-tier — `privileged` (open a real terminal / write host files) is NEVER auto-assigned; it stays
> behind an explicit operator gate. ≤2 streams/model. Map: `.claude/BRAIN.md`.

## Status: ✅ valid sequence · ≤2/model ✅

| T | Stream | Task | Models (≤2/model) | Depends on | Ethical tier | Gate |
|---|--------|------|-------------------|------------|--------------|------|
| T1 | shell-harden | env-guard + exit-code hardening | gpt-oss:20b-cloud, qwen3:8b | — | `host` | tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root) |
| T2 | mjs-migration | type-safety (.mjs → .ts, 490 files) | gpt-oss:120b-cloud, qwen3-coder-64k:latest | shell-harden | `host` | tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root) |
| T3 | typescript-core | security+types (all new logic) | qwen3-coder:480b-cloud, qwen3-coder:30b | mjs-migration | `host` | tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root) |
| T4 | errors-resilience | error-handling + exit-code + logging | qwen3-coder:480b-cloud, deepseek-r1:32b | typescript-core | `host` | tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root) |
| T5 | concurrency-safety | race-condition + synchronization | gpt-oss:120b-cloud, deepseek-r1:32b | typescript-core | `host` | tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root) |
| T6 | test-coverage | vitest coverage | gpt-oss:20b-cloud, qwen3:8b | errors-resilience, concurrency-safety | `safe` | tsc 0 + vitest green (read-only analysis + new file) |

## Ethical bounds (encoded, not prose)
- Every step runs a PROPOSE-only worker in an isolated `--root` — it never mutates the real repo tree.
- `safe` = read + new file only. `host` = propose a patch; the conductor gates (tsc+vitest) before apply.
- `privileged` (macos_terminal, write_host_file) is absent by design → no autonomous terminal/host-file use.
- The conductor (Claude) directs; workers report to the conductor, never to the operator.
