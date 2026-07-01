# CODINGS_STATUS.md — what's DONE vs MISSING (evidence-referenced)

> Status of the orchestration/fleet build + the CODE_PLAN stream proposals. DONE = code + test + commit
> exist (verified). MISSING/QUEUED = proposal exists but not yet applied, with the reason + owning lane.
> No guessing: every DONE row cites a file + commit; every MISSING row cites why it's held.

## A. Orchestration system — DONE (built + tested + committed)

| # | Coding | Files | Test | Commit |
|---|--------|-------|------|--------|
| council | 18-model analysis + oracle + debate | `orchestration/bin/council.ts` + `lib/{council,council-roster}.ts` | 24 | 78e9ad0 / f187570 |
| fleet-plan | ≤2/model assignment, 2-app ensemble | `orchestration/bin/lib/fleet-plan.ts` | 11 | 5bfebc3 |
| fleet-launch | Terminal.app+iTerm2 living-agent tabs | `orchestration/bin/fleet-launch.ts` | (integration) | 5bfebc3 / f464b75 |
| fleet-agent | persistent worker: plan→claim→GPU→dispatch→gate→next | `orchestration/bin/fleet-agent.ts` | (live) | f464b75 |
| fleet-conduct | conductor daemon + gate + --watch/--stop | `orchestration/bin/fleet-conduct.ts` | (live) | 5bfebc3 / c71a48e |
| fleet-watch | live-follow console | `orchestration/bin/fleet-watch.ts` | (live) | d298177 |
| gpu-lock | FIFO ticket-lock (starvation-free) | `orchestration/bin/lib/gpu-lock.ts` | 10 | d1cce40 |
| backoff | exp backoff + full jitter | `orchestration/bin/lib/backoff.ts` | 7 | d1cce40 |
| think | evidence registry, no-guess | `orchestration/bin/{think.ts,lib/think.ts}` + `PROBLEM_REGISTRY.json` | 9 | 0ddcde3 |
| fleet-next | precompute next-task queue | `orchestration/bin/{fleet-next.ts,lib/fleet-next.ts}` | 7 | a784638 |
| native | /slash ×6 + BRAIN.md + skill + lieutenant | `.claude/{commands,skills,agents}/*` | (frontmatter) | 7e13139 |

**Totals:** orchestration vitest ~632+ green · tsc 0 · whole-repo gate PASS (calm).

## B. CODE_PLAN stream proposals — apply status

| Stream | Proposal | Status | Evidence |
|--------|----------|--------|----------|
| errors-resilience | `formatSseError` + `isSessionStalled` in `server/agent-events.ts` | ✅ **DONE (applied)** | additive pure exports; `tests/agent-events.test.ts` 16 green; tsc 0 |
| mjs-migration | `scripts/tsconfig.json` (incremental .mjs→.ts) | ✅ **DONE (applied)** | `tsc -p scripts/tsconfig.json --noEmit` = 0 errors |
| test-coverage | `cli/lib/client.ts` `parseSSEBuffer` unit test | ✅ **DONE (applied)** | `tests/cli-parse-sse.test.ts` 6 green (node-project gateable — test placed in `tests/`, imports `../cli/lib/client`) |
| typescript-core | `server/analyzer.ts:computeGaps` tool-implementation validation | ✅ **DONE** | already coded + tested: `tests/audit-batch2-server.test.ts` (2 cases) — no dup added (DRY) |
| concurrency-safety | `server/lib/single-flight.ts` + host-bridge cold-start `resolveBridgeBase` wire | ✅ **DONE (applied)** | `tests/single-flight.test.ts` (3) + `tests/host-bridge-resolve.test.ts` (3): concurrent→one probe, cached, none→null; tsc 0. Behavior-preserving GET-`/` probe |
| shell-harden | `bin/require-env.sh` (sourceable guard) + `start.sh` wire | ✅ **DONE (applied)** | `scripts/tests/require-env.test.ts` (4): set→silent, unset→exit 78+msg, lists-all, empty→unset; start.sh sources it |

## C. Why the QUEUED items are held (not half-work)

Held items are **runtime-behavior-changing** or **non-gateable here** — applying them blind would risk the
live server/boot (violates 0-hata) or can't be verified by the root gate. They are queued in `FLEET_NEXT.md`
for the owning lane to apply + verify with its own gate. Queued ≠ abandoned.

## C.1 Infra debt — FIXED

| Item | Status | Evidence |
|------|--------|----------|
| `scripts/tests/self-heal.test.ts` flaky (forced GATE_SKIP every commit) | ✅ **FIXED** | root cause: `self_heal.mjs` probe `AbortSignal.timeout(5000)` == test 5000ms → collision. Fix: probe → 1500ms (fail-fast). **FULL-repo gate now green with NO GATE_SKIP** (1348 passed, 0 failed). Registry learned: `test-flaky-timeout`. |

## D. Next task (conductor-assigned) — see FLEET_NEXT.md

1. **P1** cli-lane: apply `parseSSEBuffer` test via the cli test runner.
2. **P2** server-lane: apply host-bridge single-flight with a live-bridge test.
3. **P2** scripts-lane: apply `start.sh` require_env with a boot test.
4. **P3** think-loop: research the NEEDS_RESEARCH items → append to `PROBLEM_REGISTRY.json`.
