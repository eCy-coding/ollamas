# CALIBRATION_100 — live · qwen3-coder:30b

- resolved (target exists): **100/100**
- actionable (SEARCH/REPLACE): **99/100**
- apply-clean (SEARCH verbatim): **99/100**
- crashes: **0** (must be 0 — pipeline never errors)

> Correctness at apply time = tsc+test gate + revert-on-red. This harness proves the pipeline PROCESSES
> 100 tasks with 0 crashes. Rerun: `tsx orchestration/bin/calibrate.ts --limit 100` (calibrate-100.ts was renamed to the count-agnostic calibrate.ts in iter-7).
