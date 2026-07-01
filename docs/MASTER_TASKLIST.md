# MASTER_TASKLIST.md — persistent task list (auto-generated, do not hand-edit)

> Auto: `tsx orchestration/bin/tasklist.ts` · 2026-07-01T21:41:25Z. The operator's recurring master-directive as
> durable acceptance-criteria + live DONE/next. Refreshed by autopilot + `/tasklist`. Map: `.claude/BRAIN.md`.

## A. Master-directive acceptance (12/12)
- [x] **council** — Council: capability-matched multi-model analysis + oracle verify + debate  
  ↳ orchestration/bin/council.ts, /council
- [x] **fleet-tabs** — Terminal.app + iTerm2 living agent-tabs, ≤2 tasks/model, stay open  
  ↳ fleet-launch --go, fleet-agent (persistent + exec \$SHELL)
- [x] **single-gpu** — Single-GPU truth: 1 local + N cloud, FIFO ticket-lock (starvation-free)  
  ↳ gpu-lock.ts (Lamport bakery)
- [x] **always-open** — Always-open daemon: veri al/ver, görev al/ver, never exit  
  ↳ fleet-conduct --watch (Monitor persistent)
- [x] **live-follow** — Live-follow system: .log + status, operator watches  
  ↳ fleet-watch --watch + per-worker .log
- [x] **think** — Sustainable thinking loop: evidence-registry, no-guess, learns  
  ↳ think.ts + PROBLEM_REGISTRY.json, /think
- [x] **plan-first** — Every worker plans before executing (## Plan:) + precomputes next (## Next:)  
  ↳ fleet-agent taskPrompt
- [x] **native** — Native Claude Code: /slash + BRAIN.md + skill + lieutenant  
  ↳ .claude/{commands,BRAIN.md,skills,agents}
- [x] **no-half** — No half-work: every coding gated (test = proof) or evidence-queued  
  ↳ 6/6 CODE_PLAN streams gated (CODINGS_STATUS.md)
- [x] **evidence** — Only evidence, no guessing: sources cited or NEEDS_RESEARCH  
  ↳ PROBLEM_REGISTRY sources + THINK no-guess
- [x] **gate-clean** — e2e 100%: full-repo gate green with NO GATE_SKIP  
  ↳ self-heal flaky fixed (6082ddc) — verify each commit
- [x] **report-tr** — Build EN, report TR  
  ↳ all commits EN, reports TR

## B. Current status
- CODE_PLAN streams: **6/6 DONE** (docs/CODINGS_STATUS.md)
- THINK: 0 PROVEN · 25 NEEDS_RESEARCH (PROBLEM_REGISTRY.json)
- Full-repo gate: ✅ green, NO GATE_SKIP

## C. DONE log (vO history)
- vO16 — hybrid model-council (roster + oracle + E2E) (`78e9ad0`)
- vO17 — local multi-terminal model-fleet (`5bfebc3`)
- vO18 — always-open conductor daemon (`c71a48e`)
- vO19 — living agent-tabs (persistent, iTerm2 fallback) (`f464b75`)
- vO20 — proven fixes: ticket-lock + backoff + skip-done (`d1cce40`)
- vO21 — conductor-escalation → 6/6 CONVERGED (`193e597`)
- vO22 — sustainable THINK loop (evidence-registry, no-guess) (`0ddcde3`)
- vO23 — native Claude Code capabilities + plan-first (`7e13139`)
- vO24 — next-task queue + worker precompute-next (`a784638`)
- vO25 — codings: agent-events SSE + scripts tsconfig (`f577999`)
- vO26 — codings: cli parseSSEBuffer test (`7bec554`)
- vO27 — final 3 streams complete (6/6, single-flight/require-env) (`6ea7926`)
- vO28 — self-heal flaky root-fix (gate clean, no GATE_SKIP) (`6082ddc`)

## D. Next-task queue (2 P1 safe-additive · 26 total) — see FLEET_NEXT.md
- recent: 6082ddc fix(host-bridge): self-heal probe fail-fast (5000→1500) — kills the recurring flaky, NO GATE_SKIP
- recent: 6ea7926 feat: complete final 3 streams — real code + gated tests (6/6 DONE, no QUEUED)
- recent: 7bec554 feat: complete test-coverage coding — cli parseSSEBuffer unit test (gateable)
- recent: f577999 feat: complete gateable codings — agent-events SSE error/stall + scripts tsconfig + CODINGS_STATUS
- recent: a784638 feat(orchestration): next-task queue + worker precompute-next (## Next:)

> Convergence = all acceptance ✅ + gate clean + next-queue drained. This file is the durable source of
> truth across sessions; the plan file is scratch.
