# CRITIC — Orchestration Öz-Denetim (completeness)

> READ-ONLY `critic.ts` üretti. Sistem kendi açığını bulur (deterministik, self-improving).
> **Kapsamlılık skoru: 60/100** · 7 gap (26 araç, 31 artefakt).

### 🔴 Roadmap-vs-Gerçek Drift (1)
- **[high]** vO13: vO13 (Horizon auto roadmap (10 versiyon lookahead) lib hazır, cond) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
  → vO13 durumunu DONE'a güncelle (roadmap-gerçek reconcile)

### DONE ama kanıt-yok (0)
- _temiz_

### Orphan artefakt (0)
- _temiz_

### Duplicate araç (4)
- **[med]** autopilot.ts↔horizon.ts: autopilot.ts ve horizon.ts amaç-örtüşmesi yüksek (2 ortak kelime) — olası duplicate
  → autopilot.ts/horizon.ts dedup ya da rol ayrımını netleştir
- **[med]** conduct.ts↔serve.ts: conduct.ts ve serve.ts amaç-örtüşmesi yüksek (2 ortak kelime) — olası duplicate
  → conduct.ts/serve.ts dedup ya da rol ayrımını netleştir
- **[med]** doctor.ts↔model-hook.ts: doctor.ts ve model-hook.ts amaç-örtüşmesi yüksek (3 ortak kelime) — olası duplicate
  → doctor.ts/model-hook.ts dedup ya da rol ayrımını netleştir
- **[med]** model-hook.ts↔role-hook.ts: model-hook.ts ve role-hook.ts amaç-örtüşmesi yüksek (5 ortak kelime) — olası duplicate
  → model-hook.ts/role-hook.ts dedup ya da rol ayrımını netleştir

### Test-coverage gap (2)
- **[low]** lib/collect.ts: lib/collect.ts: test'siz export → liveTabMap
  → lib/collect.ts için test ekle (liveTabMap)
- **[low]** lib/signal.ts: lib/signal.ts: test'siz export → notify
  → lib/signal.ts için test ekle (notify)

---
_Critic bulur+raporlar; fix conduct/insan (§3). CRITIC.json → conduct COMPLETENESS beslemesi._
