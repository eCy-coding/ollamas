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
| L3 | Conformance rubric + curated probe suite (deterministic, 0..1) | `bin/lib/conformance.ts` | ✅ vO62 |
| L4 | Zero-dep ollama client (temp=0 deterministic) | `bin/lib/ollama-client.ts` | ✅ vO62 |
| L5 | Suite runner + A/B report (base vs `-ca`, Δ) | `bin/align.ts` (`create`/`bench`/`list`) | ✅ vO62 |
| L6 | Best-variant selection + routing wire-in (`optimize.ts` reuse) | — | ▶ vO63 |
| L7 | All-model sweep · optional LLM-judge similarity (eval-only) · per-model PARAMETER auto-tune · CI conformance gate · multi-run stability | — | ▶ vO63+ |

## Roadmap (next versions)
- **vO63 — All-model sweep + selection.** Run `create`+`bench` across the M4 inventory (qwen3:8b, qwen3:30b-a3b,
  qwen3-coder:30b, deepseek-r1:32b, gpt-oss:20b, phi4). Rank aligned variants by conformance × tok/s (reuse
  `optimize.ts scoreModel` with a conformance gate). Emit `ALIGNMENT_SELECTION.json` = best aligned variant per role.
- **vO63.x — Routing wire-in.** Register the winning `-ca` variants so the server/fleet use the aligned variant
  where a local model is called (per-request `messages[0]` system already supported — `server/providers.ts`).
- **vO64 — Judge-based similarity (eval-only).** Optionally score responses with Claude/Fable as an LLM judge for
  fidelity, strictly for evaluation (never training). Keep the deterministic rubric as the fast default.
- **vO64.x — PARAMETER auto-tune.** Grid/anneal temperature/top_p/repeat_penalty per model to maximize conformance.
- **vO65 — CI conformance gate + multi-run stability.** N-run median per probe (variance-robust), regression gate
  in the harness so a constitution edit that lowers conformance is caught.

## Usage
```
tsx orchestration/bin/align.ts create qwen3:8b     # build qwen3-8b-ca
tsx orchestration/bin/align.ts bench  qwen3:8b     # base vs aligned conformance → ALIGN_REPORT.md
tsx orchestration/bin/align.ts list                # aligned variants present
```
