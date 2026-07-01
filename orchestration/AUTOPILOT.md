# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-07-01T09:58:12.408Z · 9/9 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 9/9 adım başarılı · 2026-07-01T09:58:12.408Z
**Model seçimi (0-manuel-seçim):** pick qwen3-coder:480b-cloud
**Conductor sonraki-aksiyon:** karar tazelendi
**Readiness (0-manuel aktif mi):** ✅ GO — 0-manuel tam canlı + taze

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 95ms | pick qwen3-coder:480b-cloud |
| ✓ | `council` | 120ms | roster 14/14 seat · coverage 7/7 |
| ✓ | `critic` | 94ms | completeness skor 76 · 4 açık |
| ✓ | `dod` | 116ms | DoD skor 28 · 16 yarım-iş |
| ✓ | `conduct` | 2972ms | karar tazelendi |
| ✓ | `fuse` | 2893ms | hazırlık 0/100 · top CRITICAL:red:integration/v17-core |
| ✓ | `status` | 3853ms | lane matrisi tazelendi |
| ✓ | `dispatch` | 10588ms | ▶ DISPATCH (inference-offload · ecypro-strict) — converged — inference-offload G |
| ✓ | `doctor` | 93ms | 0-manuel tam canlı + taze |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
