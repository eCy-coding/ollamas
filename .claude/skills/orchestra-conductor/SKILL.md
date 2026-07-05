---
name: orchestra-conductor
description: Use when running or reasoning about ollamas' $0 Claude-Code-FREE conductor — the local-model FSM loop that autonomously completes the project (BOOTSTRAP→COUNCIL→BENCHMARK→{DEPLOY|REPAIR}→MONITORING) with live joker failover, the count-agnostic task catalog, autonomous backlog-drain, gated apply (revert-on-red), completion progress, and the turnkey `ollamas` command + persistent daemon. This is the default conductor; claude-dispatch is the opt-in escalation. Also use to install/activate the daemon, drain the catalog 0-manual, or calibrate the `ollamas do` pipeline.
---

# Orchestra Conductor (the $0, Claude-Code-free conductor)

Local model conducts the build loop — NO Claude Code, NO cloud API. If the conductor model dies, a joker
takes over from persisted state and the loop keeps running. Full map: `orchestration/ORCHESTRA.md`, `.claude/BRAIN.md`.

## When to use
- Run/observe the autonomous conductor (`/orchestra --once|--watch|--status`).
- Give it work: `/do "<catalog-id | free-text>"` (reactive) or `/drain on` (autonomous, works the whole catalog).
- Track project completion: `/progress` (done X/N + per-lane). List the backlog: `/tasks`.
- Calibrate the pipeline is flawless: `/calibrate --dry` (integrity) / `/calibrate` (live).
- Make it turnkey/permanent: install command + KeepAlive daemon (operator/T0).

## The FSM loop (pure core `lib/orchestra-fsm.ts` + IO shell `orchestra.ts`)
```
BOOTSTRAPPING → COUNCIL_DEBATE → BENCHMARK_VALIDATION → { DEPLOYMENT | REPAIR } → MONITORING
                     REPAIR ⟳ (retry ≤ 3) → ESCALATE (daemon stays open)
```
- **Conductor model** = benchmark pick (`MODEL_SELECTION.json`, `qwen3-coder:30b`); **joker** = `qwen3:8b` warm.
- Each tick health-probes the conductor; on down/OOM/timeout → swap to joker, `failover_count++`, resume same state.
- Each tick OBSERVES read-only signals (`conduct`/`fleet-conduct`); a timed-out child = neutral → daemon never exits.
- An explicit task (from `/do` or drain) routes BENCHMARK→REPAIR (execute before ship); ship only when converged + no task.
- **REPAIR** = the conductor is a fleet worker: grounds the local model on the task's real file → SEARCH/REPLACE
  PROPOSAL → with `.orchestra-apply-enabled`, `fleet-apply --apply` gates (tsc+tests) and applies, **reverted on red**.

## Commands
- `/orchestra [--once | --watch <sec> | --status]` — the conductor loop / status.
- `/do "<id | text>"` — enqueue a task (resolves to its catalog target).
- `/tasks` — list the catalog (TASKS.json, one grounded task per module). `/progress` — done X/N + per-lane.
- `/drain on|off|status` — autonomous backlog-drain (0-manual project completion; opt-in marker).
- `/calibrate [--dry | --limit N]` — e2e pipeline calibration (resolve→ground→actionable→apply-clean, 0 crashes).
- Install/daemon (operator/T0, system mutation): `bash orchestration/bin/install-ollamas-cmd.sh --full`
  (command + KeepAlive conductor daemon). `ollamas ready` = preflight self-heal.

## Autonomy markers (opt-in, mirror claude-dispatch's safety pattern)
- `orchestration/.orchestra-apply-enabled` → REPAIR gated-applies (else propose-only).
- `orchestration/.orchestra-autodrain-enabled` → idle conductor auto-pulls the next PENDING catalog task.
- Both on + daemon loaded = the system completes the project unattended (watch `/progress`).

## Hard rules
$0 local-first (no Claude Code) · gate + revert-on-red (never break the tree) · PROPOSE-not-mutate · auto-commit
OFF by default · outward-facing (symlink/`~/.zshrc`/launchctl) = operator/T0 decision · build EN, report TR ·
evidence-before-claims (run it, show output).
