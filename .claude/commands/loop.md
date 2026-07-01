---
description: Run the end-to-end convergence loop — repeats the autopilot chain (council/fleet/think/…) until the system converges (all acceptance ✅ + gate clean + P1 queue drained) or a bounded round cap, then reports honestly. Writes docs/E2E_LOOP.md.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/loop.ts:*), Bash(npx tsx orchestration/bin/loop.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/loop.ts` (add `--rounds N` for a different cap, `--watch` to supervise persistently). Each round runs the autopilot chain end-to-end, then reads MASTER_TASKLIST acceptance + FLEET_NEXT P1 → convergence check. Report the final verdict (CONVERGED or NOT CONVERGED after N rounds), the per-round summary, and any honest remaining gaps. Convergence = all master-directive acceptance criteria ticked + full-repo gate clean (no GATE_SKIP) + P1 safe-additive queue drained. See `.claude/BRAIN.md`.
