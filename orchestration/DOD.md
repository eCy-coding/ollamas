# DOD — Definition-of-Done & Loose-Ends (öz-denetim)

> READ-ONLY `dod.ts` üretti. "Yarım bırakma, tamamlamadan geçme" deterministik enforce.
> **Tamamlanmışlık: 39/100** · 12 lapse (26 araç, 28 lib).

### 🧩 Yarım iş (test'siz kod) (1)
- **[high]** shared.ts: shared.ts (4 export) test'te geçmiyor — yarım iş
  → shared.ts için tests/shared.test.ts ekle

### 📦 Commit'siz yeşil iş (1)
- **[med]** 44 dosya: Commit'siz yeşil iş (built-not-shipped): ADOPTIONS_ORCHESTRATION.md, AUTOPILOT.md, CONDUCTOR.md, DOCTOR.md, DRIFT.md, MODEL_PROMPT.md…
  → yeşil parçayı commit'le (per-file git add + conventional)

### 🔗 Eş-zamanlı gereken (concurrent) (7)
- **[med]** adopt-gate: adopt-gate kısmen tamam — eksik eş-zamanlı: test
  → adopt-gate için test aynı anda tamamla
- **[med]** claim: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
  → claim için test + SEYIR-entry aynı anda tamamla
- **[med]** driftguard: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
  → driftguard için SEYIR-entry aynı anda tamamla
- **[med]** fuse: fuse kısmen tamam — eksik eş-zamanlı: roadmap-row
  → fuse için roadmap-row aynı anda tamamla
- **[med]** scan: scan kısmen tamam — eksik eş-zamanlı: test
  → scan için test aynı anda tamamla
- **[med]** shared: shared kısmen tamam — eksik eş-zamanlı: test
  → shared için test aynı anda tamamla
- **[med]** status: status kısmen tamam — eksik eş-zamanlı: test
  → status için test aynı anda tamamla

### 📋 DONE ama governance eksik (2)
- **[med]** vO4.2: vO4.2 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.2 için SEYIR girdisi + errors_registry güncelle
- **[med]** vO4.1: vO4.1 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.1 için SEYIR girdisi + errors_registry güncelle

### 🗺️ Roadmap izlenebilirlik (1)
- **[low]** fuse: fuse aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
  → fuse'yi ilgili vO satırına ekle

### 🚧 Marker (TODO/FIXME) (0)
- _temiz_

---
_dod bulur+raporlar; commit/fix insan/conduct (§3). DOD.json → conduct COMPLETENESS._
