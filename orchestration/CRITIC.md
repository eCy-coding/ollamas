# CRITIC — Orchestration Öz-Denetim (completeness)

> READ-ONLY `critic.ts` üretti. Sistem kendi açığını bulur (deterministik, self-improving).
> **Kapsamlılık skoru: 62/100** · 5 gap (66 araç, 97 artefakt).

### 🔴 Roadmap-vs-Gerçek Drift (2)
- **[high]** v1.28: v1.28 (.1 build/catalog + keys + orchestra araç eşlemesi (roadmap c) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
  → v1.28 durumunu DONE'a güncelle (roadmap-gerçek reconcile)
- **[high]** v1.25: v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç kapanı) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
  → v1.25 durumunu DONE'a güncelle (roadmap-gerçek reconcile)

### DONE ama kanıt-yok (0)
- _temiz_

### Orphan artefakt (0)
- _temiz_

### Duplicate araç (2)
- **[med]** conduct.ts↔orchestra.ts: conduct.ts ve orchestra.ts ayırt-edici amaç-örtüşmesi (2 distinktif kelime) — olası duplicate
  → conduct.ts/orchestra.ts dedup ya da rol ayrımını netleştir
- **[med]** fleet-conduct.ts↔orchestra.ts: fleet-conduct.ts ve orchestra.ts ayırt-edici amaç-örtüşmesi (3 distinktif kelime) — olası duplicate
  → fleet-conduct.ts/orchestra.ts dedup ya da rol ayrımını netleştir

### Test-coverage gap (1)
- **[low]** lib/fleet-prompt.ts: lib/fleet-prompt.ts: test'siz export → groundedPrompt
  → lib/fleet-prompt.ts için test ekle (groundedPrompt)

## ⏭️ Gerekçeli-istisna (suppressed: 5) — gizlenmedi, kabul-edildi
- `crit:coverage-gap:lib/signal.ts` — notify = terminal-notifier IO-wrapper; signal.test 28-case zaten isAllowedCmd+mocked-nudge/notify kapsar
- `crit:duplication:autopilot.ts↔horizon.ts` — false-positive: autopilot adımları KOŞAR, horizon roadmap ÜRETİR — farklı girdi/çıktı/amaç (shared-import heuristic gürültüsü)
- `crit:duplication:conduct.ts↔serve.ts` — false-positive: conduct lane-durumu ANALİZ eder, serve HTTP/SSE ile GÖSTERİR — farklı katman (analyzer vs UI)
- `crit:duplication:fleet-conduct.ts↔fleet-launch.ts` — false-positive: fleet-launch plan+wrapper ÜRETİR ve tab AÇAR (producer), fleet-conduct rapor OKUR + gate + convergence (supervisor/consumer) — producer→consumer sözleşmesi, kod örtüşmesi yok; overlap = domain kelimeleri (local/model/fleet)
- `crit:duplication:model-hook.ts↔role-hook.ts` — false-positive: model-hook model-sorusuna MODEL_PROMPT enjekte, role-hook kimlik-sorusuna role-cevap — farklı tetik/payload, ikisi de UserPromptSubmit ama amaç-ayrı

---
_Critic bulur+raporlar; fix conduct/insan (§3). CRITIC.json → conduct COMPLETENESS beslemesi._
