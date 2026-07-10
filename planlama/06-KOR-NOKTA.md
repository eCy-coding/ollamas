# 06-KOR-NOKTA — kör-nokta boyut denetimi

> "Kör nokta kalmasın" mekanizmasının kalbi. 13 boyut; her boyutun tarama komutu + son tarama
> damgası var. **KURAL (00-ANAYASA §3.5): hiçbir faz, TÜM boyutlara "bu fazda etkilendi mi?
> kanıt?" satırı yazılmadan kapanamaz.** Boş hücre yasak; "etkilenmedi çünkü X" gerekçesi şart.
> Damga formatı: `YYYY-MM-DD · commit · sonuç-özeti`.

## Boyut tablosu

| # | Boyut | Tarama komutu | Son tarama damgası |
|---|---|---|---|
| 1 | Güvenlik (kod) | `semgrep scan --config auto --severity ERROR server/ .github/ --json \| jq '.results \| length'` | 2026-06-21 · semgrep 31 → ~10 gerçek + ~6 FP (NEXT_TODO cycle-2) — P2'de yeniden |
| 2 | Test coverage | `vitest run` (FRESH) + skipped listesi | 2026-06-21 · 832 pass / 13 skip / 0 fail |
| 3 | Docs güncelliği | README/QUICKSTART spot-check ≥10 komut koş + ölü link tarama | ☐ hiç taranmadı (P5) |
| 4 | Release/rollback | `gh run list --workflow release-binary.yml -L 1` + RELEASE_ROLLBACK.md tatbikat | ☐ tatbikat yapılmadı (P5) |
| 5 | Lisans + bağımlılık | `npm audit --json` + LICENSE dosyası + adoption-attribution notları | 2026-07-10 · c5ac42d · 3 moderate / 0 high / 0 critical |
| 6 | CI sağlığı | `gh run list -L 10` (workflow yeşilliği) + workflow injection taraması (T-06) | ☐ P2/P5'te damgalanacak |
| 7 | Performans | `npm run test:perf` + Lighthouse (D11) + tok/s parite (`ollamas status`) | kısmi: 84 tok/s chat kanıtı (SEYIR Faz 33) — Lighthouse ☐ |
| 8 | Billing/para | Stripe test-mode zinciri (D10) + `budget.json`/usage metering denetimi | ☐ P4 |
| 9 | UX / a11y | playwright suite + a11y spec'leri (`npm run test:e2e:web`) | 2026-07-05 · playwright 19/19 (SEYIR Faz 33) |
| 10 | i18n TR-EN | locale anahtar-parite testi (D12) | ☐ parite testi yok — P4'te yazılır |
| 11 | Observability | `/api/health` + RUM sayacı + telemetri panel canlılığı (`curl :3000/api/health`) | 2026-07-05 · health 200, RUM sağlıklı, DOD-100 |
| 12 | Veri gizliliği / key hijyeni | `git log --all -S "sk-" --oneline \| head` + `ollamas keys` == `/api/keys/health` parite | kısmi: keys parite ✅ (COMPLETENESS) — git-secret taraması ☐ |
| 13 | Worktree/branch hijyeni | `git worktree list \| wc -l` + `git branch --list 'audit/*' \| wc -l` + `claude/*` iç worktree sayısı | 2026-07-10 · c5ac42d · 19 worktree, 67 audit/*, 4 claude/* — konsolidasyon P3 |
| 14 | Kullanıcı benimseme / DX | `grep -ci "mission control.*mesh" README.md` + CONTRIBUTING/adding-a-tool/extension-guide/troubleshooting/model-guide dosya-var + custom-openai dropdown testi (D21/D22/D23) | 2026-07-10 · S-003 dogfooding: README kurgusal-ürün, CONTRIBUTING yok, custom-openai dropdown-dışı, docs eksik — P6 |

## Faz kapanış şablonu (her faz oturumu doldurur, 09-SEYIR'e de kopyalanır)

```markdown
### Faz <Pn> kör-nokta kapanışı — <tarih> · <commit>
| Boyut | Etkilendi mi? | Kanıt / gerekçe |
|---|---|---|
| 1 Güvenlik | evet/hayır | <komut+çıktı özeti> veya "etkilenmedi çünkü <X>" |
| 2 Test | … | … |
| … (14 satırın HEPSİ — DX dahil) | | |
```

## Tarama kayıtları (append-only)

### 2026-07-10 — P0 baseline taraması (fable-5, read-only)
- Boyut 5: `npm audit` → `{"moderate":3,"high":0,"critical":0}` — NEXT_TODO'daki "7 açık / 1 high"
  ESKİMİŞ; stale-severity dersi doğrulandı.
- Boyut 13: 19 worktree / 137 branch / 67 audit/* — sayılar 01-ENVANTER'de damgalı.
- Diğer boyutlar: bu oturum read-only planlama; kod boyutları etkilenmedi çünkü `git diff`
  yalnız `planlama/` içerir.

### 2026-07-10 — S-001 reconcile (mikro-genişletme, canlı kod okuması)
- **Boyut 1 (güvenlik):** NEXT_TODO 🔴/🟡 gap'lerin çoğu FP/DONE — canlı anchor'la doğrulandı:
  commander.ts:46 execFile (FP), server.ts:276-294 localOwnerGuard SaaS-403 (RCE mitige),
  adminGuard 2563-2574 (throttle var), migrations.ts:170-181 (uniqueness var), release yml:86 (env-var),
  providers.ts:204 (safeParse), pipeline 2072-2078 (validate-order doğru). → 5 FP/DONE, 4 downgrade.
  Gerçek kalan güvenlik: ReDoS audit (M-009, küçük), colab urllib (M-010), compose (M-011).
- **Boyut 7 (perf):** `lighthouserc.json` + `budget.json` MEVCUT — RUN edilmemiş (M-018).
- **Boyut 10 (i18n):** en/tr 159-key parite VAR; key-count assert YOK (M-019).
- **Boyut 2 (test):** commander/pipeline/admin/localOwnerGuard birim-testi YOK (gerçek boşluk, M-001..007).
- Kod dokunulmadı — bu oturum yalnız `planlama/` (10-13 yeni + reconcile).

### 2026-07-10 — S-003 dogfooding (kullanıcı benimseme / DX — Boyut 14)
- **Boyut 14 (DX):** 3 persona journey-tracing. Bulgu: mekanizmalar olgun, boşluk kullanıcı-docs + UX.
  - README.md:1 kurgusal ürün ("LLM Mission Control mesh") — kendim doğruladım (GAP-024).
  - setup.sh olmayan `bin/main.go` arıyor (GAP-025). CONTRIBUTING/adding-a-tool/extension-guide/
    troubleshooting/model-guide YOK. custom-openai + catalog `ReactAgentTab.tsx:211` dropdown-dışı (GAP-035, gerçek bug).
  - 15 gerçek gap (GAP-024..038) → P6 fazı. 2 UX-bug + 13 doküman. Ayrıntı: 15-KULLANICI-IHTIYAC.
- Kod dokunulmadı — yalnız `planlama/` (15 yeni + P6 reconcile).
