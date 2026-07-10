# 04-FAZLAR — faz modeli P0 → P-FINAL

> Odysseus "Phase 0 planning baseline" pattern'i. Her faz kartı: girdi / çıktı / kabul / lane /
> gap'ler + **mikro-adım checklist'i (M-id)**. Faz kapanışı = kabul kriteri kanıtlı (00-ANAYASA §5) +
> 06-KOR-NOKTA 13-boyut satırı + Opus gate onayı. **Bu dosya kodlama fazlarının (P2+) canonical
> sırasıdır.** Atomik görevler: 10-MIKRO · DAG: 13-BAGIMLILIK. Damga: 2026-07-10 (S-001 reconcile'lı).
>
> **⚠️ Reconcile etkisi:** P2 güvenlik ilk sanılandan KÜÇÜK — GAP-002/003/005/006/007 FP/DONE
> (03-GAP DURUM). P2 çoğu regresyon-testi (⊘). Gerçek kod yükü P3(test/lane) + P5(release) ağırlıklı.
>
> **⚠️ YÜRÜTME SIRASI = 16-VERSIYON-YOLHARITASI (usability-first release-train).** Bu dosya (04-FAZLAR)
> artık **bağımlılık/kabul-referansıdır**, yürütme sırası DEĞİL. Fazlar 10 versiyona haritalandı:
> P6a→V1, P6b-UX→V2/V7, P6b-docs→V3, P2→V4, P3→V5, P4→V6, P5→V1(sürüm)/V8, +V9/V10 (CHANGELOG/E2E/GA).
> Sıra "kullanılabilirlik-önce": kullanıcı V2'de kendi modelini kullanmaya başlar. Detay: 16-VERSIYON §Faz→Versiyon.

## Faz grafiği

```
P0 Envanter ──▶ P1 DoD+Gap ──▶ P2 Güvenlik ──▶ P3 Test/Contract ──▶ P4 Ürün/UX ──▶ P5 Release ──▶ P-FINAL
   (bu katman = P0+P1 tamamlandı)          └──────── kodlama fazları (plan onayı sonrası) ────────┘
```

Kodlama SIRASI zorunlu: güvenlik (P2) → test bütünlüğü (P3) → ürün (P4) → release (P5).
Gerekçe: güvensiz tabanda ürün/release kanıtı geçersiz; test tabanı olmadan ürün regresyonu görünmez.

---

## P0 — Envanter Baseline ✅ (bu oturum)

- **Girdi:** repo @ c5ac42d.
- **Çıktı:** `01-ENVANTER.md` damgalı + recompute komutları.
- **Kabul:** her metrik komutla ölçüldü + çıktı yapıştırıldı; `git diff --stat` yalnız `planlama/`.
- **Lane:** hepsi (read-only).
- **Durum:** ✅ (09-SEYIR ilk kayıt).

## P1 — DoD + Gap ✅ (bu oturum)

- **Girdi:** P0 envanteri.
- **Çıktı:** `02-DOD.md` (D1-D20) + `03-GAP.md` (GAP-001..023) + `05-TEHDIT.md` + `06-KOR-NOKTA.md`.
- **Kabul:** her DoD ekseni kabul-komutu + beklenen-çıktı içerir; NEXT_TODO P0'ları GAP'e eşlendi
  (stale-severity FP'leri işaretli).
- **Lane:** hepsi (read-only).
- **Durum:** ✅.

---

## P2 — Güvenlik Kapanışı ☐

- **Girdi:** 03-GAP 🔴/🟡 güvenlik satırları + 05-TEHDIT matrisi.
- **Gap'ler:** GAP-001, 002 (🔴); GAP-003, 004, 005, 006, 007, 008 (🟡); GAP-009 (🔵 fırsatça).
- **Lane:** gateway-v2, tunnel, key-autonomy, contract, revenue.
- **Scope (Scope Law dosyaları):** `server.ts` (auth), `server/commander.ts`, `server/providers.ts`,
  `server/middleware/*`, `.github/workflows/release-binary.yml`, ilgili `tests/server/*`.
- **Kabul kriteri:**
  - `semgrep scan --config auto --severity ERROR server/ .github/ --json | jq '.results|length'` = **0**
  - `vitest run tests/server/` → auth-boundary + commander injection + pipeline-validate testleri yeşil
  - `npm audit` high=0, critical=0 (moderate gerekçe listesi 05 §5)
  - `git diff` yalnız scope dosyaları
- **Mikro-adımlar (10-MIKRO):** M-001, M-002 (auth guard test) · M-003..M-008 (⊘ regresyon: commander/pipeline/record/admin/providers/workflow) · M-009 (ReDoS audit) · M-010 (colab urllib) · M-011 (compose read-only). Küme: 13-BAGIMLILIK K1(⊘ test-only, hızlı) + K2(gerçek).
- **Çıktı:** D2, D3, D4, D5, D18(kısmi) ✅ + 03-GAP satırları [x]+KANIT.

## P3 — Test / Contract Kapanışı ☐

- **Girdi:** P2 sonrası temiz taban.
- **Gap'ler:** GAP-011 (🔴 migration), GAP-012, GAP-013, GAP-014, GAP-015.
- **Lane:** contract, ux-e2e, cli, scripts, converge.
- **Scope:** `server/store/migrations.ts`, `tests/**`, `playwright*`, worktree/branch konsolidasyon.
- **Kabul kriteri:**
  - `vitest run` → 0 failed; her skipped'e gerekçe yorumu
  - `npm run test:e2e` → 0 failed
  - `grep -cE 'version:' server/store/migrations.ts` + load-time dup-assert testi yeşil; divergent v3 renumber/squash kararı uygulandı
  - `git branch --list 'audit/*' | wc -l` ≤ hedef + reconcile kaydı; iç `claude/*` worktree = 0
- **Mikro-adımlar (10-MIKRO):** M-012 (⊘ migration uniqueness testi) · M-013 (FRESH suite — BARRIER, tüm P2/P3 testleri sonrası) · M-014 (skip gerekçe-belge) · M-015 (audit/* + divergent-lane konsolidasyon, Emre-gate) · M-016 (iç worktree prune). Küme: K3.
- **Çıktı:** D6, D7, D8, D9 ✅.

## P4 — Ürün / Revenue / UX ☐

- **Girdi:** yeşil test tabanı.
- **Gap'ler:** GAP-016 (billing), GAP-017 (Lighthouse), GAP-018 (i18n).
- **Lane:** cockpit, revenue, frontend, colab.
- **Scope:** `src/**` (frontend), `server/billing/**`, `src/locales/*`, `lighthouserc.json`.
- **Kabul kriteri:**
  - Stripe test-mode: checkout→webhook→usage-metering zinciri testi yeşil + canlı test-mode kanıt
  - `lighthouserc.json` eşikleri tanımlı + `npx lighthouse` json eşik-geçer
  - i18n anahtar-parite testi fark=0
- **Mikro-adımlar (10-MIKRO):** M-017 (billing e2e zincir) · M-018 (Lighthouse RUN, M-013 sonrası) · M-019 (i18n key-count assert). Küme: K4.
- **Çıktı:** D10, D11, D12 ✅.

## P5 — Release / Dağıtım ☐

- **Girdi:** ürün-hazır sürüm.
- **Gap'ler:** GAP-020 (sürüm hijyeni), GAP-021 (docs), GAP-022 (install/rollback), GAP-007 doğrulama.
- **Lane:** shipgate, scripts.
- **Scope:** `package.json`, `VERSION`, `install.sh`/`bootstrap-macos.sh`, `README.md`, `QUICKSTART.md`,
  `docs/RELEASE_ROLLBACK.md`, `.github/workflows/*`.
- **Kabul kriteri:**
  - `node -p "require('./package.json').version"` gerçek semver; `VERSION` tek-kaynak
  - temiz-dizin `install.sh` → exit 0 + `ollamas status` çalışır
  - `gh run list --workflow release-binary.yml -L 1` → success
  - RELEASE_ROLLBACK.md tatbikatı canlı koşuldu (kanıt 09-SEYIR)
  - README/QUICKSTART ≥10 komut exit 0, ölü link 0
- **Mikro-adımlar (10-MIKRO):** M-020 (cloud master-key fail-closed) · M-021 (VERSION+semver) · M-022 (README komut spot-check, M-021 sonrası) · M-023 (install.sh temiz-dizin, M-021 sonrası) · M-024 (rollback tatbikat) · M-025 (canonical not, Emre-gate). Küme: K5.
- **Çıktı:** D13, D14, D15, D16, D17 ✅.

## P6 — Benimseme / DX ☐ (dogfooding · kaynak: 15-KULLANICI-IHTIYAC)

- **Girdi:** release-hazır sürüm (P5) + 3-persona ihtiyaç envanteri.
- **Gap'ler:** GAP-024..038 (15). Alt-akış P6a (kimlik/onboarding, adoption-blocker) + P6b (DX docs + BYO-model UX).
- **Lane:** frontend (UX: M-031/037/038), scripts/shipgate (docs+setup: M-026/027/028/032/033/036), cli (M-035).
- **Scope:** `README.md`, `setup.sh`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/**` (adding-a-tool,
  extension-guide, troubleshooting, model-guide, deploy-guide, api-quickstart, custom-model),
  `.claude/HOWTO-ADD-SKILL.md`, `cli/ADDING-A-COMMAND.md`, `src/components/ReactAgentTab.tsx` (dropdown),
  `server/ai.ts` (onboarding), ilgili `tests/ui/*`.
- **Kabul kriteri:**
  - **P6a:** `grep -ci "mission control.*mesh\|WASM sandbox\|informed consent" README.md` = 0 (M-026);
    `bash -n setup.sh` temiz + `go build` referansı yok (M-027); CONTRIBUTING+CoC var (M-028)
  - **P6b:** custom-openai + catalog agent dropdown'da seçilebilir + test yeşil (M-031, GERÇEK bug);
    model-yok → yönlendirici mesaj (M-037); adding-a-tool + extension-guide + troubleshooting + model-guide var
  - Kimlik-borcu kümesi kapandı: README(024)+package(020)+PLAN(023)+setup(025) gerçek ürünü yansıtır
- **Mikro-adımlar (10-MIKRO):** M-026..M-040 (15). Küme: K6 (P6a hızlı-docs) + K7 (P6b DX+UX).
- **Çıktı:** D21, D22, D23 ✅.

## P-FINAL — Kapanış Denetimi ☐

- **Girdi:** P2-P6 kanıtları.
- **Lane:** yok (Opus gate oturumu).
- **Kabul kriteri (D19, D20):**
  - 02-DOD matrisinin HER satırı komut+çıktı ile ✅ (Opus bağımsız yeniden-doğrular)
  - 06-KOR-NOKTA tüm boyutlar (13 + DX) ≤30 gün taze damgalı
  - Opus gate onay kaydı 09-SEYIR'de
- **Çıktı:** v-FINAL ilan; `git tag`.

---

## Lane × Faz matrisi

| Lane / Faz | P2 | P3 | P4 | P5 | P6 |
|---|---|---|---|---|---|
| gateway-v2 | ● (auth, providers, T-07) | ● (migration) | | | |
| tunnel | ● (mesh auth) | | | | |
| key-autonomy | ● (admin, auth) | | | | |
| contract | ● (commander) | ● (migration, federation test) | | | |
| revenue | ● (unawaited) | | ● (billing e2e) | | |
| converge | | ● (lane/branch konsolidasyon) | | | |
| ux-e2e | | ● (playwright) | | | |
| cli | | ● (skipped-e2e gerekçe) | | | ● (CLI-cmd rehber M-035) |
| scripts | ● (workflow) | ● | | ● (install/release) | ● (setup.sh, deploy-guide) |
| cockpit | | | ● (UX/Lighthouse) | | ● (per-model ayar UI M-038) |
| frontend | | | ● (i18n, Lighthouse) | | ● (dropdown M-031, onboarding M-037) |
| colab | ● (urllib guard) | | | | |
| shipgate | | | | ● (version, docs, rollback) | ● (README, CONTRIBUTING, docs/*) |

`●` = o lane o fazda iş görür. Boş = o fazda etkilenmez (kör-nokta satırında "etkilenmedi çünkü").
