# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)

> READ-ONLY `fuse.ts`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.
> **Proje hazırlık: 40/100** · 14 gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.

## 🎯 EN KRİTİK GEREKSİNİM
**Criticality:** CRITICAL · **Kaynak:** conduct

**Gereksinim:** tsc 18 hata

**Eylem:** integration/v17-core: kırık gate/testi düzelt (her şeyi bloklar)

## Tüm gereksinimler (critical-first)
### CRITICAL (1)
- **red:integration/v17-core** [conduct]: tsc 18 hata
  → integration/v17-core: kırık gate/testi düzelt (her şeyi bloklar)

### COMPLETENESS (9)
- **crit:done-no-evidence:vO16** [conduct+critic]: vO16 (E2E Integration Run, Diagnose, Repair & Publish lane'ler int) DONE ama eşleşen araç/artefakt yok
  → vO16 kanıtını doğrula ya da DONE'ı geri al
- **dod:concurrent-task:adopt-gate** [conduct+dod]: adopt-gate kısmen tamam — eksik eş-zamanlı: test
  → adopt-gate için test aynı anda tamamla
- **dod:concurrent-task:claim** [conduct+dod]: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
  → claim için test + SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:driftguard** [conduct+dod]: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
  → driftguard için SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:scan** [conduct+dod]: scan kısmen tamam — eksik eş-zamanlı: test
  → scan için test aynı anda tamamla
- **dod:concurrent-task:status** [conduct+dod]: status kısmen tamam — eksik eş-zamanlı: test
  → status için test aynı anda tamamla
- **dod:uncommitted-green:20 dosya** [conduct+dod]: Commit'siz yeşil iş (built-not-shipped): AUTOPILOT.md, BENCH.json, BENCH.md, CONDUCTOR.md, CRITIC.json, CRITIC.md…
  → yeşil parçayı commit'le (per-file git add + conventional)
- **red:backend** [conduct(stale)]: test failed — testTs bayat, güvenilmez (phantom-critical önlendi)
  → backend: testi taze koş; gerçekten kırıksa CRITICAL olur
- **stale:quality** [quality(stale)]: quality verisi 124 dk bayat — füzyondan ÇIKARILDI (phantom-critical önlendi)
  → quality.ts yeniden koş (taze quality üret)

### STALE (4)
- **stale:claude/loving-varahamihira-77d4a9** [conduct]: claude/loving-varahamihira-77d4a9 132s commitsiz (idle)
  → claude/loving-varahamihira-77d4a9: sıradaki versiyonu planla (durağan)
- **stale:claude/naughty-kowalevski-2ccc35** [conduct]: claude/naughty-kowalevski-2ccc35 87s commitsiz (idle)
  → claude/naughty-kowalevski-2ccc35: sıradaki versiyonu planla (durağan)
- **stale:fix/binary-architecture-calibration** [conduct]: fix/binary-architecture-calibration 74s commitsiz (idle)
  → fix/binary-architecture-calibration: sıradaki versiyonu planla (durağan)
- **stale:verify/gwv2-all-lanes** [conduct]: verify/gwv2-all-lanes 86s commitsiz (idle)
  → verify/gwv2-all-lanes: sıradaki versiyonu planla (durağan)

## Kaynak tazelik (eşik 60dk)
| Kaynak | ts | Durum |
|---|---|---|
| conduct | (canlı exec) | ✓ taze |
| critic | 2026-06-24T10:43:10.592Z | ✓ taze |
| dod | 2026-06-24T10:43:11.106Z | ✓ taze |
| quality | 2026-06-24T08:39:50.000Z | ⚠️ BAYAT (füzyon-dışı) |

## Optimal working-prompt (en-kritik eyleme)
_(bench verisi yok)_

<next-action>
integration/v17-core: kırık gate/testi düzelt (her şeyi bloklar)
</next-action>

---
_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._
