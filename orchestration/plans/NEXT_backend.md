# NEXT — backend lane → (belirlenemedi — ROADMAP'e planlı versiyon ekle)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: AGENTS.md
> Mevcut: **?** → Hedef: **(belirlenemedi — ROADMAP'e planlı versiyon ekle)**

## Spec (niyet)
_ROADMAP'te 'Next precomputed' bloğu yok — lane sekmesi niyeti netleştirsin._

## Plan / Phase + Tasks
- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)

## Don't-repeat (errors_registry)
- (kayıtlı hata yok)

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen backend lane sekmesisin (branch feat/v1.9-mcp-bidirectional).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas/AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: ? DONE. Hedef: (belirlenemedi — ROADMAP'e planlı versiyon ekle).
**[Task]** (belirlenemedi — ROADMAP'e planlı versiyon ekle) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > (ROADMAP'te next-bloğu yok; niyeti netleştir.)
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - (kayıtlı hata yok)
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon ? kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
