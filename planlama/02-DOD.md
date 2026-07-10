# 02-DOD — v-FINAL Definition of Done

> "Proje tamamlandı" iddiasının ölçülebilir tanımı. Format `docs/COMPLETENESS.md` eksen
> matrisinin devamıdır (aynı kanıt-komut disiplini); oradaki ✅ eksenler burada TEKRARLANMAZ,
> referans verilir. Her satır: kabul komutu + beklenen çıktı. Çıktıya göre kriter esnetilemez
> (00-ANAYASA §5). Durum sütununu yalnız faz oturumları günceller (08-PROTOKOL ritüeli).

> **⚠️ S-001 reconcile (2026-07-10):** bazı D-eksenlerinin altyapısı ZATEN mevcut (adminGuard
> rate-limit, Lighthouse config, migration uniqueness) — "Durum" sütununda ⊘=test/RUN-only işaretli.
> Atomik görevler: 10-MIKRO (M-id). Reconcile ayrıntı: 03-GAP DURUM sütunu.

## v-FINAL tanımı (tek cümle)

**Tüm eksenler ✅ + 06-KOR-NOKTA 13 boyut damgalı + Opus gate kapanış onayı 09-SEYIR'de
kayıtlı olduğunda ollamas v-FINAL'dir.**

## Eksen matrisi

| # | Eksen | Kabul komutu | Beklenen çıktı | Faz | Durum |
|---|---|---|---|---|---|
| D1 | Devralınan eksenler (conductor, joker, daemon, katalog, kalibre, MATH, deps, skills, panel, RUM, parite, KeepAlive) | `docs/COMPLETENESS.md` tek-komut bloğu (5 komut) | COMPLETENESS'teki değerler (343/343, 19/19, 48, 92, parite) | P0 ref | ✅ (iter-18 damgalı) |
| D2 | Güvenlik: auth-boundary | `grep -n "authMiddleware" server.ts \| wc -l` + hedefli vitest (`vitest run tests/server/auth*`) | SaaS modda (`SAAS_ENFORCE=1`) dashboard route'ları auth'lu VEYA localhost-bind; test kanıtı | P2 | ☐ |
| D3 | Güvenlik: command-injection | `grep -n "execPromise\|exec(" server/commander.ts` + `vitest run tests/server/commander*` | `execFile` array-args; shell-interpolasyon 0; injection testi yeşil | P2 | ☐ |
| D4 | Güvenlik: semgrep baseline | `semgrep scan --config auto --severity ERROR server/ .github/ --json \| jq '.results \| length'` | BLOCKING (ERROR) = **0**; kalan bulgular `nosemgrep`+gerekçeli baseline'da | P2 | ☐ |
| D5 | Güvenlik: npm audit | `npm audit --json \| node -p "…metadata.vulnerabilities"` | high=0, critical=0 (moderate için gerekçeli istisna listesi) | P2 | ☐ |
| D6 | Test: full suite fresh | `vitest run` | 0 failed; skipped'lerin her biri 03-GAP'te gerekçeli | P3 | ☐ |
| D7 | Test: e2e | `npm run test:e2e` (playwright) | 0 failed | P3 | ☐ |
| D8 | Migration bütünlüğü | `grep -cE 'version:' server/store/migrations.ts` + load-time dup-assert testi | version uniqueness assert **MEVCUT** (migrations.ts:170-181) → yalnız test (M-012 ⊘) + divergent v3 MERGE-kararı (M-015) | P3 | ☐ |
| D9 | Lane konsolidasyonu | `git branch --list 'audit/*' \| wc -l` + `git worktree list \| wc -l` | audit/* için karar uygulanmış (hedef: ≤5 yaşayan); iç `claude/*` worktree 0; divergent lane (gateway-v2 / v1.8-bench) reconcile kararı kayıtlı | P3 | ☐ |
| D10 | Billing e2e | Stripe test-mode akış scripti/testi (`vitest run server/__tests__/*billing*` + canlı test-mode kanıt) | checkout→webhook→usage-metering zinciri yeşil; unawaited `recordUsage/recordAudit` `.catch(log)` ile kapatılmış | P4 | ☐ |
| D11 | UX/performans | Lighthouse (`npx lighthouse http://localhost:3000 --quiet --chrome-flags=--headless --output=json`) | `lighthouserc.json` eşikleri KARŞILANIR — eşik MEVCUT (perf≥0.85, LCP≤2500, CLS≤0.1, TBT≤300) + `budget.json` (script 150KB/total 200KB); yalnız RUN+doğrula (M-018 ⊘-config) | P4 | ☐ |
| D12 | i18n parite | `node -e "const en=Object.keys(require('./src/locales/en.ts')...);"` yerine: `vitest run tests/i18n*` (yoksa P4'te anahtar-parite testi yazılır) | TR/EN anahtar seti eşit; fark listesi 0 | P4 | ☐ |
| D13 | Release: kurulum | temiz makinede/temiz dizinde `install.sh` (veya `bootstrap-macos.sh`) koşusu | exit 0 + `ollamas status` çalışır; kanıt çıktısı 09-SEYIR'de | P5 | ☐ |
| D14 | Release: binary workflow | `gh run list --workflow release-binary.yml -L 1` | son run success + `ref_name` injection fix'li (env ara-değişken) | P5 | ☐ |
| D15 | Release: rollback tatbikatı | `docs/RELEASE_ROLLBACK.md` adımlarının bir kez CANLI koşulması | tatbikat kanıtı (komut+çıktı) 09-SEYIR'de | P5 | ☐ |
| D16 | Docs güncelliği | `README.md` + `QUICKSTART.md` içindeki her komutun koşulması (spot-check ≥10 komut) | hepsi exit 0 veya belgelenmiş ön-koşul; ölü link 0 | P5 | ☐ |
| D17 | Sürüm hijyeni | `node -p "require('./package.json').version"` | `react-example@0.0.0` yerine gerçek ad+semver; `VERSION` tek-kaynak | P5 | ☐ |
| D18 | Threat model kapsaması | 05-TEHDIT mitigasyon→test matrisi | her mitigasyonun karşısında geçen test/komut var; "kabul edilen risk" satırları Emre onaylı | P2/P-FINAL | ☐ |
| D21 | BYO-model yolculuğu | custom-openai dropdown testi + model-onboarding testi (`vitest run tests/ui/react-agent-providers tests/model-onboarding`) | key girilen custom-openai/catalog agent'tan seçilebilir; model-yok → yönlendirici mesaj (throw değil) | P6 | ☐ |
| D22 | Geliştirici-uzatma docs | dosya-var + içerik-grep: CONTRIBUTING, adding-a-tool, extension-guide, troubleshooting, HOWTO-ADD-SKILL, CLI-rehber, deploy-guide, api-quickstart | her uzatma noktası belgeli; extension-guide 9 noktayı indeksler | P6 | ☐ |
| D23 | Onboarding / doğru-ürün | `grep -ci "mission control.*mesh\|WASM sandbox\|informed consent" README.md` + `grep -c "go build" setup.sh` | README gerçek ollamas'ı anlatır (kurgu=0); setup.sh çalışır/yönlendirir; kimlik-borcu (README+package+PLAN+setup) kapalı | P6 | ☐ |
| D19 | Kör-nokta tamlığı | 06-KOR-NOKTA tablosu | tüm boyutlar (13 + DX) ≤30 gün taze damgalı | P-FINAL | ☐ |
| D20 | Kapanış denetimi | Opus gate oturumu: bu matrisin her satırının kanıtını yeniden-doğrular | %100 ✅ + onay kaydı 09-SEYIR'de | P-FINAL | ☐ |

## "Bitti" sayılmayanlar (açık sözleşme)

- **needs-config entegreler** (GitHub/Stripe/Cloudflare token'ları): kod WIRED ise ✅ —
  kredensiyel girmek kullanıcı adımıdır (COMPLETENESS caveat 3), v-FINAL'i bloklamaz.
- **Model-çıktı varyansı** (ör. 99/100 verbatim-apply): pipeline 0-crash + gate/revert koruması
  varsa ✅ — model determinizmi kod ile garanti edilemez (COMPLETENESS caveat 2).
- **13 skipped live-e2e**: gerçek-infra gated; v-FINAL şartı testlerin koşması DEĞİL, her skip'in
  gerekçesinin D6 kapsamında belgeli olması.
- **Google client-side OAuth**: tasarım gereği server-proxy yok (COMPLETENESS caveat 1) — gap değil.
