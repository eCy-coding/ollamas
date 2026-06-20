# DOD — Definition-of-Done & Loose-Ends (öz-denetim)

> READ-ONLY `dod.ts` üretti. "Yarım bırakma, tamamlamadan geçme" deterministik enforce.
> **Tamamlanmışlık: 60/100** · 8 lapse (26 araç, 30 lib).

### 🧩 Yarım iş (test'siz kod) (0)
- _temiz_

### 📦 Commit'siz yeşil iş (1)
- **[med]** 34 dosya: Commit'siz yeşil iş (built-not-shipped): ADOPTIONS_ORCHESTRATION.md, AUTOPILOT.md, CONDUCTOR.md, CRITIC.json, CRITIC.md, DOCTOR.md…
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

### 📋 DONE ama governance eksik (2)
- **[med]** vO4.2: vO4.2 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.2 için SEYIR girdisi + errors_registry güncelle
- **[med]** vO4.1: vO4.1 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.1 için SEYIR girdisi + errors_registry güncelle

### 🗺️ Roadmap izlenebilirlik (0)
- _temiz_

### 🚧 Marker (TODO/FIXME) (0)
- _temiz_


---
_dod bulur+raporlar; commit/fix insan/conduct (§3). DOD.json → conduct COMPLETENESS._
