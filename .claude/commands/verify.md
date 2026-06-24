---
description: PBVC gate — typecheck + full test suite (run before any commit/PR)
allowed-tools: Bash(npm run lint:*), Bash(npm run test:*)
---
Run the build-verification gate, in order:
1. `npm run lint` (tsc --noEmit — typecheck)
2. `npm run test` (vitest run — full suite)

Report each step's pass/fail and the test counts. Per PBVC §3.11, nothing is "complete" until both pass — if either fails, report the failure with its output and stop; do not claim done.
