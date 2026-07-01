---
name: fleet-orchestrator
description: Use when orchestrating the ollamas multi-model fleet across Terminal.app + iTerm2 — distributing a project-wide task to capability-matched local/cloud models (≤2 tasks each), running them as persistent living agent-tabs, gating their PROPOSE output, and driving to convergence. Also use to run the model-council analysis, the THINK problem-solving loop, or to follow the fleet live. Claude acts as conductor only (directs/controls/verifies; does not write feature code).
---

# Fleet Orchestrator

The autonomous multi-model orchestration system for ollamas. Full map: `.claude/BRAIN.md`.

## When to use
- Distribute a project-wide coding task across the local model fleet (TS / .mjs→TS / Shell / … streams).
- Analyze the whole project with the capability-matched model council + oracle verification.
- Solve a recurring problem via the evidence-based THINK loop (proven registry, no-guess).

## The loop (always PLAN before executing)
1. **deepthink / deepsearch** — understand the task; if a problem is hit, research ≥2 authoritative sources (never guess).
2. **PLAN** — every worker detects what's needed and emits a mini-plan BEFORE proposing changes.
3. **Dispatch** — `/council --debate` (analysis) or `/fleet --go` (living agent-tabs). ≤2 tasks/model; 1 local + N cloud (single-GPU FIFO ticket-lock).
4. **Gate** — oracle deterministic verify + `verdict + ## Change`; PROPOSE-only, conductor gates before apply.
5. **THINK** — `/think`: map findings to proven cited solutions; unknown → NEEDS_RESEARCH (append to registry when solved = learning).
6. **Verify + commit** — tsc 0 → vitest green → conventional commit (quiesce heavy load first so the gate isn't flaky).

## Commands
- `/fleet [--go] [--cloud-only] [--streams a,b]` — launch fleet (dry-run default).
- `/fleet-watch [--watch]` — operator live-follow console; `.log` files tail-able.
- `/fleet-stop` — kill-switch (release claims + stop agents).
- `/council [--all] [--debate] [--lane x]` — model-council project analysis.
- `/think` — evidence-based problem-solving loop.

## Hard rules
Evidence only (no guessing) · no half-work (gated = done) · single-GPU truth (FIFO, don't over-subscribe) ·
PROPOSE-not-mutate (gate before apply) · workers report to the conductor, not the operator · build EN, report TR.
