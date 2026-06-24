# DOD — Definition-of-Done & Loose-Ends (öz-denetim)

> READ-ONLY `dod.ts` üretti. "Yarım bırakma, tamamlamadan geçme" deterministik enforce.
> **Tamamlanmışlık: 70/100** · 6 lapse (27 araç, 31 lib).

### 🧩 Yarım iş (test'siz kod) (0)
- _temiz_

### 📦 Commit'siz yeşil iş (1)
- **[med]** 20 dosya: Commit'siz yeşil iş (built-not-shipped): AUTOPILOT.md, BENCH.json, BENCH.md, CONDUCTOR.md, CRITIC.json, CRITIC.md…
  → yeşil parçayı commit'le (per-file git add + conventional)

### 🔗 Eş-zamanlı gereken (concurrent) (5)
- **[med]** adopt-gate: adopt-gate kısmen tamam — eksik eş-zamanlı: test
  → adopt-gate için test aynı anda tamamla
- **[med]** claim: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
  → claim için test + SEYIR-entry aynı anda tamamla
- **[med]** driftguard: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
  → driftguard için SEYIR-entry aynı anda tamamla
- **[med]** scan: scan kısmen tamam — eksik eş-zamanlı: test
  → scan için test aynı anda tamamla
- **[med]** status: status kısmen tamam — eksik eş-zamanlı: test
  → status için test aynı anda tamamla

### 📋 DONE ama governance eksik (0)
- _temiz_

### 🗺️ Roadmap izlenebilirlik (0)
- _temiz_

### 🚧 Marker (TODO/FIXME) (0)
- _temiz_


---
_dod bulur+raporlar; commit/fix insan/conduct (§3). DOD.json → conduct COMPLETENESS._
