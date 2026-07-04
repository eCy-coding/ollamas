# Alignment conformance matrix — all local models

| Base | Aligned | base | aligned | Δ | tok/s |
|---|---|---|---|---|---|
| qwen3:8b | qwen3-8b-ca | 100% | 100% | +0% | 28 |
| gpt-oss:20b | gpt-oss-20b-ca | 68% | 68% | +0% | 36 |
| phi4:latest | phi4-latest-ca | 91% | 79% | -13% | 18 |

_Ethical: behavioral alignment via a public-principle system prompt + calibrated params. No weights/data cloned, no fine-tuning, no impersonation._

**Selected (conformance × tok/s):** qwen3-8b-ca  ·  conformance 100%  ·  28 tok/s  ·  score 0.975

### Regression check
- qwen3-8b-ca: ✅ parity
- gpt-oss-20b-ca: ❌ conformance 68% < floor 70%
- phi4-latest-ca: ❌ regressed vs base (79% < 91%)
