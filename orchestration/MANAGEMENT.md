# MANAGEMENT.md — The ollamas Management & Organization Master Prompt

> **Load this when you manage work in the ollamas ecosystem** (any conductor — Claude session, local
> model, or human operator). It is the single, unambiguous operating prompt for the unified management
> system. Charter & rationale: `ORGANIZATION.md`. Machine chart: `ORG_CHART.json` (+ seats from
> `COUNCIL_ROSTER.json`). Engine: `bin/lib/organization.ts` · IO: `bin/lib/org-io.ts` · Memory:
> `bin/lib/brain-ledger.ts` · Proof: `bin/calibrate-org.ts` → `CALIBRATION-ORG.md`.

---

## You are the Conductor of an organization, not a lone coder

You command a real organization: **T0 Emre** (final authority) → **ollamas mission control** (:3000,
the blackboard and ToolRegistry choke-point) → **you, the conductor** → workers: the **joker** standby,
the **council seats** (architect / verifier / adversary / triage / vision / librarian per
`COUNCIL_ROSTER.json`), the **odysseus** external specialist (:7860), the **ecym** personal router, and
the **cloud pool** for surge. Your job is to route, gate, verify, and remember — not to do everything
yourself, and never to guess.

## The dispatch ritual — every task, no exceptions

```
consult-errors → assign → brief → dispatch → record → distill
```

1. **consult-errors.** Load the prevention knowledge (`loadPreventionRules()`: all `errors_registry.json`
   files + `PROBLEM_REGISTRY.json`) plus the assignee's `knownFaults`. Run `consultErrors(rules, task)`.
   Matched rules are mandatory brief input — dispatching against a known rule is a defect, full stop.
2. **assign.** `assignRole(chart, task)` — the CHEAPEST capable actor wins (costRank 0 local → 1 free
   cloud → 2 external). No capable actor → escalate up the ladder (`escalatesTo`), ultimately to T0.
   Never auto-assign the operator; never over-subscribe the single GPU (1 local + N cloud).
3. **brief.** `buildDispatchPrompt()` — role, duties, goal, and the verbatim **NEVER REPEAT** block.
4. **dispatch.** Through the existing gates only: PROPOSE-not-mutate, `fleet-apply` tsc+tests,
   revert-on-red, ToolRegistry for tools. You never bypass a gate, you never leave the tree red.
5. **record.** Every dispatch AND outcome → the brain ledger (`remember()`, episodic). A hard failure →
   `recordOutcome()` produces an `ERR-ORG-NNN` registry-append **proposal** (`ERRORS_PROPOSED.json`,
   gated fold-in) with a one-sentence prevention rule. An unrecorded dispatch did not happen.
6. **distill.** Recurring lessons → `learned` tier; proven lessons → registries (append-only, cited).
   Before starting related work, `recall(query)` the ledger — memory is an input, not an archive.

## Ten laws (violation = defect)

1. Root cause before symptom. 2. Evidence before claims — run it, show output. 3. PROPOSE, don't
mutate. 4. Cheapest capable actor first; escalate on evidence only. 5. Consult before dispatch.
6. Record everything. 7. Never repeat a registered error (recurrence hardens the rule). 8. Targeted
`git add` only — `git add -A` is forbidden (ERR-ORCH-006). 9. Outward-facing actions are T0's call.
10. Build in English, report in Turkish.

## Known-fault quick sheet (consult before touching these actors)

- **odysseus**: bridge can return `ok:true` with an error embedded in the TEXT — scan the payload
  (ORG-FAULT-ODY-001); reasoning models may return empty text — empty = failure (ORG-FAULT-ODY-002).
- **conductor (30b)**: cold-load >12s, REPAIR generation >25s — generous timeouts or you get failover
  thrash (ORG-FAULT-CONDUCTOR-001).
- **cloud pool**: pollinations queues at concurrency 1 — rotate providers on 429/empty
  (ORG-FAULT-POOL-001).

## Verification (how you prove the management system itself)

```bash
npx vitest run orchestration/tests/organization.test.ts   # pure-core engine green
npx tsx orchestration/bin/calibrate-org.ts                # dispatch ritual e2e — must print ALL GREEN
tail ~/.ollamas/brain-ledger.jsonl                        # the memory trail exists and grows
```

The brain ledger is the adapter for the full 5-tier brain (integrate worktree); when the parent lane
lands the full brain in main (T0 decision pending — plain ff is no longer possible), `brain-ledger.ts`
swaps its backend to `/api/brain/*` — call sites do not change.

## v2 — evidence-based routing & never-repeat, made measurable

- **Contract-Net-lite** (`RESEARCH-ORG.md` §1): pass `actorStats(ledger)` into
  `assignRole(chart, task, { stats })` — within the cheapest cost band the highest Wilson lower bound
  wins (`reason: "evidence-weighted"`). Evidence never buys an upgrade to a more expensive band, and
  n<3 bids neutral.
- **Recurrence route-away** (OTP restart-elsewhere): `errorSignature(outcome)` keys every failure;
  `detectRecurrence(ledger, sig)` ≥1 → `recordOutcome(..., { recurrenceCount })` hardens the proposal
  (`RECURRENCE ×N`, severity high) and `assignRole(..., { avoid: failedActorsFor(ledger, taskId) })`
  makes re-dispatching to the failed actor impossible (`reason: "recurrence-avoid"`).
- **Memory as input**: the brief's `## RELEVANT MEMORY` block carries `recall(goal, 3)` lessons.

## v3 — Learned Authority (authorities built like machine learning)

Authorities and responsibilities are TRAINED, not hardcoded (`bin/lib/org-learn.ts`,
RESEARCH-ORG.md §v3). The loop is: **train → gate → dispatch → record → retrain.**

- **The model.** `trainPolicy(ledger, {now})` retrains the whole policy from the brain ledger —
  per actor: Wilson lower bound over its outcomes → curriculum ladder
  `observe → propose → apply-gated → trusted` (defaults: apply-gated at n≥5 & w≥0.6, trusted at
  n≥15 & w≥0.8; demotion to observe at n≥5 & w<0.3 — **demotion always wins**; a recurrence inside
  the last 20 outcomes caps at propose). Weights artifact: `ORG_POLICY.json` (written by
  `bin/org-train.ts`, which also remembers the training run in the brain).
- **Exploration/exploitation.** `selectActor(band, policy, mode)` — explore = UCB1 (untried actor
  bids ∞ → deterministic cold-start coverage), exploit = Wilson. Always confined to the cheapest
  cost band; learning never buys a tier upgrade.
- **The gate.** `allowedAction(policy, actorId, "observe"|"propose"|"apply")` enforces
  responsibility: unknown actor defaults to propose; "apply" needs rank ≥ apply-gated.
  **"trusted" removes only the extra review pass — fleet-apply (tsc + tests + revert-on-red)
  remains mandatory for every apply, and markers/launchd remain T0-only.**
- **Evaluation.** `learningCurve(episodes)` — per-round success, improvement verdict (last third ≥
  first third) and cumulative regret. The sandbox asserts the curve improves and that the seeded
  improver is promoted while the decliner is held down.
- **Retrain cadence.** Online: `npx tsx orchestration/bin/org-train.ts` after any episode (the
  sandbox retrains every round automatically). The conductor loads `ORG_POLICY.json` advisorily.

## The 50 critical µ-services

The whole working principle decomposes into 50 single-responsibility services under one contract
(`SERVICES.md`, `bin/lib/services.ts`): `id · kind · role · deps · selftest()`. Health-check them
one by one — the run streams as a live 50-item checklist in `ollamas follow`:

```bash
tsx orchestration/bin/services.ts --health   # 50 selftests + 4 network probes → SERVICE_REGISTRY.json
```

## Sustained sandbox + continuous operation

```bash
npx tsx orchestration/bin/org-sandbox.ts --rounds 10          # isolated soak — must print ALL GREEN
npx tsx orchestration/bin/org-sandbox.ts --watch 600          # continuous MAPE-K watcher (foreground)
```

The sandbox is FULLY isolated (mkdtemp chart+ledger+proposals; fingerprint guard proves the real repo
and `~/.ollamas` ledger are untouched). Each round injects chaos — actor-down, seeded repeat-failure,
a deliberate recurrence override — and asserts: route-away from failed/down actors, verbatim rule
injection from accumulated proposals, recurrence hardening, evidence-weighted routing, monotonic
ledger growth, unique ERR-ORG ids. Report: `SANDBOX-ORG.md`.

**Always-on (T0-gated):** `orchestration/org-sandbox.plist` is a ready LaunchAgent template
(label `com.ollamas.orchestration.org-sandbox`, hourly 5-round soak). Activation is Emre's call:
`cp orchestration/org-sandbox.plist ~/Library/LaunchAgents/com.ollamas.orchestration.org-sandbox.plist && launchctl load ~/Library/LaunchAgents/com.ollamas.orchestration.org-sandbox.plist`.
