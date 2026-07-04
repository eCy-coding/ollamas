# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-07-04T10:58:51.197Z · 15/16 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 15/16 adım başarılı · 2026-07-04T10:58:51.197Z
**Model seçimi (0-manuel-seçim):** pick qwen3-coder:30b · 114.6 tok/s
**Conductor sonraki-aksiyon:** Runtime: Apple Silicon → Ollama ≥0.19 MLX backend (num_gpu=999 tüm-Metal); warm-
**Readiness (0-manuel aktif mi):** ✅ GO — 0-manuel tam canlı + taze
**Staleness self-heal (0-manuel taze):** bench taze (fresh) → refresh gereksiz, atla

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `heal` | 122ms | bench taze (fresh) → refresh gereksiz, atla |
| ✓ | `benchprompt` | 812ms | pick qwen3-coder:30b · 114.6 tok/s |
| ✓ | `council` | 986ms | roster 14/14 seat · coverage 7/7 |
| ✓ | `fleet` | 388ms | Convergence: ✅ CONVERGED |
| ✗ | `quality` | 60042ms | spawnSync /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx ETIMEDO |
| ✓ | `critic` | 741ms | completeness skor 100 · 0 açık |
| ✓ | `dod` | 543ms | DoD skor 95 · 1 yarım-iş |
| ✓ | `conduct` | 14437ms | Runtime: Apple Silicon → Ollama ≥0.19 MLX backend (num_gpu=999 tüm-Metal); warm- |
| ✓ | `fuse` | 11272ms | hazırlık 78/100 · top COMPLETENESS:dod:uncommitted-green:47 dosya |
| ✓ | `think` | 359ms | think loop tazelendi (THINK.md) |
| ✓ | `next` | 400ms | next-task kuyruğu tazelendi · 0 safe-additive (P1) |
| ✓ | `tasklist` | 444ms | master task list tazelendi · kabul 14/14 |
| ✓ | `claude` | 318ms | ⏭ SKIP — 24h bütçe dolu (6/6 spawn) |
| ✓ | `status` | 22765ms | lane matrisi tazelendi |
| ✓ | `dispatch` | 10950ms | ▶ DISPATCH (inference-offload · ecypro-strict) — converged — inference-offload G |
| ✓ | `doctor` | 331ms | 0-manuel tam canlı + taze |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
