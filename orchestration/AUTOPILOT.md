# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T12:04:56.370Z · 3/5 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 3/5 adım başarılı · 2026-06-20T12:04:56.370Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)
**Staleness self-heal (0-manuel taze):** bench taze (fresh) → refresh gereksiz, atla

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `heal` | 21ms | bench taze (fresh) → refresh gereksiz, atla |
| ✓ | `benchprompt` | 109ms | model seçimi tazelendi |
| ✗ | `conduct` | 2499ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `status` | 7916ms | lane matrisi tazelendi |
| ✗ | `doctor` | 123ms | 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL) |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
