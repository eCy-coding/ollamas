---
description: Constitutional Alignment harness — make a local ollama model behave more like Claude (public HHH principles), ETHICALLY. Builds an `<base>-ca` variant via an Ollama Modelfile (system prompt + calibrated params — no weights copied, no fine-tuning, no impersonation) and benchmarks its Claude-conformance against the raw base.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/align.ts:*), Bash(npx tsx orchestration/bin/align.ts:*)
argument-hint: "all [--runs N] [--only a,b] | create <base> | bench <base> [--runs N] | resolve <base> | list"
---
Run `./node_modules/.bin/tsx orchestration/bin/align.ts $ARGUMENTS`.

Constitutional Alignment (vO62/63). Adopts Anthropic's **publicly documented** HHH (helpful/honest/harmless) +
Constitutional-AI principles as a behavioral layer for local models, and measures the result on a deterministic
conformance rubric (no LLM judge → fast, reproducible, M4-native).

- `all [--runs N] [--only a,b]` — **sweep every alignable local model**: create (idempotent) + bench + rank by
  conformance × tok/s (`optimize.ts`) + regression-check → `orchestration/ALIGNMENT_MATRIX.md` +
  `ALIGNMENT_SELECTION.json` (the production selection, mirrors `MODEL_SELECTION.json`). `--only` limits the set.
- `create <base>` — build the aligned variant `<base>-ca` (e.g. `qwen3:8b` → `qwen3-8b-ca`). Renders an Ollama
  Modelfile (`FROM <base>` + `SYSTEM <constitution>` + family-calibrated `PARAMETER`s). Idempotent; `--force` rebuilds.
- `bench <base> [--runs N]` — A/B the conformance suite (temperature 0, median over N runs): base (raw) vs
  `<base>-ca` → per-probe + overall conformance + Δ. Writes `orchestration/ALIGN_REPORT.md` + `ALIGN.json`.
- `resolve <base>` — print the aligned variant tag ollamas should run (the usage resolver).
- `list` — aligned variants present in ollama.
- `--judge <model>` — LLM judge for the semantic dimensions (default `qwen3:8b`, env `ALIGN_JUDGE`; `none` = deterministic-only).
- `--json` — machine output.

**Hybrid scoring (vO64):** objective dimensions (format, structure, sycophancy opener) use the fast deterministic
rubric; semantic ones (honest hedge, false-premise correction, clear refusal, no over-refusal) are graded YES/NO
by a **local** judge model — a regex mis-scored a coherent myth-correction as 0 and an off-topic tangent as 1.
Eval-only (the judge never trains anything); no Anthropic API; judge ambiguity → deterministic fallback.

Proven live (vO63): cross-family sweep (qwen3 / gpt-oss / phi4) — variants build + score across model families.
On a weak base the alignment lifts conformance dramatically (qwen3:4b 26%→93%); on an already-aligned base it holds
parity (qwen3:8b 100%→100%). Variants are directly runnable: `ollama run <base>-ca`.

The rubric (`bin/lib/conformance.ts`) scores 5 behavioral dimensions: honesty/calibration, harmlessness
(clear refusal without over-refusing benign requests), structure, directness (anti-sycophancy), format obedience.

**Ethical boundary:** behavioral alignment via a public-principle system prompt + params only. NOT weight/data
extraction, NOT fine-tuning on Claude/Fable outputs (Anthropic ToS), NOT impersonation (`-ca` is openly named).
See `bin/lib/claude-constitution.ts` and `orchestration/ALIGNMENT_ROADMAP.md`.
