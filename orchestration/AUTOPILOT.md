# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T11:45:58.277Z · 2/4 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 2/4 adım başarılı · 2026-06-20T11:45:58.277Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 139ms | model seçimi tazelendi |
| ✗ | `conduct` | 2421ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `status` | 7491ms | lane matrisi tazelendi |
| ✗ | `doctor` | 118ms | 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL) |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
