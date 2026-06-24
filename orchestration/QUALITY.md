# QUALITY — Tüm-Lane Sağlık Matrisi (vO9, 0-manuel)

> READ-ONLY `quality.ts` üretti · 2026-06-24T08:39:50.000Z · tsc CANLI + vitest .last-run cache.
> **🟢 0 green · 🔴 2 red · ⚪ 4 unknown** (toplam 6 lane).

| Lane | tsc | test (son koşu) | dirty | Durum |
|------|-----|------------------|-------|-------|
| `backend` | ✓ | failed ⏳bayat | 23△ | 🔴 RED |
| `verify/gwv2-all-lanes` | ✓ | unknown | 0△ | ⚪ unknown |
| `integration/v17-core` | ✗ (18) | unknown | 35△ | 🔴 RED |
| `fix/binary-architecture-calibration` | ✓ | unknown | 12△ | ⚪ unknown |
| `claude/loving-varahamihira-77d4a9` | — | unknown | 1△ | ⚪ unknown |
| `claude/naughty-kowalevski-2ccc35` | — | unknown | 540△ | ⚪ unknown |

## 🔴 RED lane'ler (conductor'a sinyal)
- **backend**: test failed
- **integration/v17-core**: tsc 18 hata

---
_vitest CANLI koşulmaz (cache tüketilir); tsc stateless read-only. Gap'i conductor fixlemez → lane sekmesine backlog (§3)._
