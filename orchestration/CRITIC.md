# CRITIC — Orchestration Öz-Denetim (completeness)

> READ-ONLY `critic.ts` üretti. Sistem kendi açığını bulur (deterministik, self-improving).
> **Kapsamlılık skoru: 94/100** · 1 gap (27 araç, 32 artefakt).

### 🔴 Roadmap-vs-Gerçek Drift (0)
- _temiz_

### DONE ama kanıt-yok (1)
- **[med]** vO16: vO16 (E2E Integration Run, Diagnose, Repair & Publish lane'ler int) DONE ama eşleşen araç/artefakt yok
  → vO16 kanıtını doğrula ya da DONE'ı geri al

### Orphan artefakt (0)
- _temiz_

### Duplicate araç (0)
- _temiz_

### Test-coverage gap (0)
- _temiz_

## ⏭️ Gerekçeli-istisna (suppressed: 5) — gizlenmedi, kabul-edildi
- `crit:coverage-gap:lib/signal.ts` — notify = terminal-notifier IO-wrapper; signal.test 28-case zaten isAllowedCmd+mocked-nudge/notify kapsar
- `crit:duplication:autopilot.ts↔horizon.ts` — false-positive: autopilot adımları KOŞAR, horizon roadmap ÜRETİR — farklı girdi/çıktı/amaç (shared-import heuristic gürültüsü)
- `crit:duplication:conduct.ts↔serve.ts` — false-positive: conduct lane-durumu ANALİZ eder, serve HTTP/SSE ile GÖSTERİR — farklı katman (analyzer vs UI)
- `crit:duplication:doctor.ts↔model-hook.ts` — false-positive: doctor readiness DENETLER, model-hook Claude-prompt'u YAKALAR — farklı scope
- `crit:duplication:model-hook.ts↔role-hook.ts` — false-positive: model-hook model-sorusuna MODEL_PROMPT enjekte, role-hook kimlik-sorusuna role-cevap — farklı tetik/payload, ikisi de UserPromptSubmit ama amaç-ayrı

---
_Critic bulur+raporlar; fix conduct/insan (§3). CRITIC.json → conduct COMPLETENESS beslemesi._
