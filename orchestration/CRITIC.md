# CRITIC — Orchestration Öz-Denetim (completeness)

> READ-ONLY `critic.ts` üretti. Sistem kendi açığını bulur (deterministik, self-improving).
> **Kapsamlılık skoru: 100/100** · 0 gap (56 araç, 78 artefakt).

### 🔴 Roadmap-vs-Gerçek Drift (0)
- _temiz_

### DONE ama kanıt-yok (0)
- _temiz_

### Orphan artefakt (0)
- _temiz_

### Duplicate araç (0)
- _temiz_

### Test-coverage gap (0)
- _temiz_

## ⏭️ Gerekçeli-istisna (suppressed: 6) — gizlenmedi, kabul-edildi
- `crit:coverage-gap:lib/signal.ts` — notify = terminal-notifier IO-wrapper; signal.test 28-case zaten isAllowedCmd+mocked-nudge/notify kapsar
- `crit:duplication:autopilot.ts↔horizon.ts` — false-positive: autopilot adımları KOŞAR, horizon roadmap ÜRETİR — farklı girdi/çıktı/amaç (shared-import heuristic gürültüsü)
- `crit:duplication:conduct.ts↔serve.ts` — false-positive: conduct lane-durumu ANALİZ eder, serve HTTP/SSE ile GÖSTERİR — farklı katman (analyzer vs UI)
- `crit:duplication:fleet-conduct.ts↔fleet-launch.ts` — false-positive: fleet-launch plan+wrapper ÜRETİR ve tab AÇAR (producer), fleet-conduct rapor OKUR + gate + convergence (supervisor/consumer) — producer→consumer sözleşmesi, kod örtüşmesi yok; overlap = domain kelimeleri (local/model/fleet)
- `crit:duplication:model-hook.ts↔role-hook.ts` — false-positive: model-hook model-sorusuna MODEL_PROMPT enjekte, role-hook kimlik-sorusuna role-cevap — farklı tetik/payload, ikisi de UserPromptSubmit ama amaç-ayrı
- `crit:duplication:oracle-serve.ts↔oracle.ts` — false-positive: ikisi de AYNI oracle/index.ts motorunun ön-yüzü — oracle one-shot CLI, oracle-serve unix-socket sıcak daemon (memo cache, cold-start eliminasyonu) — conduct↔serve emsaliyle aynı sınıf (CLI vs daemon katmanı), kod örtüşmesi yok

---
_Critic bulur+raporlar; fix conduct/insan (§3). CRITIC.json → conduct COMPLETENESS beslemesi._
