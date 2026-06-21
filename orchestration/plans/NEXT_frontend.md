# NEXT — frontend lane → vF7 (Vanilla alt lane (Landing/Embed) saf HTML5/CSS/JS web/ landi)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: FRONTEND_AGENTS.md
> Mevcut: **vF6 (Accessibility (WCAG AA) axe core, jsx a11y axe Playwright ga)** → Hedef: **vF7 (Vanilla alt lane (Landing/Embed) saf HTML5/CSS/JS web/ landi)**

## Spec (niyet)
Tetik cümlesi: **"sıradaki versiyonu planla"** →
1. Mevcut tamamlanmamış en düşük vFn alınır.
2. Tam **todo + faz listesi** üretilir (TodoWrite).
3. TDD ile **kesintisiz** kodlanır (test önce).
4. **Kalite kapısı** (§4) taze koşar.
5. Conventional commit + `(vFn)` etiketi.
6. `FRONTEND_SEYIR_DEFTERI.md` güncellenir (kanıt + hata sicili).
7. Bir sonraki versiyonun ilk adımı **önceden hesaplanır** ve faz log'a "Sonraki" notu düşülür.

Plan tek seferlik değil — sürekli, her işlemde bir adım ileri. Kural değişiyorsa
**önce bu dosya** güncellenir, sonra kod.

---

## Plan / Phase + Tasks
- [ ] Mevcut tamamlanmamış en düşük vFn alınır.
- [ ] Tam **todo + faz listesi** üretilir (TodoWrite).
- [ ] TDD ile **kesintisiz** kodlanır (test önce).
- [ ] **Kalite kapısı** (§4) taze koşar.
- [ ] Conventional commit + `(vFn)` etiketi.
- [ ] `FRONTEND_SEYIR_DEFTERI.md` güncellenir (kanıt + hata sicili).
- [ ] Bir sonraki versiyonun ilk adımı **önceden hesaplanır** ve faz log'a "Sonraki" notu düşülür.

## Don't-repeat (errors_registry)
- (kayıtlı hata yok)

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen frontend lane sekmesisin (branch feat/frontend-vf3).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas-frontend-wt/FRONTEND_AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: vF6 (Accessibility (WCAG AA) axe core, jsx a11y axe Playwright ga) DONE. Hedef: vF7 (Vanilla alt lane (Landing/Embed) saf HTML5/CSS/JS web/ landi).
**[Task]** vF7 (Vanilla alt lane (Landing/Embed) saf HTML5/CSS/JS web/ landi) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > Tetik cümlesi: **"sıradaki versiyonu planla"** →
  > 1. Mevcut tamamlanmamış en düşük vFn alınır.
  > 2. Tam **todo + faz listesi** üretilir (TodoWrite).
  > 3. TDD ile **kesintisiz** kodlanır (test önce).
  > 4. **Kalite kapısı** (§4) taze koşar.
  > 5. Conventional commit + `(vFn)` etiketi.
  > 6. `FRONTEND_SEYIR_DEFTERI.md` güncellenir (kanıt + hata sicili).
  > 7. Bir sonraki versiyonun ilk adımı **önceden hesaplanır** ve faz log'a "Sonraki" notu düşülür.
  > 
  > Plan tek seferlik değil — sürekli, her işlemde bir adım ileri. Kural değişiyorsa
  > **önce bu dosya** güncellenir, sonra kod.
  > 
  > ---
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - (kayıtlı hata yok)
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon vF6 (Accessibility (WCAG AA) axe core, jsx a11y axe Playwright ga) kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
