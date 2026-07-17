# RESEARCH-ORG.md — Academic Survey Behind the ollamas Management System

> The academic grounding pass for the ORG layer (ORGANIZATION.md). Ten canonical management/
> orchestration models were surveyed; each entry states the idea, the citation, the adoption decision
> (idea-only — no code is copied, $0 zero-dep, RISK-ORCH-005 license discipline), and the exact seam in
> this codebase it maps to. Selection criterion: **adopt only what lands on an existing seam.**
> Engine implementation of the adopted ideas: `bin/lib/organization.ts` (v2) + `bin/org-sandbox.ts`.

| # | Model | Decision | Maps to |
|---|-------|----------|---------|
| 1 | Contract Net Protocol | **ADOPT (idea)** | `assignRole` evidence-weighted bidding |
| 2 | Blackboard (Hearsay-II) | ADOPT (already latent) | brain ledger + `orchestration/*.json` artifacts |
| 3 | MAPE-K autonomic loop | **ADOPT (idea)** | sandbox round loop + ledger as Knowledge |
| 4 | OODA loop | ADOPT (already latent) | FSM tick observe→orient→decide→act |
| 5 | Erlang/OTP supervision | ADOPT (already latent) | joker failover + `escalatesTo` ladder |
| 6 | BDI agents | idea-only | duties/goal split in the brief (no deliberation engine) |
| 7 | Market-based allocation | idea-only | costRank ordering (no real currency/auction) |
| 8 | MetaGPT SOP roles | **ADOPT (idea)** | role+duties brief, structured outputs, assembly line |
| 9 | AutoGen conversable agents | idea-only | council debate already covers it |
| 10 | Mixture-of-Agents | idea-only | council quorum/adversarial seats already cover it |

## 1. Contract Net Protocol — Smith, 1980 — **ADOPT (idea)**
A manager announces a task; contractors bid; the manager awards the contract to the best bidder
(announce → bid → award). We adopt the *evaluation* half without message passing: every capable actor
implicitly "bids" its **historical evidence** — the Wilson lower bound of its success rate for the
task class, computed from the brain ledger — and `assignRole` awards within the cheapest cost band.
Thin evidence (n<3) bids neutral, so cost ordering still wins and the router never chases noise.
*Citation:* R.G. Smith, "The Contract Net Protocol: High-Level Communication and Control in a
Distributed Problem Solver," IEEE Trans. Computers C-29(12), 1980.
[reidgsmith.com PDF](https://www.reidgsmith.com/The_Contract_Net_Protocol_Dec-1980.pdf) ·
[Wikipedia](https://en.wikipedia.org/wiki/Contract_Net_Protocol)

## 2. Blackboard architecture — Erman et al. (Hearsay-II), 1980 — ADOPT (already latent)
Independent knowledge sources cooperate by reading/writing one shared, inspectable data structure;
a control element schedules them. Our blackboard is the brain ledger + the `orchestration/*.json`
artifact set: every actor's decision is a visible write, and the conductor is the control element.
Nothing to add in v2 beyond making recall a first-class dispatch input.
*Citation:* L.D. Erman, F. Hayes-Roth, V.R. Lesser, D.R. Reddy, "The Hearsay-II Speech-Understanding
System: Integrating Knowledge to Resolve Uncertainty," ACM Computing Surveys 12(2), 1980.
[UMass PDF](https://mas.cs.umass.edu/Documents/Erman_Hearsay80.pdf) ·
[Nii 1986 AI Magazine survey](https://onlinelibrary.wiley.com/doi/abs/10.1609/aimag.v7i2.537)

## 3. MAPE-K autonomic loop — Kephart & Chess, 2003 — **ADOPT (idea)**
Self-managing systems run Monitor → Analyze → Plan → Execute over a shared **K**nowledge base.
The sandbox harness (`org-sandbox.ts`) is a literal MAPE-K loop: each round Monitors synthetic
dispatch outcomes, Analyzes invariants, Plans the next wave (route-away, escalation), Executes it,
with the brain ledger as K. The production wiring mirrors it: consult-errors/recall = M+A, assign = P,
dispatch = E, ledger = K.
*Citation:* J.O. Kephart, D.M. Chess, "The Vision of Autonomic Computing," IEEE Computer 36(1), 2003.
[ScienceDirect overview](https://www.sciencedirect.com/topics/engineering/autonomic-computing) ·
[MAPE-K diagram](https://www.researchgate.net/figure/The-MAPE-K-loop-IBM-2006-Kephart-Chess-2003_fig6_228814973)

## 4. OODA loop — J. Boyd — ADOPT (already latent)
Observe → Orient → Decide → Act, faster than the adversary (here: faster than drift). The orchestra
FSM tick is already an OODA cycle; v2 strengthens **Orient** by injecting registry rules + recalled
lessons into every brief.

## 5. Erlang/OTP supervision trees — Armstrong — ADOPT (already latent)
Let it crash; a supervisor restarts the worker from known state. The joker failover
(`lib/joker.ts maybeFailover`) + persisted FSM state is exactly this; the org chart makes the
supervision edges explicit (`escalatesTo`), and v2's recurrence rule adds "restart *elsewhere*":
an actor that failed the same way twice is not restarted into the same task.

## 6. BDI agents — Rao & Georgeff, 1995 — idea-only
Belief-Desire-Intention deliberation is heavier than we need; we keep only the vocabulary split the
brief already uses: beliefs = ledger/recall facts, desires = task goal, intentions = duties. No
deliberation engine is built.

## 7. Market-based allocation — idea-only
Full auctions/currencies (e.g., Wellman's market-oriented programming) add coordination cost with no
$0 benefit at our scale; the fixed `costRank` bands + Wilson tie-break capture the useful gradient.

## 8. MetaGPT — Hong et al., 2023 — **ADOPT (idea)**
Encodes human Standardized Operating Procedures into role-based prompt sequences on an assembly line;
agents verify intermediate, structured outputs — that is our dispatch ritual: ORG_CHART roles+duties →
`buildDispatchPrompt` SOP brief → PROPOSE-only structured output (SEARCH/REPLACE) → gate verification.
v2 keeps outputs structured and adds the memory block to the SOP.
*Citation:* S. Hong et al., "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework,"
ICLR 2024. [arXiv:2308.00352](https://arxiv.org/abs/2308.00352)

## 9. AutoGen — Wu et al., 2023 — idea-only
Conversable, customizable agents coordinating via multi-agent conversation. Our council debate +
fleet agent-tabs already implement the useful subset; free-form agent-to-agent chat conflicts with
the blackboard law (no whispering).
*Citation:* Q. Wu et al., "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation."
[arXiv:2308.08155](https://arxiv.org/abs/2308.08155)

## 10. Mixture-of-Agents — Wang et al., 2024 — idea-only
Layered aggregation of multiple LLM outputs boosts quality. The council's quorum vote + adversarial
seats (`COUNCIL_ROSTER.json`) already provide the aggregation benefit at $0.
*Citation:* J. Wang et al., "Mixture-of-Agents Enhances Large Language Model Capabilities."
[arXiv:2406.04692](https://arxiv.org/abs/2406.04692)

## Statistical instrument — Wilson score lower bound
Ranking by the **lower bound** of the binomial confidence interval avoids over-ranking actors with
few samples (the standard fix for small-n success rates; same instrument the hierarchy policy gate
already assumes). v2 implements `wilsonLower(successes, n, z=1.96)` in `organization.ts` and feeds it
from `actorStats(ledger)`.
*Reference:* [Wilson score interval overview](https://insightful-data-lab.com/2025/08/20/wilson-score-interval/) ·
[Wilson lower bound for rating/ranking](https://medium.com/tech-that-works/wilson-lower-bound-score-and-bayesian-approximation-for-k-star-scale-rating-to-rate-products-c67ec6e30060)

## v3 addendum — machine-learning instruments for LEARNED authority

The v3 requirement — authorities and responsibilities *built like machine learning* — is grounded in
five instruments (all idea-only, implemented from the equations in `bin/lib/org-learn.ts`):

- **UCB1 multi-armed bandit** — Auer, Cesa-Bianchi & Fischer, "Finite-time Analysis of the Multiarmed
  Bandit Problem," Machine Learning 47:235-256, 2002. Score = mean + √(2·ln N / n); untried arm → ∞
  (optimistic cold-start). Guarantees logarithmic regret — the exploration/exploitation balance for
  picking an actor within the cheapest cost band. **ADOPT (idea)** → `ucb1()` + `selectActor(mode:
  "explore")`. [Springer](https://link.springer.com/article/10.1023/A:1013689704352) ·
  [PDF](https://homes.di.unimi.it/~cesabian/Pubblicazioni/ml-02.pdf)
- **Thompson sampling** — W.R. Thompson, Biometrika 25(3/4):285-294, 1933. Bayesian
  probability-of-best selection. idea-only: needs randomness, and determinism is a law of this
  codebase (injected clocks, no Math.random) — UCB1 gives deterministic exploration instead.
  [Biometrika](https://academic.oup.com/biomet/article-abstract/25/3-4/285/200862)
- **Reinforcement-learning reward loop** — Sutton & Barto, *Reinforcement Learning: An Introduction*,
  MIT Press. The dispatch ritual is the environment step; gated-apply green = reward, gate-red /
  recurrence = penalty; `trainPolicy` is the policy-improvement step run online after every episode.
  **ADOPT (idea)** — reward shaping only, no TD machinery.
- **Online learning** (Cesa-Bianchi & Lugosi, *Prediction, Learning, and Games*) — the policy is
  retrained from the full accumulated ledger every round (no separate train/test phase); the sandbox
  measures the resulting **learning curve** (per-round success + cumulative regret vs the best final
  rate) and requires late rounds ≥ early rounds. **ADOPT (idea)** → `learningCurve()`.
- **Curriculum learning** (Bengio et al., ICML 2009) — idea-only: the authority ladder
  observe → propose → apply-gated → trusted is a curriculum — an actor earns harder (more
  consequential) work only after proving the easier tier; demotion wins over promotion, and no
  learned level ever bypasses the deterministic gates (tsc+tests+revert-on-red stay mandatory).

## The synthesis (what v2 actually does)
**Contract-Net-lite bidding** (evidence-weighted `assignRole`) + **MAPE-K** (sandbox rounds over the
ledger-as-Knowledge) + **OTP restart-elsewhere** (recurrence → route-away) layered onto the already-
latent blackboard/OODA/supervision structure, with **MetaGPT-style SOP briefs** as the worker
interface. Everything else stays idea-only, cited, and out of the dependency graph.
