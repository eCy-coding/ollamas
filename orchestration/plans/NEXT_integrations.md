# NEXT — integrations lane → (belirlenemedi — ROADMAP'e planlı versiyon ekle)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: INTEGRATIONS_AGENTS.md
> Mevcut: **?** → Hedef: **(belirlenemedi — ROADMAP'e planlı versiyon ekle)**

## Spec (niyet)
Trigger **"sıradaki versiyonu planla"** = run this loop for v2.N+1. Plan is never one-shot:
sürekli, her işlemde bir adım ileri. Bu sözleşme değişirse önce burada değişir.

## Plan / Phase + Tasks
- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)

## Don't-repeat (errors_registry)
- (kayıtlı hata yok)

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen integrations lane sekmesisin (branch feat/gateway-v2).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas-integrations-wt/INTEGRATIONS_AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: ? DONE. Hedef: (belirlenemedi — ROADMAP'e planlı versiyon ekle).
**[Task]** (belirlenemedi — ROADMAP'e planlı versiyon ekle) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > Trigger **"sıradaki versiyonu planla"** = run this loop for v2.N+1. Plan is never one-shot:
  > sürekli, her işlemde bir adım ileri. Bu sözleşme değişirse önce burada değişir.
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - (kayıtlı hata yok)
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon ? kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
