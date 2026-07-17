# SANDBOX-ORG — sustained management-layer soak (isolated, stub runner, no GPU)

- rounds: **10** · wave: 6 tasks/round · chaos: vision-down on even rounds, seeded repeat-failures, recurrence override
- violations: **0** (must be 0)

**VERDICT: ALL GREEN ✅ (10-round clean streak = sustainability proof)**

| round | down | dispatches | failures | proposals | ledger | violations |
|-------|------|------------|----------|-----------|--------|------------|
| 1 | — | 6 | 2 | 2 | 22 | — |
| 2 | vision | 6 | 2 | 2 | 34 | — |
| 3 | — | 6 | 0 | 0 | 46 | — |
| 4 | vision | 6 | 0 | 0 | 58 | — |
| 5 | — | 6 | 0 | 0 | 70 | — |
| 6 | vision | 6 | 0 | 0 | 82 | — |
| 7 | — | 6 | 0 | 0 | 94 | — |
| 8 | vision | 6 | 0 | 0 | 106 | — |
| 9 | — | 6 | 0 | 0 | 118 | — |
| 10 | vision | 6 | 0 | 0 | 130 | — |

> Proven per round: route-away from failed/down actors, prevention-rule injection verbatim from
> the accumulated proposals, recurrence detection + hardening, evidence-weighted routing, ledger
> monotonic growth, unique ERR-ORG ids, and REAL repo/ledger isolation (fingerprint-checked).
> Rerun: `tsx orchestration/bin/org-sandbox.ts --rounds 10`. Continuous: `--watch 600`.
