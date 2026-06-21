# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)

> READ-ONLY `fuse.ts`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.
> **Proje hazırlık: 66/100** · 14 gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.

## 🎯 EN KRİTİK GEREKSİNİM
**Criticality:** COMPLETENESS · **Kaynak:** conduct+dod

**Gereksinim:** adopt-gate kısmen tamam — eksik eş-zamanlı: test

**Eylem:** adopt-gate için test aynı anda tamamla

## Tüm gereksinimler (critical-first)
### COMPLETENESS (10)
- **dod:concurrent-task:adopt-gate** [conduct+dod]: adopt-gate kısmen tamam — eksik eş-zamanlı: test
  → adopt-gate için test aynı anda tamamla
- **dod:concurrent-task:claim** [conduct+dod]: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
  → claim için test + SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:driftguard** [conduct+dod]: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
  → driftguard için SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:ops** [conduct+dod]: ops kısmen tamam — eksik eş-zamanlı: roadmap-row
  → ops için roadmap-row aynı anda tamamla
- **dod:concurrent-task:scan** [conduct+dod]: scan kısmen tamam — eksik eş-zamanlı: test
  → scan için test aynı anda tamamla
- **dod:concurrent-task:status** [conduct+dod]: status kısmen tamam — eksik eş-zamanlı: test
  → status için test aynı anda tamamla
- **dod:uncommitted-green:28 dosya** [conduct+dod]: Commit'siz yeşil iş (built-not-shipped): ADOPTIONS_ORCHESTRATION.md, AUTOPILOT.md, BENCH.json, BENCH.md, CONDUCTOR.md, CRITIC.json…
  → yeşil parçayı commit'le (per-file git add + conventional)
- **red:backend** [conduct+conduct(stale)]: test failed — testTs bayat, güvenilmez (phantom-critical önlendi)
  → backend: testi taze koş; gerçekten kırıksa CRITICAL olur
- **stale:quality** [quality(stale)]: quality verisi 74 dk bayat — füzyondan ÇIKARILDI (phantom-critical önlendi)
  → quality.ts yeniden koş (taze quality üret)
- **dod:roadmap-coherence:ops** [conduct+dod]: ops aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
  → ops'yi ilgili vO satırına ekle

### ROADMAP (4)
- **next:cli** [conduct]: cli sıradaki: v16 TUI v2 / agent watch top multi pane (request
  → cli: "sıradaki versiyonu planla cli"
- **next:deploy** [conduct]: deploy sıradaki: ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
  → deploy: "sıradaki versiyonu planla deploy"
- **next:scripts** [conduct]: scripts sıradaki: Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 
  → scripts: "sıradaki versiyonu planla scripts"
- **next:ukp** [conduct]: ukp sıradaki: ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
  → ukp: "sıradaki versiyonu planla ukp"

## Kaynak tazelik (eşik 60dk)
| Kaynak | ts | Durum |
|---|---|---|
| conduct | (canlı exec) | ✓ taze |
| critic | 2026-06-20T13:07:44.760Z | ✓ taze |
| dod | 2026-06-20T13:07:44.901Z | ✓ taze |
| quality | 2026-06-20T11:53:27.489Z | ⚠️ BAYAT (füzyon-dışı) |

## Optimal working-prompt (en-kritik eyleme)
_(bench verisi yok)_

<next-action>
adopt-gate için test aynı anda tamamla
</next-action>

---
_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._
