---
description: Calibrate the `ollamas do` pipeline e2e — per task, resolve→ground→actionable→apply-clean, each try-guarded so one failure never aborts the batch. --dry = fast structural integrity gate (N/N targets exist).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/calibrate.ts:*), Bash(npx tsx orchestration/bin/calibrate.ts:*)
argument-hint: "[--dry | --limit <N>] [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/calibrate.ts $ARGUMENTS`.

`--dry` = structural gate (every catalog target exists → resolved N/N), instant, CI-safe. No flags = live
per-task calibration against the local model (slow — bound with `--limit <N>`): measures resolved / actionable
(SEARCH/REPLACE) / apply-clean (SEARCH matches the file verbatim) / crashes. Writes `orchestration/CALIBRATION.md`.
"Hatasız" = the pipeline PROCESSES all N with 0 crashes; correctness at apply time = gate + revert-on-red (a
weak local model can't write N perfect diffs, and it doesn't have to). Report resolved/apply-clean/crashes.
