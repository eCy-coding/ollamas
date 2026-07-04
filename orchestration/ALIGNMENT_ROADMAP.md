# Constitutional Alignment Harness — Architecture & Roadmap

Make ollamas' local models behave more like Claude — **ethically**: adopt Anthropic's *publicly documented* HHH
(helpful / honest / harmless) and Constitutional-AI principles as a behavioral layer, and **measure** the
result. This is behavioral alignment, not model cloning.

## ⚖️ Ethical boundary (non-negotiable)
- **IS:** an Ollama Modelfile `SYSTEM` prompt authored from public principles + calibrated inference
  `PARAMETER`s + a deterministic conformance benchmark. Goal: make open models more helpful/honest/harmless.
- **IS NOT:** extracting/copying Anthropic weights, training data, or hidden system prompts (impossible +
  prohibited); fine-tuning local models on Claude/Fable API outputs (violates Anthropic ToS); impersonation.
  Variants are openly named `<base>-ca`; no output claims to *be* Claude. Any judge use is eval-only.

## Layers
| # | Layer | Module | Status |
|---|-------|--------|--------|
| L1 | Constitution (public-principle system prompt, versioned) | `bin/lib/claude-constitution.ts` | ✅ vO62 |
| L2 | Modelfile generator (`FROM`+`SYSTEM`+calibrated `PARAMETER`) | `bin/lib/modelfile.ts` | ✅ vO62 |
| L3 | Conformance rubric — hybrid: deterministic for objective dims + LLM-judge (local, eval-only) for semantic dims | `bin/lib/conformance.ts` + `bin/lib/judge.ts` | ✅ vO62 / vO64 |
| L4 | Zero-dep ollama client (temp=0 deterministic) | `bin/lib/ollama-client.ts` | ✅ vO62 |
| L5 | Suite runner + A/B report (base vs `-ca`, Δ) | `bin/align.ts` (`create`/`bench`/`list`) | ✅ vO62 |
| L6 | All-model sweep · conformance × tok/s selection (`optimize.ts` reuse) · regression gate · multi-run median · idempotent create · per-family params · usage resolver | `bin/align.ts all/resolve` + `bin/lib/align-sweep.ts` | ✅ vO63 |
| L7 | Runtime wire-in — server dispatches the regression-clean `-ca` variant (env-gated `OLLAMAS_ALIGN`, default-OFF) | `server/alignment.ts`; `server/providers.ts` ollama-local | ✅ vO65 |
| L8 | optional LLM-judge similarity (eval-only) · PARAMETER auto-tune · CI conformance gate · per-family constitution | — | ▶ vO66+ |

## Runtime wiring (vO65 — SHIPPED)
Set `OLLAMAS_ALIGN=1` (default OFF). When on, `server/providers.ts` maps a requested local model to its
regression-clean `-ca` variant via `server/alignment.ts resolveAlignedModel` (reads `ALIGNMENT_SELECTION.json`).
Three gates keep it safe: env-gated (off = pure no-op), regression-gated (only a variant that passed the
conformance check), existence-gated (a variant not installed falls back to the base — never dispatch a missing
tag). Live-proven: with the flag on, a `qwen3:8b` request dispatches `qwen3-8b-ca` (server log `[align] …`);
off, it dispatches `qwen3:8b` unchanged; `gpt-oss:20b` (regression-failed) stays on the base even when on.

## Roadmap (next versions)
- **vO65 — Server/fleet wire-in (make it automatic).** Consume `ALIGNMENT_SELECTION.json`; point ollamas'
  local-model calls at the winning `-ca` variant. Now safe because the benchmark is accurate (vO64 judge).
- **vO65.x — PARAMETER auto-tune + CI conformance gate.** Grid/anneal per model to maximize conformance; a gate
  so a constitution edit that lowers conformance is caught in CI.

### LLM-judge (vO64)
The semantic dimensions (honest hedge, false-premise correction, clear refusal, no over-refusal) are graded by a
LOCAL model (`--judge`, default `qwen3:8b`) answering YES/NO — a deterministic regex mis-scored a coherent
myth-correction as 0 and an off-topic tangent as 1. **Eval-only:** the judge only scores; it never trains a
model. No Anthropic API is used (M4-native). Objective dimensions (format, structure, sycophancy opener) stay
deterministic + fast. Judge ambiguity → deterministic fallback (never crashes).

## Usage (production)
```
tsx orchestration/bin/align.ts all                 # sweep ALL local models → ALIGNMENT_MATRIX.md + ALIGNMENT_SELECTION.json
tsx orchestration/bin/align.ts all --only qwen3:8b,gpt-oss:20b --runs 2   # subset, multi-run median
tsx orchestration/bin/align.ts create qwen3:8b     # build qwen3-8b-ca (idempotent; --force rebuilds)
tsx orchestration/bin/align.ts bench  qwen3:8b     # base vs aligned conformance → ALIGN_REPORT.md
tsx orchestration/bin/align.ts resolve qwen3:8b    # → qwen3-8b-ca (the variant ollamas should run)
tsx orchestration/bin/align.ts list                # aligned variants present
```
`ALIGNMENT_SELECTION.json` (mirrors `MODEL_SELECTION.json`) names the best aligned variant per hardware — the
production hand-off any consumer reads. Variants are directly runnable: `ollama run <base>-ca`.
