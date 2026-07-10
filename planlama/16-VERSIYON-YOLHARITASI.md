# 16-VERSIYON-YOLHARITASI — 10 versiyonda uçtan-uca hazır (release-train)

> Mevcut 44 mikro-görevi (M-001..044) **10 shippable minor-release**'e paketleyen yürütme haritası.
> Yürütme SIRASI burasıdır (usability-first); 04-FAZLAR = bağımlılık-referansı, 10-MIKRO = atomik görev.
> **📚 Kod örnekleri + doğrulanmış kaynaklar: `17-KAYNAK-KOD-ORNEKLERI.md`** (kodlama-anında çek).
> Damga: 2026-07-10 · c5ac42d · başlangıç ürün-sürümü **v1.23.0** (git tag).

## 📚 Cookbook referans-haritası (17-KAYNAK-KOD-ORNEKLERI)

| Versiyon | M-görev | Cookbook girişi |
|---|---|---|
| V1 | M-026 README · M-028 CONTRIBUTING+CoC | 17-§B [M-026], [M-028] |
| V2 | M-031 dropdown · M-037 pull-onboarding | 17-§A [M-031], [M-037] |
| V3 | M-029 adding-a-tool · M-030 extension-guide | 17-§C [M-029], [M-030] |
| V4 | M-001 auth-test · M-003 execFile · M-009 ReDoS | 17-§C [M-001], [M-003], [M-009] |
| V6 | M-017 billing · M-018 Lighthouse | 17-§B [M-017], [M-018] |
| V7 | M-038 per-model · M-039 GGUF | 17-§A [M-038], [M-039] |
| V9 | M-041 CHANGELOG | 17-§B [M-041] |

## Çalışma prensibi (en verimli — bu isteğin çalıştığı ilke)

**Release-train / monotonic-usability / thin-vertical-slice.** Her versiyon:
1. **Bağımsız-shippable** — tek başına anlamlı, yarım-iş yok.
2. **Kullanılabilirliği tek-yönlü artırır** — asla geriye götürmez.
3. **Kendi kalite-kapısından geçer** — `npm run lint` (tsc) → `vitest run` (FRESH) → kabul-komutu yeşil.
4. **Canlı yansır** — 14-TAKIP + Artifact güncellenir (00-ANAYASA §8 P-E).
5. **DAG'ı korur** — 13-BAGIMLILIK bağımlılıkları ihlal edilmez.

**Sıra mantığı:** dürüst-kimlik (V1) → BYO-model-kullanılabilir (V2) → geliştirici-uzatabilir (V3) →
sağlamlaştır (V4-V6) → güç-kullanıcı + dağıtım (V7-V8) → cila + GA (V9-V10). **Kullanıcı V2'de kendi
modelini bağlayıp kullanmaya başlayabilir.** Güvenli çünkü güvenlik zaten korumalı (reconcile S-001).

## Versiyon özeti

| V | semver | git-tag | Başlık | Kullanılabilir? |
|---|---|---|---|---|
| V1 | v1.24.0 | `v1.24.0` | Dürüst Kimlik | kimlik-borcu kapanır |
| V2 | v1.25.0 | `v1.25.0` | Kendi Modelini Getir | ✅ **ilk kullanılabilir** |
| V3 | v1.26.0 | `v1.26.0` | Kendi Geliştirmeni Yap | ✅ dev-extensible |
| V4 | v1.27.0 | `v1.27.0` | Güvenlik Kanıtı | sağlamlaşır |
| V5 | v1.28.0 | `v1.28.0` | Test Bütünlüğü | CI güvenilir |
| V6 | v1.29.0 | `v1.29.0` | Ürün & Gelir | gelir-hazır |
| V7 | v1.30.0 | `v1.30.0` | Gelişmiş Model Kontrolü | güç-kullanıcı |
| V8 | v1.31.0 | `v1.31.0` | Dağıtım Sağlamlığı | self-host sağlam |
| V9 | v1.32.0 | `v1.32.0` | Gözlemlenebilirlik & Cila | üretim-cilası |
| V10 | v1.33.0 | `v1.33.0` (GA) | v-FINAL / GA | ✅ **GA — üretime hazır** |

---

## V1 — Dürüst Kimlik (v1.24.0 · git-tag v1.24.0) · Kullanılabilir: kimlik-borcu kapanır

Tema: repo gerçek ürünü (MCP gateway + CLI + $0 conductor) ve gerçek sürümü yansıtsın — yeni kullanıcı
ne kurduğunu doğru anlasın.

### Phase V1-a — Kimlik dokümanları
- [ ] **M-026** README gerçek-ürün — `README.md:1` · kabul `grep -ci "mission control.*mesh\|WASM sandbox\|informed consent" README.md` = 0
  - [ ] Kurgusal mesh/WASM/70B/consent-cluster içeriği kaldır
  - [ ] Gerçek ürün özeti (MCP gateway + tools-as-SaaS + CLI + $0 conductor) yaz
  - [ ] QUICKSTART'a çapraz-link + `npm run ready` yolu
- [ ] **M-027** setup.sh düzelt/yönlendir — `setup.sh` · kabul `bash -n setup.sh` temiz + `grep -c "go build\|bin/main.go" setup.sh` = 0
  - [ ] `bin/main.go`/`go build` referanslarını kaldır
  - [ ] `exec npm run ready` wrapper VEYA sil + README yönlendir (M-026 ile senkron)
- [ ] **M-028** CONTRIBUTING + CODE_OF_CONDUCT — kök · kabul iki dosya var + README link
  - [ ] `CONTRIBUTING.md`: dev-env (`npm run ready`), conventional-commit, kalite-kapısı tsc→vitest→lint, PR akışı
  - [ ] `CODE_OF_CONDUCT.md`: Contributor Covenant

### Phase V1-b — Sürüm hijyeni
- [ ] **M-021** VERSION + package semver — `package.json` (react-example@0.0.0), `VERSION` (yok) · kabul `node -p "require('./package.json').version"` = gerçek semver && `cat VERSION` eşleşir
  - [ ] `package.json` name `ollamas` + version `1.24.0`
  - [ ] `VERSION` dosyası tek-kaynak (1.24.0)
  - [ ] `tests/version-consistency.test.ts` (package.version === VERSION)
- [ ] **M-025** canonical PLAN notu (Emre-gate) — `PLAN.md`, `docs/ROADMAP-vNext.md` · kabul `head -2 PLAN.md` canonical içerir
  - [ ] her ikisinin başına `> canonical: planlama/16-VERSIYON-YOLHARITASI.md`

### Kabul (V1 shipped): `grep -ci "mission control.*mesh" README.md`=0 · `node -p version`=1.24.0 · `cat VERSION`=1.24.0 · CONTRIBUTING+CoC var · `npm run lint` yeşil · `git tag v1.24.0`
### Çıkış → V2 ilk todo: M-031 (custom-openai dropdown bug — `ReactAgentTab.tsx:211`)

---

## V2 — Kendi Modelini Getir (v1.25.0) · Kullanılabilir: ✅ İLK KULLANILABİLİR

Tema: kullanıcı kendi/tercih modelini (yerel ollama, custom-openai, catalog provider) bağlayıp agent'ta
gerçekten kullanabilsin.

### Phase V2-a — Provider-wiring (gerçek bug)
- [ ] **M-031** custom-openai + catalog dropdown — `src/components/ReactAgentTab.tsx:211-221` · kabul `vitest run tests/ui/react-agent-providers` yeşil
  - [ ] `providers` dizisine `custom-openai` ekle (KeyVault CUSTOM_OPENAI_PRESETS)
  - [ ] catalog provider'ları (groq/cerebras/zai/sambanova/nvidia-nim) key-var-ise dinamik göster
  - [ ] `tests/ui/react-agent-providers.test.tsx` — key-var provider dropdown'da görünür
  - [ ] mutasyon-doğrula: provider'ı çıkar → test kırılır

### Phase V2-b — İlk-kullanım onboarding
- [ ] **M-037** first-run model wizard — `server/ai.ts:77` (throw "no local ollama model") · kabul model-yok → yönlendirici mesaj + test
  - [ ] throw yerine actionable mesaj: `ollama pull <champion>` öner
  - [ ] opsiyonel `/api/models/pull` tetik (UI buton)
  - [ ] `tests/model-onboarding.test.ts` — model-yok → pull-önerisi (throw-string değil)

### Phase V2-c — Model dokümanı
- [ ] **M-033** model-guide — kaynak `cockpit-models.ts:11`, `ai.ts:35` · kabul `docs/model-guide.md` var + VRAM tablosu
  - [ ] VRAM/RAM tablosu (8B/14B/30B/70B gereksinimi)
  - [ ] champion neden qwen3:8b · MAX_LOADED_MODELS=1 tek-GPU gerçeği
  - [ ] custom-openai endpoint kullanımı (LM Studio/vLLM/litellm)

### Kabul (V2 shipped): `vitest run tests/ui/react-agent-providers tests/model-onboarding` yeşil · custom-openai agent'tan seçilebilir · model-yok senaryosu yönlendirir · `docs/model-guide.md` var · `npm run lint` · `git tag v1.25.0`
### Çıkış → V3 ilk todo: M-029 (docs/adding-a-tool.md — `tool-registry.ts:195`)

---

## V3 — Kendi Geliştirmeni Yap (v1.26.0) · Kullanılabilir: ✅ dev-extensible

Tema: geliştirici kendi tool/skill/CLI-komutu/entegrasyonunu belgeli-yolla ekleyebilsin; mekanizmalar
olgun (S-003), boşluk yalnız dokümantasyon.

### Phase V3-a — Uzatma-noktası rehberleri
- [ ] **M-029** docs/adding-a-tool.md — `tool-registry.ts:195,852,43` · kabul dosya var + 4 tier açıklı + ToolDef örneği
  - [ ] 4 tier matrisi (safe/host/privileged/host_upstream + ne zaman) + güvenlik-gerekçe (05-TEHDIT §6)
  - [ ] `ToolDef` şablonu (schema+invoke) · inline TOOLS vs dinamik register
- [ ] **M-034** HOWTO-ADD-SKILL.md — `.claude/HOWTO-ADD-CLI.md` muadili · kabul dosya var
  - [ ] SKILL.md formatı (name+description+script) + wiring-testi geçme
- [ ] **M-035** CLI alt-komut rehberi — `cli/commands/*.ts` · kabul `cli/ADDING-A-COMMAND.md` var
  - [ ] parseArgs deseni + output ctx (TTY/--json) + help kaydı + zero-dep kuralı

### Phase V3-b — Extension Guide indeksi
- [ ] **M-030** extension-guide (dep: M-029/034/035) — `docs/extension-guide.md` · kabul 9 uzatma-noktası linkli
  - [ ] tool→adding-a-tool · MCP-consume→INTEGRATIONS · MCP-expose→openapi · skill→HOWTO-ADD-SKILL
  - [ ] CLI→ADDING-A-COMMAND · plugin→plugin.ts · API→openapi · her noktaya "nereden başla"

### Phase V3-c — Kullanıcı destek dokümanları
- [ ] **M-032** troubleshooting — `docs/troubleshooting.md` · kabul ≥5 senaryo
  - [ ] ollama-down · port-3000-çakışma · OOM(num_ctx) · health-503 · HMR-port (belirti→tanı→çözüm)
- [ ] **M-040** API quickstart — `server/openapi.ts` · kabul çalışan curl örneği
  - [ ] key al → ilk `/mcp` JSON-RPC → tool listesi → tool çağırma

### Kabul (V3 shipped): adding-a-tool + extension-guide + HOWTO-ADD-SKILL + ADDING-A-COMMAND + troubleshooting + api-quickstart var; extension-guide 9-nokta indeksler · `npm run lint` · `git tag v1.26.0`
### Çıkış → V4 ilk todo: M-001 (localOwnerGuard SAAS testi — `server.ts:276-294`)

---

## V4 — Güvenlik Kanıtı (v1.27.0) · Kullanılabilir: sağlamlaşır

Tema: olgun güvenliği (reconcile: çoğu zaten korumalı) regresyon-testlerine bağla + kalan gerçek-audit.

### Phase V4-a — Auth/guard testleri
- [ ] **M-001** localOwnerGuard SAAS testi — `server.ts:276-294` · kabul `vitest run tests/localowner-guard` (14 prefix × 2 mod)
- [ ] **M-002** allowlist tamlık invariant (dep: M-001) — `server.ts:285-292` · kabul DANGEROUS ⊆ guard

### Phase V4-b — Regresyon kalkanı (⊘ test-only, kod FP/DONE — 03-GAP)
- [ ] **M-003** commander execFile — `commander.ts:19-50` · **KODU DEĞİŞTİRME**, mutasyon-doğrula
- [ ] **M-004** pipeline validate-order — `server.ts:2072-2078`
- [ ] **M-005** record swallow — `store/index.ts:229-271`
- [ ] **M-006** adminGuard brute-force — `server.ts:2563-2593`
- [ ] **M-007** providers safeParse — `providers.ts:204`

### Phase V4-c — Gerçek güvenlik-audit
- [ ] **M-008** workflow lint (ref_name env) — `.github/workflows/release-binary.yml:86` · kabul actionlint temiz
- [ ] **M-009** ReDoS audit — `threatfeed.ts:72-73` · kabul `semgrep --severity ERROR server/` ReDoS=0
- [ ] **M-010** colab urllib scheme guard — `colab_exec.py` · kabul `file://` reddedilir
- [ ] **M-011** docker-compose read-only — `docker-compose*.yml` · kabul `read_only:true` + writable-fs semgrep=0

### Kabul (V4 shipped): `semgrep scan --config auto --severity ERROR server/ .github/ \| jq '.results\|length'` = 0 · `vitest run tests/localowner-guard tests/commander-exec tests/pipeline-validate tests/store-record-swallow tests/admin-guard tests/providers-safeparse tests/threatfeed-redos` yeşil · `git tag v1.27.0`
### Çıkış → V5 ilk todo: M-012 (migration uniqueness testi)

---

## V5 — Test Bütünlüğü (v1.28.0) · Kullanılabilir: CI güvenilir

Tema: tüm suite FRESH yeşil + lane/branch hijyeni; CI'a güvenilir taban.

### Phase V5-a — Migration + skip hijyeni
- [ ] **M-012** migration uniqueness testi (⊘) — `migrations.ts:170-181` · kabul dup-version → throw
- [ ] **M-014** skipped test gerekçe-belge — 22 call-site · kabul `grep -rn skip tests \| wc -l`=22 hepsi "gated:"

### Phase V5-b — FRESH suite (BARRIER)
- [ ] **M-013** FRESH suite + e2e (dep: M-001..012 + tüm yeni testler) — `vitest.config.ts`, `playwright.config.ts`
  - [ ] `vitest run` → 0 failed
  - [ ] `npm run test:e2e` → 0 failed
  - [ ] fail varsa 03-GAP'e yeni satır (systematic-debugging)

### Phase V5-c — Lane/branch hijyeni
- [ ] **M-015** audit/* + divergent konsolidasyon (Emre-gate) — 67 audit/* + gateway-v2/v1.8-bench · kabul `git branch --list 'audit/*' \| wc -l` ≤ hedef + kayıt
- [ ] **M-016** iç worktree prune — 6 `claude/*` + completion-integration · kabul iç-worktree=0 (canlı-süreç kontrolü ile)

### Kabul (V5 shipped): `vitest run` 0 fail · `npm run test:e2e` 0 fail · `git branch --list 'audit/*'` ≤ hedef · iç-worktree=0 · `git tag v1.28.0`
### Çıkış → V6 ilk todo: M-017 (billing e2e zincir testi)

---

## V6 — Ürün & Gelir (v1.29.0) · Kullanılabilir: gelir-hazır

Tema: billing uçtan-uca kanıtlı + performans eşiği + i18n parite.

### Phase V6-a — Billing zinciri
- [ ] **M-017** billing e2e — `billing/stripe.ts`, `store/index.ts` · kabul `vitest run tests/billing-e2e-chain` (checkout→webhook→meter→rollup)

### Phase V6-b — Performans
- [ ] **M-018** Lighthouse RUN (dep: M-013) — `lighthouserc.json`, `budget.json` · kabul `npx lighthouse … --output=json` eşik-geçer
  - [ ] `npm run build` (dist) → Lighthouse koş → LCP≤2500/CLS≤0.1/perf≥0.85

### Phase V6-c — i18n
- [ ] **M-019** i18n key-count parite — `src/locales/{en,tr}.ts`, `tests/ui/i18n.test.tsx` · kabul fark=0 assert

### Kabul (V6 shipped): billing-chain yeşil · Lighthouse eşik-geçer · i18n fark=0 · `git tag v1.29.0`
### Çıkış → V7 ilk todo: M-038 (per-model ayar UI)

---

## V7 — Gelişmiş Model Kontrolü (v1.30.0) · Kullanılabilir: güç-kullanıcı

Tema: model-başına ayar + custom-model import; güç-kullanıcı BYO-model tamamlanır.

### Phase V7-a — Per-model ayar UI
- [ ] **M-038** per-model num_ctx/temperature/keep_alive/system — `providers.ts:933` (config.numCtx destekli, UI yok) · kabul UI override → request'e geçer + persist test
  - [ ] ReactAgentTab/cockpit'e override UI
  - [ ] `tests/ui/model-settings.test.tsx`

### Phase V7-b — Custom-model import
- [ ] **M-039** GGUF/Modelfile import (dep: M-033) — `tool-registry.ts:635` (bench_gguf) · kabul import akışı VEYA `docs/custom-model.md`
  - [ ] `ollama create -f Modelfile` akışı (API/CLI) VEYA GGUF→Modelfile→create doküman

### Phase V7-c — Donanım-öneri (backlog)
- [ ] hwfit VRAM/GPU genişletme (15-KULLANICI §5) — opsiyonel
- [ ] UI'dan `ollama pull`/model-silme — opsiyonel

### Kabul (V7 shipped): per-model override çalışır + persist test · GGUF import akışı/doküman var · `git tag v1.30.0`
### Çıkış → V8 ilk todo: M-020 (cloud master-key fail-closed)

---

## V8 — Dağıtım Sağlamlığı (v1.31.0) · Kullanılabilir: self-host sağlam

Tema: install/rollback/deploy uçtan-uca kanıtlı + cloud persistence.

### Phase V8-a — Install/rollback
- [ ] **M-023** install.sh temiz-dizin (dep: M-021) — `install.sh` · kabul `(cd $(mktemp -d) && … install.sh; echo exit=$?)`=0 + `ollamas status`
- [ ] **M-024** RELEASE_ROLLBACK tatbikat — `docs/RELEASE_ROLLBACK.md` · kabul tatbikat komut+çıktı 09-SEYIR'de
- [ ] **M-022** README/QUICKSTART komut spot-check (dep: M-021) — · kabul ≥10 komut exit 0 + ölü-link 0

### Phase V8-b — Deploy rehberi
- [ ] **M-036** birleşik deploy-guide — `Dockerfile`, `deploy/helm`, `deploy/k8s`, `cli/UPDATE.md` · kabul `docs/deploy-guide.md` (4 yol + stack-update)

### Phase V8-c — Cloud persistence
- [ ] **M-020** cloud master-key fail-closed — `db.ts:108-128,187-189` · kabul key'siz cloud-boot → non-zero exit (darwin etkilenmez)
  - [ ] `tests/cloud-masterkey.test.ts`

### Kabul (V8 shipped): temiz-dizin install exit 0 · rollback tatbikat kanıtlı · deploy-guide var · cloud-key fail-closed test · `git tag v1.31.0`
### Çıkış → V9 ilk todo: M-041 (CHANGELOG oluştur)

---

## V9 — Gözlemlenebilirlik & Cila (v1.32.0) · Kullanılabilir: üretim-cilası

Tema: full-E2E acceptance + docs bütünlüğü + CHANGELOG + observability doğrulama.

### Phase V9-a — Sürüm-notları
- [ ] **M-041** CHANGELOG.md — git tag geçmişi (v1.21→v1.32) · kabul `CHANGELOG.md` var + Keep-a-Changelog formatı
  - [ ] release-notes şablonu (her versiyon Added/Fixed/Changed)

### Phase V9-b — Full-E2E acceptance
- [ ] **M-042** full-E2E acceptance koşumu — · kabul tek-geçiş kanıt 09-SEYIR'de
  - [ ] `vitest run` + `npm run test:e2e` + `npm run conformance` + temiz-install — hepsi yeşil, tek oturumda
- [ ] **M-043** docs cross-link sweep — · kabul README↔QUICKSTART↔docs/* link + ölü-link 0
  - [ ] extension-guide tamlık + tüm docs birbirine linkli

### Phase V9-c — Observability doğrulama
- [ ] observability verify — `/api/health` + RUM + telemetri panel · kabul health 200 + RUM sağlıklı (06-KOR-NOKTA boyut-11 taze-damga)

### Kabul (V9 shipped): CHANGELOG var · full-E2E tek-geçiş yeşil · ölü-link 0 · observability taze-damga · `git tag v1.32.0`
### Çıkış → V10 ilk todo: M-044 (GA-gate — 02-DOD %100 yeniden-doğrula)

---

## V10 — v-FINAL / GA (v1.33.0 · GA, alias v2.0.0 ops.) · Kullanılabilir: ✅ ÜRETİME HAZIR

Tema: Opus kapanış-gate — tüm DoD + kör-nokta kanıtla, GA ilan.

### Phase V10-a — DoD full-verify (Opus gate, implementer≠verifier)
- [ ] **M-044** GA-gate — `planlama/02-DOD.md` (D1-D23) · kabul her satır komut+çıktı ile ✅ (Opus bağımsız)
  - [ ] 02-DOD D1-D23 her satır yeniden-doğrula (uygulayıcı kanıtına güvenme)
  - [ ] hiçbir GAP açık değil VEYA Emre-onaylı kabul-edilen-risk (05 §5)

### Phase V10-b — Kör-nokta final-scan
- [ ] 06-KOR-NOKTA 14-boyut ≤30 gün taze-damga · kabul her boyut tarama+tarih

### Phase V10-c — GA ilan
- [ ] `git tag v1.33.0` (GA) · onay kaydı 09-SEYIR · CHANGELOG GA-satırı
- [ ] Outward-facing (npm publish / release) = Emre açık kararı (00-ANAYASA §3.10)

### Kabul (V10 shipped = v-FINAL): 02-DOD %100 ✅ · 06-KOR-NOKTA 14-boyut taze · Opus onay 09-SEYIR · `git tag v1.33.0`
### Çıkış → **PROJE UÇTAN-UCA HAZIR. Kullanıma açık.**

---

## Faz → Versiyon köprüsü

| 04-FAZLAR fazı | Versiyon(lar) | Not |
|---|---|---|
| P6a (kimlik) | V1 | öne alındı (usability-first) |
| P6b (BYO-model UX) | V2, V7 | V2 temel, V7 gelişmiş |
| P6b (DX docs) | V3 | geliştirici-uzatma |
| P2 (güvenlik) | V4 | reconcile: çoğu regresyon-testi |
| P3 (test/lane) | V5 | FRESH-suite barrier |
| P4 (ürün/UX) | V6 | billing/perf/i18n |
| P5 (release) | V1(sürüm), V8 | sürüm V1'e, install/deploy V8 |
| V9-V10 tamamlayıcı | V9, V10 | CHANGELOG/E2E/GA-gate (yeni M-041..044) |

**Yürütme sırası = bu dosya (16). Bağımlılık-yapısı = 13-BAGIMLILIK. Atomik-görev = 10-MIKRO.**
