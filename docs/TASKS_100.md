# TASKS_100 — 100 critical `ollamas do "<task>"` to complete ollamas

The machine catalog is **`orchestration/TASKS_100.json`** (100 tasks, each with a real target file + a
small additive goal). Rebuild from `orchestration/TASKS_100.src.txt` via
`tsx orchestration/bin/build-tasks-100.ts` (drops any task whose target doesn't exist → every catalog
target is guaranteed real).

## Usage

```bash
ollamas tasks                 # list all 100 (id + goal)
ollamas do "<id>"             # run one — resolves to its target, grounds the local model, proposes a gated fix
ollamas do "<free text>"      # fuzzy-resolves to the nearest catalog task (id / goal / target tokens)
```

Each `ollamas do` grounds the conductor's REPAIR phase on the task's own file (`lib/task-catalog.ts`
`resolveTask`), so an arbitrary task lands on the RIGHT file (before iter-6 everything fell back to the
6-entry FOCUS map). With `orchestration/.orchestra-apply-enabled` present, the proposal is gated
(tsc+tests) and applied — reverted on red, so the tree never breaks.

## Lane coverage (100)

backend 26 · cli 18 · orchestration 11 · contract 11 · tunnel 10 · frontend 10 · host-bridge 5 ·
scripts 5 · tests 3 · ops 1.

## Calibration ("hatasız" = pipeline never errors)

```bash
tsx orchestration/bin/calibrate-100.ts --dry     # structural gate: 100/100 targets exist (CI-fast)
tsx orchestration/bin/calibrate-100.ts           # live: resolve→ground→actionable→apply-clean, per-task, 0 crashes
```
→ `orchestration/CALIBRATION_100.md`. A weak local model can't write 100 perfect diffs; the **gate +
revert-on-red** is the correctness guarantee. The harness proves the system PROCESSES all 100 without a
single crash (each task is independently try-guarded — one failure never aborts the batch).
