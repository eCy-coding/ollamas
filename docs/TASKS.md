# TASKS — the "enough" `ollamas do "<task>"` catalog to complete ollamas

The count is **derived from the project's real surface**, not a round number. `orchestration/TASKS.json`
holds N tasks (currently **339**), one per substantial exported-symbol module across every lane, each with
a real target file + a concrete additive goal.

## How it's built (count-agnostic)

```bash
tsx orchestration/bin/gen-catalog.ts    # walk lanes → one grounded task per substantial module → TASKS.gen.txt
tsx orchestration/bin/build-tasks.ts    # merge curated (TASKS_100.src.txt, priority) + generated, dedupe by
                                        # target, drop any missing target → TASKS.json (no cap = "yeteri kadar")
```
Curated tasks (specific goals) win the target-dedupe; the generator fills coverage for every other module.
N = the project's real taskable surface (backend 76, orchestration 80, frontend 55, cli 41, tunnel 29,
contract 21, host-bridge 20, scripts 13, tests 3, ops 1).

## Usage

```bash
ollamas tasks                 # list all N (id + goal)
ollamas do "<id>"             # run one — resolves to its target, grounds the local model, proposes a gated fix
ollamas do "<free text>"      # fuzzy-resolves to the nearest catalog task
```

## Calibration ("hatasız" = pipeline never errors)

```bash
tsx orchestration/bin/calibrate.ts --dry       # structural gate: N/N targets exist (CI-fast)
tsx orchestration/bin/calibrate.ts [--limit K]  # live: resolve→ground→actionable→apply-clean, per-task, 0 crashes
```
→ `orchestration/CALIBRATION.md`. A weak local model can't write N perfect diffs; the **gate + revert-on-red**
is the correctness guarantee. The harness proves the system PROCESSES all N without a crash (each task is
independently try-guarded — one failure never aborts the batch). Rebuild the catalog anytime the surface
changes and re-calibrate.
