# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-07-01T11:18:45.054Z · 10/10 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 10/10 adım başarılı · 2026-07-01T11:18:45.054Z
**Model seçimi (0-manuel-seçim):** pick qwen3-coder:480b-cloud
**Conductor sonraki-aksiyon:** karar tazelendi
**Readiness (0-manuel aktif mi):** ✅ GO — 0-manuel tam canlı + taze

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 90ms | pick qwen3-coder:480b-cloud |
| ✓ | `council` | 98ms | roster 14/14 seat · coverage 7/7 |
| ✓ | `fleet` | 71ms | Convergence: ⏳ in-progress |
| ✓ | `critic` | 90ms | completeness skor 70 · 5 açık |
| ✓ | `dod` | 92ms | DoD skor 26 · 18 yarım-iş |
| ✓ | `conduct` | 2797ms | karar tazelendi |
| ✓ | `fuse` | 2963ms | hazırlık 0/100 · top CRITICAL:red:integration/v17-core |
| ✓ | `status` | 3690ms | lane matrisi tazelendi |
| ✓ | `dispatch` | 10599ms | ▶ DISPATCH (inference-offload · ecypro-strict) — converged — inference-offload G |
| ✓ | `doctor` | 109ms | 0-manuel tam canlı + taze |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
