# 06-KOR-NOKTA — kör-nokta boyut denetimi

> "Kör nokta kalmasın" mekanizmasının kalbi. 13 boyut; her boyutun tarama komutu + son tarama
> damgası var. **KURAL (00-ANAYASA §3.5): hiçbir faz, TÜM boyutlara "bu fazda etkilendi mi?
> kanıt?" satırı yazılmadan kapanamaz.** Boş hücre yasak; "etkilenmedi çünkü X" gerekçesi şart.
> Damga formatı: `YYYY-MM-DD · commit · sonuç-özeti`.

## Boyut tablosu

| # | Boyut | Tarama komutu | Son tarama damgası |
|---|---|---|---|
| 1 | Güvenlik (kod) | `semgrep scan --config auto --severity ERROR server/ .github/ --json \| jq '.results \| length'` | 2026-07-10 · 5dd49d0 · semgrep ERROR server/+.github/ = 0 (M-044 canlı) |
| 2 | Test coverage | `vitest run` (FRESH) + skipped listesi | 2026-07-10 · 5dd49d0 · vitest FRESH 2228 pass / 22 skip / 0 fail (M-042, 2 ardışık koşum) |
| 3 | Docs güncelliği | README/QUICKSTART spot-check ≥10 komut koş + ölü link tarama | 2026-07-10 · 5dd49d0 · M-022: 14 komut/11-exit-0 + ölü-link 0 (74 rel + 7 ext) + verify-docfix |
| 4 | Release/rollback | `gh run list --workflow release-binary.yml -L 1` + RELEASE_ROLLBACK.md tatbikat | 2026-07-10 · 5dd49d0 · M-024 5-bölüm sandbox-drill ✅; release-binary.yml default-branch'te hiç koşmadı (D14 → Emre push-gate) |
| 5 | Lisans + bağımlılık | `npm audit --json` + LICENSE dosyası + adoption-attribution notları | 2026-07-10 · 5dd49d0 · npm audit: 3 moderate / 0 high / 0 critical (M-044 canlı) |
| 6 | CI sağlığı | `gh run list -L 10` (workflow yeşilliği) + workflow injection taraması (T-06) | 2026-07-10 · 5dd49d0 · son 5 koşu 07-08: security-gate blocking KANITLI (planted-vuln fail=by-design), scripts-ci kırmızı=key-autonomy lane; bu branch push'suz → train CI'da koşmadı (D14) |
| 7 | Performans | `npm run test:perf` + Lighthouse (D11) + tok/s parite (`ollamas status`) | 2026-07-10 · 5dd49d0 · lhci autorun (dist) exit 0, 3 URL/9 koşu assertions pass (M-044); perf 0.96 damgası M-018 |
| 8 | Billing/para | Stripe test-mode zinciri (D10) + `budget.json`/usage metering denetimi | 2026-07-10 · 5dd49d0 · billing-e2e-chain testi yeşil (M-044 canlı re-run) |
| 9 | UX / a11y | playwright suite + a11y spec'leri (`npm run test:e2e:web`) | 2026-07-10 · 5dd49d0 · playwright 28/28 (2 WCAG kontrast kök-neden fix f93705a dahil) |
| 10 | i18n TR-EN | locale anahtar-parite testi (D12) | 2026-07-10 · 5dd49d0 · i18n parite+RTL+Intl testleri yeşil (M-019/048; M-044 canlı re-run) |
| 11 | Observability | `/api/health` + RUM sayacı + telemetri panel canlılığı (`curl :3000/api/health`) | 2026-07-10 · 5dd49d0 · /api/health 200 mode=live + /api/ready 200 + /metrics 200 (ollamas_errors_total eklendi, M-049) |
| 12 | Veri gizliliği / key hijyeni | `git log --all -S "sk-" --oneline \| head` + `ollamas keys` == `/api/keys/health` parite | 2026-07-10 · 5dd49d0 · git log -S sk- isabetleri planlama/orchestration METİN dosyaları (key değil, spot-check); keys parite ✅ |
| 13 | Worktree/branch hijyeni | `git worktree list \| wc -l` + `git branch --list 'audit/*' \| wc -l` + `claude/*` iç worktree sayısı | 2026-07-10 · 5dd49d0 · audit/*=0 ✅ · iç claude/* worktree 6 (arşiv-tar hazır, silme classifier-red → Emre-gate) · 19 lane-worktree = Emre V10-sonrası erteleme |
| 14 | Kullanıcı benimseme / DX | `grep -ci "mission control.*mesh" README.md` + CONTRIBUTING/adding-a-tool/extension-guide/troubleshooting/model-guide dosya-var + custom-openai dropdown testi (D21/D22/D23) | 2026-07-10 · 5dd49d0 · README kurgu-grep 0 · CONTRIBUTING/adding-a-tool/extension-guide(9/9)/troubleshooting/model-guide/custom-model/deploy-guide VAR · dropdown+onboarding testli |

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
