---
description: Generate the sequenced ethical mission (orchestration/MISSION.md) — turns the parallel fleet into step-by-step (T1→Tn) dependency-ordered tasks, ≤2 streams/model, each capped at an ethical tool-tier (never privileged; PROPOSE-only + gate).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/mission.ts:*), Bash(npx tsx orchestration/bin/mission.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/mission.ts`. It reuses buildFleetPlan (capability-matched, ≤2/model) + an explicit dependency map (shell-harden → mjs-migration → typescript-core → {errors-resilience, concurrency-safety} → test-coverage), topo-orders the streams into T1→Tn steps, and tags each with its ethical tool-tier (`safe` = read + new file; `host` = propose a patch, conductor-gated; never `privileged`). Report the ordered steps (T#, stream, models, dependsOn, tier) and whether ≤2/model holds. This encodes "use the MacBook within ethical bounds" as data. See `.claude/BRAIN.md`.
