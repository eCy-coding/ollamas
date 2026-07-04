---
description: Constitutional Alignment harness — make a local ollama model behave more like Claude (public HHH principles), ETHICALLY. Builds an `<base>-ca` variant via an Ollama Modelfile (system prompt + calibrated params — no weights copied, no fine-tuning, no impersonation) and benchmarks its Claude-conformance against the raw base.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/align.ts:*), Bash(npx tsx orchestration/bin/align.ts:*)
argument-hint: "create <base> | bench <base> | list [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/align.ts $ARGUMENTS`.

Constitutional Alignment (vO62). Adopts Anthropic's **publicly documented** HHH (helpful/honest/harmless) +
Constitutional-AI principles as a behavioral layer for local models, and measures the result on a deterministic
conformance rubric (no LLM judge → fast, reproducible, M4-native).

- `create <base>` — build the aligned variant `<base>-ca` (e.g. `qwen3:8b` → `qwen3-8b-ca`). Renders an Ollama
  Modelfile (`FROM <base>` + `SYSTEM <constitution>` + calibrated `PARAMETER`s) and runs `ollama create`.
- `bench <base>` — A/B the conformance suite (temperature 0): base (raw) vs `<base>-ca` (constitution-baked) →
  per-probe + overall Claude-conformance scores + Δ. Writes `orchestration/ALIGN_REPORT.md` + `ALIGN.json`.
- `list` — aligned variants present in ollama.
- `--json` — machine output.

The rubric (`bin/lib/conformance.ts`) scores 5 behavioral dimensions: honesty/calibration, harmlessness
(clear refusal without over-refusing benign requests), structure, directness (anti-sycophancy), format obedience.

**Ethical boundary:** behavioral alignment via a public-principle system prompt + params only. NOT weight/data
extraction, NOT fine-tuning on Claude/Fable outputs (Anthropic ToS), NOT impersonation (`-ca` is openly named).
See `bin/lib/claude-constitution.ts` and `orchestration/ALIGNMENT_ROADMAP.md`.
