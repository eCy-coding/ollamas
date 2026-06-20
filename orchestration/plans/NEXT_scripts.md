# NEXT — scripts lane → v7 (Self Healing)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: ROADMAP_SCRIPTS.md, errors_registry.json
> Mevcut: **v6 (Hardening & Portability)** → Hedef: **v7 (Self Healing)**

**Lane canonical prompt:** "ollamas scripts domain için governance 4 dosyasını kur, tüm scriptleri tier'a göre `scripts/inventory.json`'a sınıfla, baseline 68/1 doğrula, HMAC parity'yi kontrol et, commit'le."

## Spec (niyet)
> Yürütme: `SCRIPTS_AGENTS.md` §6 trigger protokolü. Her versiyonun sonunda **"Next precomputed"** bloğu vardır — bir sonraki versiyonun ilk hamlesi orada hazırdır, böylece iş asla durmaz.
>
> Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. Güncel: **v1 ✅ · v2 ✅ · v3 ✅ · v4 ✅ · v5 ✅ · v6 ✅** (hardening: shellcheck/shfmt/bats + DRY_RUN + ERR-SCR-003 fix; swift 8 + node 134/1 skip), **v7 NEXT**.
>
> ⚠️ **İzolasyon (ERR-SCR-001):** scripts sekmesi artık izole worktree **`~/Desktop/ollamas-scripts-wt`** (branch `feat/scripts-v1`) içinde çalışır — paylaşılan `~/Desktop/ollamas` tree branch-hijack'e açıktı. Her oturum başı branch teyidi zorunlu.

---

## Plan / Phase + Tasks
- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)

## Don't-repeat (errors_registry)
- ERR-SCR-001: Scripts tab MUST work only in its own git worktree (~/Desktop/ollamas-scripts-wt), never the shared ~/Desktop/ollamas tree. At every session start verify the worktree branch == feat/scripts-* before any work or commit.
- ERR-SCR-002: After adding tests, always confirm they are actually collected (test-file count increased). A projects-based vitest.config.ts overrides the default glob; isolation avoids cross-lane config contamination.
- ERR-SCR-003: No hardcoded absolute paths in scripts. Derive repo root from import.meta.url / env, never a literal home path.
- ERR-SCR-004: Scripts ToolRegistry'ye kayıt yaparken: (a) DAİMA canonical isim + has()-reconciler kullan, choke-point expose yüzeyini dupe'la kirletme; (b) schema DAİMA OpenAI function şekli `{type:'function',function:{name,description,parameters}}` — server/tool-registry.ts fn() ayna; flat schema YASAK. Yeni kayıt eklemeden önce mcp-gateway.e2e koş.
- ERR-SCR-005: zsh oturumunda çoklu-dosya argümanını ASLA unquoted skaler değişkenle geçme; literal liste, dizi ("${arr[@]}") veya Makefile değişkeni kullan.

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen scripts lane sekmesisin (branch feat/scripts-v1).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas-scripts-wt/scripts/SCRIPTS_AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: v6 (Hardening & Portability) DONE. Hedef: v7 (Self Healing).
**[Task]** v7 (Self Healing) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > > Yürütme: `SCRIPTS_AGENTS.md` §6 trigger protokolü. Her versiyonun sonunda **"Next precomputed"** bloğu vardır — bir sonraki versiyonun ilk hamlesi orada hazırdır, böylece iş asla durmaz.
  > >
  > > Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. Güncel: **v1 ✅ · v2 ✅ · v3 ✅ · v4 ✅ · v5 ✅ · v6 ✅** (hardening: shellcheck/shfmt/bats + DRY_RUN + ERR-SCR-003 fix; swift 8 + node 134/1 skip), **v7 NEXT**.
  > >
  > > ⚠️ **İzolasyon (ERR-SCR-001):** scripts sekmesi artık izole worktree **`~/Desktop/ollamas-scripts-wt`** (branch `feat/scripts-v1`) içinde çalışır — paylaşılan `~/Desktop/ollamas` tree branch-hijack'e açıktı. Her oturum başı branch teyidi zorunlu.
  > 
  > ---
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - ERR-SCR-001: Scripts tab MUST work only in its own git worktree (~/Desktop/ollamas-scripts-wt), never the shared ~/Desktop/ollamas tree. At every session start verify the worktree branch == feat/scripts-* before any work or commit.
  - ERR-SCR-002: After adding tests, always confirm they are actually collected (test-file count increased). A projects-based vitest.config.ts overrides the default glob; isolation avoids cross-lane config contamination.
  - ERR-SCR-003: No hardcoded absolute paths in scripts. Derive repo root from import.meta.url / env, never a literal home path.
  - ERR-SCR-004: Scripts ToolRegistry'ye kayıt yaparken: (a) DAİMA canonical isim + has()-reconciler kullan, choke-point expose yüzeyini dupe'la kirletme; (b) schema DAİMA OpenAI function şekli `{type:'function',function:{name,description,parameters}}` — server/tool-registry.ts fn() ayna; flat schema YASAK. Yeni kayıt eklemeden önce mcp-gateway.e2e koş.
  - ERR-SCR-005: zsh oturumunda çoklu-dosya argümanını ASLA unquoted skaler değişkenle geçme; literal liste, dizi ("${arr[@]}") veya Makefile değişkeni kullan.
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon v6 (Hardening & Portability) kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
