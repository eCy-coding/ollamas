---
description: Launch the local model-fleet across Terminal.app + iTerm2 — persistent living agents, ≤2 tasks/model, single-GPU FIFO ticket-lock, PROPOSE-only. Claude stays conductor.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-launch.ts:*), Bash(npx tsx orchestration/bin/fleet-launch.ts:*)
argument-hint: "[--go] [--cloud-only] [--streams a,b]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-launch.ts $ARGUMENTS` from the repo root.

Default (no `--go`) is a DRY RUN — print the plan (stream → Terminal.app/iTerm2 model, local/cloud, ≤2/model invariant) and the wrapper commands, open NO windows. Add `--go` to actually open the persistent living-agent tabs.

After it runs: report the assignment table (stream · Terminal.app model · iTerm2 model · runtime), the ≤2/model check, and the single next command (`/fleet-watch` to follow live, `/fleet-stop` to kill). The system truth: 1 local + N cloud parallel; local slots serialize via the FIFO ticket-lock (`orchestration/bin/lib/gpu-lock.ts`). See `.claude/BRAIN.md`.
