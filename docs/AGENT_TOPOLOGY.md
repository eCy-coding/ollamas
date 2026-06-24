# Agent Topology — how many agents, which roles (2026, evidence-based)

Question: "if each agent does one job, how many agents does a task need?" (reader, analyzer, coder, bug-fixer, code-searcher…). Answer below combines **2026 industry/research data** with **ollamas' own measured constraints**.

## TL;DR
- **Not "one persistent agent per micro-task."** That maximizes coordination cost + tokens (~15× a chat) and fragments context — the failure mode 2026 vendors explicitly warn against.
- **Canonical set = 5 roles:** 1 **Orchestrator** + 4 ephemeral workers (**Explorer**, **Analyzer/Planner**, **Implementor**, **Reviewer**).
- **Concurrency ceiling = 3–4 agents at once** (coordination overhead collapses marginal gain past this).
- **ollamas LOCAL (single GPU) = 1 effective worker at a time** — local parallel SERIALIZES (measured), so sequence workers or offload parallelism to cloud.

## 1. The 2026 consensus (5 vendors converged)
The default 2026 pattern: **one orchestrator owns the full context, spawns ephemeral ISOLATED subagents that return COMPRESSED summaries, with NO peer-to-peer agent chatter.** Cognition ("Don't Build Multi-Agents", Jun 2025 → "Devin can Manage Devins", Mar 2026), Anthropic, OpenAI, AutoGen, LangChain all landed here.
- **Anthropic orchestrator-worker:** lead plans → **3–5 specialized subagents in parallel** → separate synthesis/citation pass. Beat single-agent by **+90%** on research, at **~15× chat tokens** (vs ~4× for a single agent). NOT for tasks needing shared context or many inter-agent dependencies.
- **Cognition's caution:** parallel agents acting on conflicting assumptions = fragile. Reliability comes from **context engineering** (every actor sees the collective decisions), not more agents.
- **Scaling research:** homogeneous agents show **steep diminishing returns** — accuracy gain per added agent collapses toward zero; practical team size is **3–4** unless agents are genuinely diverse or the task cleanly decomposes.

## 2. Role count — collapse the micro-tasks to 5
"One agent per verb" over-decomposes. Merge by **capability + read/write boundary**, keep separate only where independence has value:

| # | Role | Single responsibility | R/W | Why a distinct role |
|---|------|----------------------|-----|---------------------|
| 0 | **Orchestrator** | Decompose, dispatch, synthesize; owns full context | — | The 2026 consensus core; the only one with the whole picture |
| 1 | **Explorer** (reader **+** searcher) | Find code/docs/similar patterns, return excerpts | read | "reader" and "searcher" are the SAME capability (read-only retrieval) → splitting adds coordination cost for zero gain |
| 2 | **Analyzer / Planner** | Root-cause, design, sequence the fix | read | Reasoning is a different model tier than coding; separating planning from doing improves both |
| 3 | **Implementor** (coder **+** bug-fixer) | Write/modify code | write | "bug-fixer" = Implementor re-invoked with Reviewer findings — same capability, NOT a new agent |
| 4 | **Reviewer / Verifier** | Adversarially check, find bugs, run tests | read+exec | **implementer ≠ verifier** — must be a *separate* pass or it rubber-stamps its own work |

So the user's 5–6 listed jobs → **5 roles** (reader+searcher merge, coder+bug-fixer merge, reviewer stays independent).

## 3. How many AT ONCE — by task type (the real "number")
Concurrency ≠ role count. Most pipelines are **sequential** (coder needs the explorer's output). Parallel fan-out only pays when subtasks are independent.

| Task | Roles used | Concurrent | Note |
|------|-----------|-----------|------|
| 1-file fix / typo | Orchestrator (+1 Explorer) | **1** | Multi-agent = pure overhead (15× tokens, slower). Single agent wins. |
| Feature / bug fix | Orch → Explorer → Implementor → Reviewer | **1–2** | Mostly sequential pipeline; reviewer is the only must-separate step |
| Research / audit / wide refactor | Orch + **3–5 parallel** Explorers → Analyzer → Reviewer | **3–4 (cap)** | The only case parallel agents earn their 15× cost (Anthropic +90%) |

**Rule:** start at 1; add an agent only when a subtask is (a) independent and (b) high-value. Hard cap concurrent at **3–4**.

## 4. ollamas-specific — MEASURED, not assumed
- **Single GPU → local parallel gives NO wall-clock speedup** (measured 2026-06-24, qwen3:8b, `OLLAMA_NUM_PARALLEL` unset, real agent dispatches):

  | run | wall-clock | vs sequential |
  |-----|-----------|---------------|
  | 1 task (warm) | 11s | baseline |
  | 2 parallel | 17s | ≈ 2 sequential (~15s) — no gain |
  | **4 parallel** | **31s** | **= 4 sequential (31s) — identical** |

  Parallel-4 equals sequential-4 (31s = 31s): the GPU serializes decode; batch throughput is eaten by per-request overhead at this size. ⇒ **Locally, effective concurrency = 1 — sequence workers; for true parallelism offload to a cloud model / separate hardware** (matches 2026 finding: parallel pays only with complementary hardware, e.g. NPU+GPU ~1.42×, not same GPU). *Method note: a single quick run first showed a spurious 2.7× "speedup" = cold-load asymmetry noise; the repeated/warmed run corrected it — never trust one measurement.*
- **Benchmark (this machine, agent-bench, real tool-output scored):**
  - Implementor (coding) → **qwen3:8b** (correct, 7–16s) — fastest correct.
  - Monitor/ops → **no small model passed** (8b/4b time out at 120s; only qwen3-coder:30b passed, 59s) ⇒ **don't use an LLM agent for ops/monitoring — use the deterministic `scripts/system-monitor.mjs`** (`ops.mjs` already does monitor-first, "silence = success"). Validated.
  - **Avoid qwen3:4b for real tasks** — produced a demo-suspected (confident-but-fake) result.
- **ollamas 3-tier already matches the consensus:** Tier-1 Claude Code = Orchestrator (full context) → Tier-2 `agent-fleet` (fans out) → Tier-3 `agent-dispatch` workers (isolated, structured report back). Keep it.

## 5. Recommendation
- **Roles to define: 5** (Orchestrator, Explorer, Analyzer, Implementor, Reviewer).
- **Concurrent cap: 3–4** (cloud); **1 effective locally** (GPU-bound → sequence, or burst to cloud).
- **Route by role:** coding→qwen3:8b · planning/analysis→a reasoning tier (cloud) · ops/monitor→deterministic script (no LLM) · never qwen3:4b for graded work.
- **Default to 1 agent**; escalate to the 3–4 parallel fan-out ONLY for research/audit/wide-independent work — that is the only place the ~15× token cost returns value.

## Sources
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Cognition — Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)
- [Multi-Agent in Production 2026: 3 Patterns That Survived](https://niteagent.com/blog/multi-agent-production-2026/)
- [Understanding Agent Scaling in LLM Multi-Agent Systems via Diversity (arXiv)](https://arxiv.org/pdf/2602.03794)
- [Multi-Agent Systems Explained: 2026 Patterns](https://decodethefuture.org/en/multi-agent-systems-explained/)
- [Best AI Model for Coding Agents 2026: Routing Guide — Augment](https://www.augmentcode.com/guides/ai-model-routing-guide)
- ollamas measured: `scripts/agent-bench.mjs` routing run (2026-06-24) + single-GPU serialization finding (memory `ollamas-runtime-findings`).
