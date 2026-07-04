# PROVIDER SMOKE — canlı e2e kanıtı
<!-- AUTO provider-smoke.ts · 2026-07-04T09:05:22.285Z · GO · regenerate: tsx orchestration/bin/provider-smoke.ts -->

## ✅ GO — pinned 5/5 yanıtlı · cloud-hit 4 · canlı-fallthrough 1 (429→zincir kanıtı) · sentetik-fallback PASS · terminal PASS

| Adım | Provider | Sonuç | Source | ms | Detay |
|---|---|---|---|--:|---|
| pinned | `groq` | ✓ | `cloud:groq` | 309 | kendi source'undan yanıt |
| pinned | `cerebras` | ✓ | `cloud:cerebras` | 493 | kendi source'undan yanıt |
| pinned | `zai` | ✓ | `fleet:mac` | 52308 | 429/kota → zincir 'fleet:mac'e düştü (canlı fallback kanıtı) |
| pinned | `sambanova` | ✓ | `cloud:sambanova` | 1206 | kendi source'undan yanıt |
| pinned | `github-models` | ✓ | `cloud:github-models` | 1933 | kendi source'undan yanıt |
| fallback | `vllm` | ✓ | `fleet:mac` | 10911 | keyless vllm → zincir 'fleet:mac'e düştü |
| terminal | `ollama-local` | ✓ | `ollama_local` | 43879 | lokal terminal yanıtladı |

_Kanıt-yasası: bu dosya GERÇEK :3000 koşusundan üretilir; unit test path-varsayımı yerine canlı e2e._
