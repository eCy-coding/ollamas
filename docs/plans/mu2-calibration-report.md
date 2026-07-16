# µ2 HIERARCHY_POLICY calibration — evidence gap report (C3)

**Verdict: data insufficient. No HIERARCHY_POLICY.json was written. Advisory mode is left as the only reachable mode (unchanged).**

## Task recap

`orchestration/bin/lib/hierarchy.ts` (`parsePolicy`) requires, per route, a `wilsonLow`
(Wilson-lower-bound win-rate) and a `chosenTier` ∈ `{local, sonnet, opus}`, sourced from
`evidence.scorecard` — a real pass/fail benchmark, not a usage count. `server/hierarchy-bridge.ts`
additionally rejects (`checkPolicyUsable`) any policy where all routes resolve to the same tier —
this is the documented **S0 GOTCHA**, called out verbatim in `planlama/11-MIMARI.md` §10:

> Risk: benchmark correctness (memory gotcha: out:""/ran:false hep-false) → HIERARCHY_POLICY bloke.

This report exists so that gotcha is not repeated with a different data source.

## What was inspected

1. `orchestration/bin/calibrate.ts` + `orchestration/tests/calibrate.test.ts` — this harness measures
   whether the `ollamas do` PROPOSE-ONLY pipeline *processes* the 100-task catalog without crashing
   (resolved → actionable SEARCH/REPLACE → apply-clean), for **one model at a time**
   (`--model`, default `qwen3-coder:30b` from `MODEL_SELECTION.json`). It does not compare tiers, does
   not label task-classes the way `hierarchy.ts` expects, and produces no win/loss tally across
   `local`/`sonnet`/`opus`. It is a pipeline-integrity gate, not a tier-comparison benchmark — using its
   output as `wilsonLow` would be a category error, not a measurement.

2. `server/hierarchy-bridge.ts` policy loader — reads `HIERARCHY_POLICY_PATH` env, falling back to
   `orchestration/HIERARCHY_POLICY.json` (relative to `process.cwd()`). Neither exists on disk; the live
   snapshot before this task honestly reports `policyValid:false, policyReason:"no-policy: missing or
   unparseable"` (verified below). That is the correct, honest state — nothing changed it.

3. `~/.ollamas/council-ledger.json` (~8.6 KB, `tasks:1721`) — inspected field-by-field:
   - `calibration: {math|bilim|genel|fact|code|search: {agent: winCount}}` — **win-only tallies for
     whichever agent(s) won at least once per class**. There is no loss count and no total-attempts
     denominator per class per agent, so a Wilson lower bound (which needs successes **and** n trials)
     cannot be computed from this shape without inventing a denominator.
   - `history` — a **50-entry ring buffer** (not the full 1721), covering only **10 distinct task
     strings**, each entry `{task, winner, bestScore, verifiable}`. No per-competitor scores (only the
     winner is recorded), no task-class label, no tier label, no timestamp.
   - The four competitors tracked (`ecy`, `ollamas`, `odysseus`, `claudecode`) are **named agents in a
     4-way council vote** (see `server.ts` ~line 3312, `COUNCIL_OWNERS` — a reward-ledger/synthesis
     system with weighted owners, e.g. `ollamas` = groq provider weight 0.25, `odysseus` = 0.23), **not**
     the `local`/`sonnet`/`opus` tier taxonomy `hierarchy.ts` routes on. Mapping `ollamas→local`,
     `claudecode→sonnet-or-opus` is an unverifiable guess — nothing in the ledger records which Claude
     tier `claudecode` entries actually ran, and `ecy`/`odysseus` don't map onto the 3-tier ladder at
     all. Inventing that mapping to force a Wilson number is exactly the fabrication this task's honesty
     gate forbids.
   - Conclusion: council-ledger is real competitive-selection evidence for its own purpose (owner
     reward weighting), but it answers a different question ("which named agent wins a 4-way vote") than
     the one `HIERARCHY_POLICY` routes need ("does tier X reliably pass task-class Y"). It is a usage/
     outcome log for a different system, not tier-benchmark evidence.

4. No `orchestration/scorecard.json` or equivalent exists in the repo (`find` confirmed). `evidence.scorecard`
   has nowhere honest to point.

## What would produce valid data

A scorecard generator that runs the **same** task-class benchmark set against each of the three tiers
(`local` = an Ollama model, `sonnet`, `opus`) with ground-truth pass/fail checks, tallies successes/n per
`{taskClass, tier}`, and computes `wilsonLow` via a proper Wilson score interval — then a thin adapter
(NOT `calibrate.ts`, which measures something else) writes that into the `routes[]`/`gate`/
`escalationLadder`/`evidence` shape `parsePolicy` requires, with `evidence.scorecard` pointing at the
real generated file. Until that harness exists and is run, any `HIERARCHY_POLICY.json` on disk would be
degenerate-by-construction.

## Action taken

- No `orchestration/HIERARCHY_POLICY.json` written.
- No changes to `server/hierarchy-bridge.ts` or `orchestration/bin/lib/hierarchy.ts` — advisory-only
  behavior is correct and untouched; `enforce` remains structurally unreachable without real evidence.
- Existing coverage (`orchestration/tests/hierarchy.test.ts`, 14 cases; `server/hierarchy-bridge.test.ts`,
  full suite) already exercises `parsePolicy`/`checkPolicyUsable` against in-memory good/degenerate
  fixtures — no new fixture was needed.
- Live-verified: `HIERARCHY_ROUTING=advisory` → `getHierarchySnapshot()` reports
  `policyValid:false, policyReason:"no-policy: missing or unparseable"` — the honest current state.

## Blocker to file forward

Building the scorecard generator described above is a separate, larger piece of work (a real
cross-tier benchmark harness) — out of scope for this pass. Filing as the next µ2 prerequisite rather
than shipping a fabricated policy.
