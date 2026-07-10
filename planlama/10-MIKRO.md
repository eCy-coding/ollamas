# 10-MIKRO — atomik mikro-görev registry

> "En küçük mikro" katmanı. Her gerçek iş = `M-xxx` düğümü. 03-GAP reconcile sonrası kalan iş
> atomize edildi. Her satır ZORUNLU alan: `anchor` (file:line) · `action` · `test` (yazılacak dosya) ·
> `kabul` (komut) · `dep` · `size` · `durum`. Boş alan = eksik mikro-görev (kör nokta).
> Test iskeletleri: `12-TEST-PLANI.md`. Bağımlılık DAG: `13-BAGIMLILIK.md`. Damga: 2026-07-10 · c5ac42d.
>
> Boyutlar: XS ≤30dk · S ≤2s · M ≤1gün. Durum: ☐ açık · ◐ devam · ✅ kanıtlı · ⊘ FP-testonly.

---

## P2 — Güvenlik (reconcile sonrası: çoğu regresyon-testi)

### M-001 · V4 · ✅ · GAP-001 · localOwnerGuard SAAS davranış testi
- **anchor:** `server.ts:276-294` (localOwnerGuard + prefix `app.use`)
- **action:** `SAAS_ENFORCE=1` iken korunan her prefix'in 403 döndüğünü, `unset` iken next()'e geçtiğini doğrulayan test. Kod DEĞİŞMEZ.
- **test:** `tests/localowner-guard.test.ts` (yeni) — supertest/fetch ile her prefix.
- **kabul:** `vitest run tests/localowner-guard` → korunan 14 prefix × 2 mod yeşil.
- **dep:** yok · **durum:** ☐

### M-002 · V4 · ✅ · GAP-001 · allowlist tamlık denetimi (invariant testi)
- **anchor:** `server.ts:285-292` (prefix listesi) vs tehlikeli route tanımları (1399-2050)
- **action:** tehlikeli route prefix'lerinin (terminal/macos-terminal/pipeline/workspace/agent/keys/cluster/backup/security/generate/ai) HEPSİNİN localOwnerGuard listesinde olduğunu assert eden invariant testi. Yeni tehlikeli prefix eklenince test kırılır (regresyon kalkanı).
- **test:** `tests/localowner-guard.test.ts` (aynı dosya, invariant `describe`)
- **kabul:** DANGEROUS_PREFIXES ⊆ guard listesi assert yeşil.
- **dep:** M-001 · **durum:** ☐

### M-003 · V4 · ✅ · GAP-002 · commander execFile regresyon testi
- **anchor:** `server/commander.ts:19-50` (`execute`, execFileP, allowlist, python3 traversal guard)
- **action:** (a) allowlist-dışı komut → throw, (b) `args` içinde `; rm -rf` metachar → shell'e ULAŞMAZ (execFile argv), (c) python3 `../` traversal → "Path traversal blocked". Kod DEĞİŞMEZ.
- **test:** `tests/commander-exec.test.ts` (yeni)
- **kabul:** `vitest run tests/commander-exec` → 3 case yeşil; injection stdout'a sızmaz.
- **dep:** yok · **durum:** ⊘ (test-only, kod FP)

### M-004 · V5 · ✅ · GAP-003 · pipeline validate-order regresyon testi
- **anchor:** `server.ts:2050,2072-2078` (`/api/pipeline`, validate→setHeader)
- **action:** empty/eksik prompt → 400 JSON (SSE header'dan önce). Kod DEĞİŞMEZ.
- **test:** `tests/pipeline-validate.test.ts` (yeni)
- **kabul:** empty-prompt → status 400, `content-type` text/event-stream DEĞİL.
- **dep:** yok · **durum:** ⊘

### M-005 · V4 · ✅ · GAP-004 · recordUsage/recordAudit swallow testi
- **anchor:** `server/store/index.ts:229-237, 266-271`
- **action:** DB-fail enjekte → `recordUsage/recordAudit` throw ETMEZ (best-effort swallow). Kod DEĞİŞMEZ.
- **test:** `tests/store-record-swallow.test.ts` (yeni)
- **kabul:** mock DB reject → çağrı resolve/void, unhandled-rejection yok.
- **dep:** yok · **durum:** ⊘

### M-006 · V5 · ✅ · GAP-005 · adminGuard brute-force regresyon testi
- **anchor:** `server.ts:2563-2593` (adminFailures, MAX_FAILS=5, LOCK_MS, timing-safe)
- **action:** 5 yanlış token → 429 + Retry-After. Kod DEĞİŞMEZ.
- **test:** `tests/admin-guard.test.ts` (yeni)
- **kabul:** 6. deneme 429; timing-safe compare kullanılıyor.
- **dep:** yok · **durum:** ⊘

### M-007 · V4 · ✅ · GAP-006 · providers safeParse fallback testi
- **anchor:** `server/providers.ts:204,209-219`
- **action:** bozuk tool-call JSON → `safeParse` undefined → fallback (throw yok). Kod DEĞİŞMEZ.
- **test:** `tests/providers-safeparse.test.ts` (veya mevcut `tests/providers-guard.test.ts`'e ekle)
- **kabul:** bozuk-JSON fixture → provider düşmez.
- **dep:** yok · **durum:** ⊘

### M-008 · V4 · ✅ · GAP-007 · workflow lint (ref_name env doğrula)
- **anchor:** `.github/workflows/release-binary.yml:73,86,92`
- **action:** `actionlint` (veya manuel grep) ile `${{ github.ref_name }}` yalnız `env:` içinde; `run:` gövdesinde interpolation YOK.
- **test:** yok (lint doğrulama)
- **kabul:** `grep -n 'ref_name' .github/workflows/*.yml` → yalnız `env:` satırı; `actionlint` temiz.
- **dep:** yok · **durum:** ☐

### M-009 · V4 · ✅ · GAP-008 · ReDoS audit (threatfeed dynamic RegExp)
- **anchor:** `server/threatfeed.ts:72-73` (`new RegExp` dynamic `name`), `server/memory-stats.ts:21` (static)
- **action:** threatfeed `name` kaynağını izle (user-controlled mi?); user-controlled ise **RE2 (linear-time) + escape + anchor** (17-§C M-009; escape-tek yeterli değil) veya string-match. memory-stats static → nosemgrep+gerekçe. Repo-geneli semgrep detect-non-literal-regexp triage.
- **📚 ref:** 17-KAYNAK-KOD-ORNEKLERI §C [M-009] RE2 pattern
- **test:** `tests/threatfeed-redos.test.ts` (yeni) — patolojik input timeout-suz.
- **kabul:** `semgrep scan --config auto --severity ERROR server/` → ReDoS ERROR=0; threatfeed testi <100ms.
- **dep:** yok · **durum:** ☐

### M-010 · V4 · ✅ · GAP-009 · colab_exec urllib scheme guard
- **anchor:** `colab_exec.py` (colab lane — `grep -rn "urllib\|urlopen" *.py`)
- **action:** urlopen öncesi scheme allowlist (`http/https`), `file://`/`ftp://` reddi.
- **test:** `colab_exec` python testi (pytest) veya JS-tarafı guard testi.
- **kabul:** `file://` scheme → reddedilir.
- **dep:** yok · **durum:** ☐ · **lane:** colab

### M-011 · V4 · ✅ · GAP-010 · docker-compose read-only
- **anchor:** `docker-compose*.yml` (`grep -rn "read_only\|tmpfs"`)
- **action:** servis(ler)e `read_only: true` + gerekli `tmpfs:` mount.
- **test:** compose config lint.
- **kabul:** `docker compose config` → read_only:true; writable-fs semgrep=0.
- **dep:** yok · **durum:** ☐ · **lane:** scripts

---

## P3 — Test / Contract / Lane

### M-012 · V5 · ✅ · GAP-011 · migration uniqueness regresyon testi
- **anchor:** `server/store/migrations.ts:14,38-181` (v1-v6 + seenVersions throw 170-181)
- **action:** dup-version array → module-load throw doğrula (assert MEVCUT). Divergent-lane merge kararı = M-015 kapsamı.
- **test:** `tests/migration-uniqueness.test.ts` (yeni) veya mevcut `tests/migration-drift.test.ts`'e ekle
- **kabul:** dup-version → "Duplicate migration version" throw; `grep -cE 'version:' migrations.ts` = 6.
- **dep:** yok · **durum:** ⊘

### M-013 · V5 · ✅ · GAP-012 · full-suite + e2e FRESH koşumu
- **anchor:** `vitest.config.ts` (4 project), `playwright.config.ts` (8 spec)
- **action:** temiz `vitest run` + `npm run test:e2e`; fail varsa 03-GAP'e yeni satır (systematic-debugging).
- **test:** yok (koşum + kanıt)
- **kabul:** `vitest run` 0 failed; `npm run test:e2e` 0 failed; çıktı 09-SEYIR'e.
- **dep:** M-001..M-012 (yeni testler yazıldıktan sonra) · **durum:** ☐

### M-014 · V5 · ✅ · GAP-013 · skipped test gerekçe-belge
- **anchor:** 22 skip call-site (12-TEST-PLANI §skip-map): `tests/cli-keychain-live.test.ts:16`, `tests/mac-power.e2e.test.ts:58`, `tests/rag.e2e.test.ts:63`, `tests/bench-tool.e2e.test.ts:63`, `tests/litellm-provider.e2e.test.ts:34,38`, `tests/providers-live.test.ts:15,19`, `tests/truth-oracle.test.ts:204,258`, `tests/ukp-upstream.e2e.test.ts`(6×), `tests/ClusterE2ELive.test.ts:14`, +
- **action:** her skip call-site'a `// gated: <ENV> — <gerçek-infra sebebi>` yorumu + `docs/TESTING.md` skip-tablosu (dosya · env · sebep · nasıl-koşulur).
- **test:** yok (belge + grep doğrulama)
- **kabul:** `grep -rn "skip" tests --include=*.ts | wc -l` = 22; her satırda "gated:" var; docs/TESTING.md tablosu 22 satır.
- **dep:** yok · **durum:** ☐

### M-015 · V5 · ✅ · GAP-014 · audit/* branch + divergent-lane konsolidasyon
- **anchor:** `git branch --list 'audit/*'` (67), `feat/gateway-v2` + `feat/v1.8-bench` (divergent v3)
- **action:** 67 audit/* için karar (entegre/arşiv-tag/sil) — Emre onayı (eskalasyon 08 §5); divergent-lane OAuth (opaque vs JWT) + migration renumber kararı.
- **test:** yok (git işlemi + karar kaydı)
- **kabul:** `git branch --list 'audit/*' | wc -l` ≤ hedef; reconcile kararı 09-SEYIR'de.
- **dep:** M-012 (migration uniqueness netliği) · **durum:** ☐ · **eskalasyon:** Emre

### M-016 · V5 · ✅ · GAP-015 · iç worktree prune
- **anchor:** `git worktree list` — 6 iç `.claude/worktrees/*` + completion-integration + audit-cont
- **action:** her iç worktree: canlı-süreç/kaza-dirty kontrolü (SEYIR Faz 33 dersi) → temizse `git worktree remove`.
- **test:** yok
- **kabul:** `git worktree list | grep -c '.claude/worktrees'` = 0 (veya gerekçeli kalanlar kayıtlı).
- **dep:** yok · **durum:** ☐

---

## P4 — Ürün / Revenue / UX

### M-017 · V6 · ✅ · GAP-016 · billing e2e zincir testi
- **anchor:** `server/billing/stripe.ts` (createAuditCheckout, sendMeterEventAsync, constructEvent), `server/store/index.ts` (usage_events→rollup)
- **action:** test-mode zincir: checkout oluştur → webhook event simüle → meter kaydı → tenant rollup (BillingRun/BillingLine) doğrula. Mevcut parça testleri (`server/__tests__/stripe-meter.test.ts` vb.) birleştir.
- **test:** `tests/billing-e2e-chain.test.ts` (yeni)
- **kabul:** `vitest run tests/billing-e2e-chain` → checkout→webhook→meter→rollup yeşil; test-mode kanıt.
- **dep:** yok · **durum:** ☐

### M-018 · V6 · ✅ · GAP-017 · Lighthouse RUN + eşik doğrula
- **anchor:** `lighthouserc.json` (perf≥0.85 warn, LCP≤2500 error, CLS≤0.1, TBT≤300), `budget.json` (script 150KB, total 200KB)
- **action:** `npm run build` (dist) → Lighthouse koş → eşik-geçer doğrula. Eşik aşılırsa 03-GAP'e perf-gap satırı.
- **test:** yok (koşum)
- **kabul:** `npx lighthouse http://localhost:3000 --output=json` → assertions pass (LCP/CLS error-eşikleri geçer).
- **dep:** M-013 · **durum:** ☐

### M-019 · V6 · ✅ · GAP-018 · i18n key-count parite assert
- **anchor:** `src/locales/{en,tr}.ts` (159 key flat), `tests/ui/i18n.test.tsx` (çeviri var, count-assert yok)
- **action:** `tests/ui/i18n.test.tsx`'e `Object.keys(en)` === `Object.keys(tr)` (set-eşitlik) assert ekle; fark listesi boş.
- **test:** `tests/ui/i18n.test.tsx` (mevcut dosyaya `it` ekle)
- **kabul:** `vitest run tests/ui/i18n` → key-set fark=0 assert yeşil.
- **dep:** yok · **durum:** ☐

---

## P5 — Release / Dağıtım

### M-020 · P5 · M · GAP-019 · Cloud master-key fail-closed (darwin-dışı)
- **anchor:** `db.ts:108-128` (isCloud + randomBytes fallback), `db.ts:187-189` (decrypt "")
- **action:** `isCloud` iken master-key GCP Secret Manager'dan; yoksa fail-closed (boot exit). Darwin path değişmez.
- **test:** `tests/cloud-masterkey.test.ts` (yeni) — key'siz cloud-boot → non-zero exit.
- **kabul:** key'siz `isCloud` boot → fail-closed; darwin boot etkilenmez.
- **dep:** yok · **durum:** ✅ KANIT: decideMasterKeySource isCloud→fail + install.sh MASTER_KEY_B64 bootstrap; RED HEAD'de 2-fail kanıtlı, GREEN 16/16 · V8 · **not:** darwin'de tetiklenmez; deploy-kritik.

### M-021 · V1 · ✅ · GAP-020 · VERSION + package semver
- **anchor:** `package.json` (`name:"react-example", version:"0.0.0"`), `VERSION` (YOK)
- **action:** `package.json` gerçek ad (`ollamas`) + semver; `VERSION` dosyası tek-kaynak; build script'leri VERSION'dan okusun (varsa).
- **test:** `tests/version-consistency.test.ts` (yeni) — package.version === VERSION içeriği.
- **kabul:** `node -p "require('./package.json').version"` gerçek semver; `cat VERSION` eşleşir.
- **dep:** yok · **durum:** ☐

### M-022 · P5 · S · GAP-021 · README/QUICKSTART komut spot-check
- **anchor:** `README.md`, `QUICKSTART.md`
- **action:** ≥10 belgeli komutu koş (exit 0 veya belgeli ön-koşul); ölü link tara (`grep -oE 'https?://[^)]+'` + curl-head spot).
- **test:** yok (koşum + belge)
- **kabul:** ≥10 komut exit 0/belgeli; ölü link 0. Kanıt 09-SEYIR.
- **dep:** M-021 (VERSION komutları) · **durum:** ✅ KANIT: 14 koşu 11-exit-0, ölü-link 0, kırık `npm run verify` doc-fix · S-015

### M-023 · P5 · M · GAP-022 · install.sh temiz-dizin koşumu
- **anchor:** `install.sh` (DRY_RUN'lı, `set -euo pipefail`, trap)
- **action:** temiz `mktemp -d`'de `install.sh` (önce `DRY_RUN=1`, sonra gerçek) → exit 0 + `ollamas status` çalışır.
- **test:** yok (koşum)
- **kabul:** `(cd $(mktemp -d) && … install.sh; echo exit=$?)` = 0; `ollamas status` OK.
- **dep:** M-021 · **durum:** ✅ KANIT: bash-n 0 + mktemp-d DRY_RUN=1 exit-0 + `ollamas doctor` healthy (gerçek koşum dürüst-sapma: canlı :3000 + container crash-loop → V9/M-042 CI; S-015)

### M-024 · P5 · S · GAP-022 · RELEASE_ROLLBACK tatbikatı
- **anchor:** `docs/RELEASE_ROLLBACK.md` (144 satır, 5 bölüm; placeholder BAD/GOOD/PKG/TAP/REPO)
- **action:** rollback adımlarını CANLI (test-repo/dry) bir kez koş; placeholder'ları gerçek değerle doldur veya "tatbikat-only" işaretle.
- **test:** yok (tatbikat)
- **kabul:** tatbikat komut+çıktı 09-SEYIR'de; her bölüm ≥1 kez doğrulandı.
- **dep:** yok · **durum:** ✅ KANIT: 5 bölüm sandbox-drill (gh-run-list, npm-pack-dry, tap-revert, latest.json-jq, launchd-verify RESPAWN-OK) · S-015

### M-025 · P5 · XS · GAP-023 · canonical plan notu
- **anchor:** `PLAN.md` (kök, eski "Genesis"), `docs/ROADMAP-vNext.md`
- **action:** her ikisinin başına `> canonical: planlama/04-FAZLAR.md` notu (Emre onayı — 08 §4).
- **test:** yok
- **kabul:** `head -2 PLAN.md` canonical notu içerir.
- **dep:** yok · **durum:** ☐ · **eskalasyon:** Emre

---

## P6 — Benimseme/DX (dogfooding, kaynak: 15-KULLANICI-IHTIYAC · 03-GAP P6)

> 15 gerçek gap: 2 kod-bug/UX + 13 dokümantasyon. Alt-akış P6a (kimlik/onboarding, hızlı-blocker) +
> P6b (DX docs + BYO-model UX). Doküman görevleri kanıtı = dosya-var + içerik-grep (test yerine).

### M-026 · V1 · ✅ · GAP-024 · README gerçek-ürün onboarding
- **anchor:** `README.md:1` ("LLM Mission Control: Distributed Mesh" — kurgusal)
- **action:** README'yi gerçek ollamas'a yaz: MCP gateway + CLI + $0 conductor + yerel model. QUICKSTART ile hizalı. Kurgusal mesh/WASM/70B/consent-cluster içeriği kaldır. QUICKSTART'a çapraz-link.
- **test:** yok (içerik grep)
- **kabul:** `grep -ci "mission control.*mesh\|WASM sandbox\|informed consent" README.md` = 0; README başlığı gerçek ürün + `npm run ready` yolu.
- **dep:** yok · **durum:** ☐ · **not:** kimlik-borcu kümesi (GAP-020/023/025 ile)

### M-027 · V1 · ✅ · GAP-025 · setup.sh düzelt/yönlendir
- **anchor:** `setup.sh` (olmayan `bin/main.go`/`go build` arıyor)
- **action:** ya `setup.sh`'i sil + README'yi `npm run ready`e yönlendir, ya `setup.sh`'i `exec npm run ready` wrapper yap.
- **test:** yok
- **kabul:** `bash -n setup.sh` temiz + `grep -c "go build\|bin/main.go" setup.sh` = 0; çalıştırınca `ready` akışına gider.
- **dep:** M-026 (README yolu ile senkron) · **durum:** ☐

### M-028 · V1 · ✅ · GAP-026 · CONTRIBUTING + CODE_OF_CONDUCT
- **anchor:** kök (dosyalar YOK); kaynak: QUICKSTART.md + package.json scripts + 00-ANAYASA kalite kapısı
- **action:** `CONTRIBUTING.md` (dev-env `npm run ready`, branch/commit conventional, kalite kapısı tsc→vitest→lint, PR akışı) + `CODE_OF_CONDUCT.md` (standart Contributor Covenant).
- **test:** yok
- **kabul:** iki dosya var; CONTRIBUTING test-gate + commit-kuralı içerir; README linkler.
- **dep:** yok · **durum:** ☐

### M-029 · V3 · ✅ · GAP-027 · docs/adding-a-tool.md
- **anchor:** `server/tool-registry.ts:195` (TOOLS), `:852` (register), `:43` (ToolTier)
- **action:** `docs/adding-a-tool.md`: 4 tier matrisi (safe/host/privileged/host_upstream + ne zaman), `ToolDef` şablonu (schema+invoke), inline TOOLS vs dinamik register, tier-güvenlik gerekçesi (05-TEHDIT §6).
- **test:** yok
- **kabul:** dosya var; 4 tier açıklı + çalışan ToolDef örneği + tier seçim matrisi.
- **dep:** yok · **durum:** ☐

### M-030 · V3 · ✅ · GAP-028 · Extension Guide (indeks)
- **anchor:** 11-MIMARI + AGENTS.md + INTEGRATIONS.md + MCP_LANE.md + HOWTO-ADD-CLI.md
- **action:** `docs/extension-guide.md`: 9 uzatma noktası tek indeks (tool→adding-a-tool, MCP-consume→INTEGRATIONS, MCP-expose→openapi, skill→HOWTO-ADD-SKILL, CLI→cli-rehber, plugin→plugin.ts, API→openapi). Her noktaya "nereden başla" linki.
- **test:** yok
- **kabul:** dosya var; 9 uzatma noktası linkli tablo.
- **dep:** M-029, M-034, M-035 (linklediği docs) · **durum:** ☐

### M-031 · V2 · ✅ · GAP-035 · custom-openai + catalog dropdown (GERÇEK BUG — server+ui)
- **anchor:** `src/components/ReactAgentTab.tsx:211-221` (`providers` dizisi — custom-openai + catalog YOK), `KeyVault.tsx:39` (CUSTOM_OPENAI_PRESETS), `server/provider-catalog.ts` (groq/cerebras/zai/sambanova/nvidia-nim)
- **action:** `providers` dizisine `custom-openai` + catalog provider'ları ekle (key-var olanları dinamik göster). Key girilen endpoint agent'tan seçilebilsin.
- **test:** `tests/ui/react-agent-providers.test.tsx` (yeni) — key-var provider dropdown'da görünür.
- **kabul:** `vitest run tests/ui/react-agent-providers` → custom-openai + ≥1 catalog seçilebilir.
- **dep:** yok · **durum:** ☐ · **not:** gerçek kullanıcı-bug (key girilse kullanılamıyordu)
- **📚 ref:** 17-KAYNAK-KOD-ORNEKLERI §A [M-031] OpenAI baseURL seam + PRESETS (Ollama/LMStudio/vLLM/Groq)

### M-032 · V3 · ✅ · GAP-031 · docs/troubleshooting.md
- **anchor:** kaynak: `.env.example` (OLLAMA_NUM_CTX), `server.ts:143` health/ready, SEYIR gotcha'lar (port-3000, HMR-24678)
- **action:** `docs/troubleshooting.md`: 5+ senaryo — ollama-down, port-3000-çakışma, OOM (num_ctx düşür), health-503, HMR-port. Her biri: belirti → tanı → çözüm.
- **test:** yok
- **kabul:** dosya var; ≥5 senaryo belirti/çözüm.
- **dep:** yok · **durum:** ☐

### M-033 · V2 · ✅ · GAP-032 · docs/model-guide.md
- **anchor:** `server/cockpit-models.ts:11` (rankMacModels RAM-fit), `ai.ts:35` (champion qwen3:8b)
- **action:** `docs/model-guide.md`: model seçimi + VRAM/RAM tablosu (8B/14B/30B/70B gereksinimi), champion neden qwen3:8b, custom-openai endpoint kullanımı, MAX_LOADED_MODELS=1 tek-GPU gerçeği.
- **test:** yok
- **kabul:** dosya var; VRAM tablosu + model-seçim rehberi.
- **dep:** yok · **durum:** ☐

### M-034 · V3 · ✅ · GAP-029 · HOWTO-ADD-SKILL.md
- **anchor:** `.claude/HOWTO-ADD-CLI.md` (muadil desen), `.claude/skills/*/SKILL.md`, `tests/skills-wiring.test.ts`
- **action:** `.claude/HOWTO-ADD-SKILL.md`: SKILL.md formatı (name+description+script), wiring-testi geçme, slash-komut kaydı.
- **test:** yok
- **kabul:** dosya var; SKILL.md şablonu + wiring adımı.
- **dep:** yok · **durum:** ☐

### M-035 · V3 · ✅ · GAP-030 · CLI alt-komut ekleme rehberi
- **anchor:** `cli/commands/*.ts` (agent/mcp/plugin desenleri), `cli/CLI_AGENTS.md`
- **action:** `cli/ADDING-A-COMMAND.md`: parseArgs deseni, output ctx (TTY/--json), help kaydı, zero-dep kuralı, saf-fn+thin-IO.
- **test:** yok
- **kabul:** dosya var; komut-şablonu + kayıt adımı.
- **dep:** yok · **durum:** ☐

### M-036 · P6b · S · GAP-033 · birleşik deploy-guide + stack-update
- **anchor:** `Dockerfile`, `docker-compose.yml`, `deploy/helm/`, `deploy/k8s/README.md`, `cli/UPDATE.md`
- **action:** `docs/deploy-guide.md`: local/Docker/compose/Helm/k8s tek karar-ağacı + stack güncelleme (image pull/redeploy/migration) akışı.
- **test:** yok
- **kabul:** dosya var; 4 deploy yolu + update akışı.
- **dep:** yok · **durum:** ✅ KANIT: docs/deploy-guide.md karar-ağacı + local/Docker/compose/Helm-k8s + stack-update; tüm komutlar package.json/Makefile'dan doğrulandı · S-015

### M-037 · V2 · ✅ · GAP-034 · first-run model onboarding
- **anchor:** `server/ai.ts:77` (`throw "no local ollama model available"`), `scripts/ready.mjs` (qwen3:8b pull), `src/App.tsx:242` (Setup Wizard)
- **action:** model yoksa: net yönlendirici mesaj + `ollama pull <champion>` öneri/tetik (UI veya API `/api/models/pull` opsiyonel). En az throw yerine actionable mesaj.
- **test:** `tests/model-onboarding.test.ts` (yeni) — model-yok → yönlendirici hata (throw-string değil).
- **kabul:** model-yok senaryosu → kullanıcıya pull-önerisi; test yeşil.
- **dep:** yok · **durum:** ☐
- **📚 ref:** 17-KAYNAK-KOD-ORNEKLERI §A [M-037] `POST /api/pull` NDJSON stream progress

### M-038 · P6b · M · GAP-037 · per-model ayar UI
- **anchor:** `server/providers.ts:933` (`config.numCtx || db.data.ollamaNumCtx` — request override VAR, UI yok), keep_alive env
- **action:** ReactAgentTab/cockpit'e model-başına num_ctx/temperature/keep_alive/system override UI; `config.numCtx` zaten destekli, UI'dan geçir + persist.
- **test:** `tests/ui/model-settings.test.tsx` (yeni)
- **kabul:** UI override → request'e geçer + persist; test yeşil.
- **dep:** yok · **durum:** ✅ KANIT: model-overrides.ts saf-çekirdek + /api/model-overrides + ModelSettings.tsx; tsc 0 · 48/48 (5 dosya) · 62ab63c

### M-039 · P6b · S · GAP-036 · GGUF/Modelfile import
- **anchor:** `server/tool-registry.ts:635` (bench_gguf — yalnız benchmark)
- **action:** `ollama create -f Modelfile` akışı VEYA `docs/custom-model.md`. **NOT (17-§A M-039): yerel-GGUF `/api/create` blob-upload gerektirir → CLI `ollama create -f` daha pratik** — doküman CLI yolunu önersin.
- **📚 ref:** 17-KAYNAK-KOD-ORNEKLERI §A [M-039] Modelfile + CLI-nüansı
- **test:** import varsa test; doküman ise yok
- **kabul:** import akışı çalışır VEYA doküman GGUF→kullanılabilir-model yolunu belgeler.
- **dep:** M-033 (model-guide) · **durum:** ✅ KANIT: docs/custom-model.md (CLI `ollama create -f` yolu + blob-upload nüansı) + model-guide cross-link · 62ab63c

### M-040 · V3 · ✅ · GAP-038 · API quickstart
- **anchor:** `server/openapi.ts` (OpenAPI 3.1), `/api/openapi.json`, Bearer `olm_`
- **action:** `docs/api-quickstart.md`: key al → ilk `/mcp` JSON-RPC çağrısı (curl örneği) → tool listesi → tool çağırma.
- **test:** yok
- **kabul:** dosya var; çalışan curl örneği + auth adımı.
- **dep:** yok · **durum:** ☐

---

## V9-V10 — Tamamlayıcı görevler (16-VERSIYON GA-yolu)

### M-041 · V9 · S · GAP-039 · CHANGELOG.md
- **anchor:** git tag geçmişi (v1.21.0→v1.23.0 mevcut; v1.24→v1.33 gelecek); CHANGELOG YOK
- **action:** `CHANGELOG.md` (Keep-a-Changelog formatı) + release-notes şablonu; her versiyon Added/Fixed/Changed. **Otomasyon: git-cliff** (conventional-commit → CHANGELOG) — 17-§B M-041.
- **📚 ref:** 17-KAYNAK-KOD-ORNEKLERI §B [M-041] Keep-a-Changelog + git-cliff
- **test:** yok (format doğrulama)
- **kabul:** `CHANGELOG.md` var; v1.21→mevcut geçmiş + Unreleased bölümü.
- **dep:** yok · **durum:** ✅ KANIT: Keep-a-Changelog, v1.21→v1.23 git-log'dan + Unreleased 2-katman (lane-work + V1-V8 train) · 7ab149c · S-016

### M-042 · V9 · M · GAP-040 · full-E2E acceptance koşumu
- **anchor:** `vitest.config.ts`, `playwright.config.ts`, `package.json` (conformance, test:e2e), `install.sh`
- **action:** tek oturumda: `vitest run` + `npm run test:e2e` + `npm run conformance` + temiz-dizin install — hepsi yeşil, tek-geçiş kanıt.
- **test:** yok (acceptance koşumu)
- **kabul:** 4 komut 0-fail, çıktı 09-SEYIR'de damgalı.
- **dep:** M-013 (FRESH suite), M-023 (install) · **durum:** ✅ KANIT: vitest 2228/0 + PERF=1 conformance 3/3 + playwright 28/28 + DRY_RUN install exit-0 (tek-oturum, S-016); 2 e2e kök-neden fix f93705a (model-clobber + WCAG kontrast)

### M-043 · V9 · S · GAP-040 · docs cross-link sweep
- **anchor:** `README.md`, `QUICKSTART.md`, `docs/*`, `docs/extension-guide.md`
- **action:** tüm docs birbirine linkli + ölü-link taraması (`grep -oE 'https?://[^) ]+'` + relative-path kontrolü); extension-guide 9-nokta tam.
- **test:** yok
- **kabul:** ölü-link 0; README↔QUICKSTART↔docs/* çapraz-link; extension-guide tam.
- **dep:** M-026, M-030 · **durum:** ✅ KANIT: 74/74 relative + 7/7 external canlı, extension-guide 9/9, README Dokümantasyon bölümü · 7ab149c · S-016

### M-044 · V10 · M · — · GA-gate (P-FINAL operasyon)
- **anchor:** `planlama/02-DOD.md` (D1-D23), `planlama/06-KOR-NOKTA.md` (14 boyut)
- **action:** Opus gate: 02-DOD her satırı bağımsız yeniden-doğrula (implementer≠verifier); 06-KOR-NOKTA 14-boyut taze-damga; onay kaydı; `git tag v1.33.0` (GA).
- **test:** yok (denetim)
- **kabul:** 02-DOD %100 ✅ + 06-KOR-NOKTA 14-boyut ≤30gün + Opus onay 09-SEYIR + `git tag v1.33.0`.
- **dep:** M-001..043 (tüm önceki) · **durum:** ☐ · **rol:** Opus (gate)

---

## Completeness gap'leri (S-006 — GAP-041..045; S-010 — GAP-046)

### M-050 · V5 · ✅ · GAP-046 · boot-gated route test harness (S-010 keşif)
- **anchor:** `server.ts` `initializeServer()` (~585+, route'lar burada kayıtlı; export değil), `vitest.config.ts` (PERF-gated)
- **action:** `initializeServer`'ı test-edilebilir kıl (export + test-mode flag: network/DB/timer atla, VEYA handler'ları ayrı modül). M-004 (pipeline validate) + M-006 (adminGuard 429) regresyon-testlerini AÇAR.
- **test:** harness sonrası `tests/pipeline-validate.test.ts` + `tests/admin-guard.test.ts`.
- **kabul:** boot-gated route testi mümkün + M-004/M-006 yeşil.
- **dep:** yok · **durum:** ☐ · **not:** kod-doğru (anchor 2100-2104, 2596-2616) ama V4'te regresyon-test kilidi

### M-045 · V5 · ✅ · GAP-041 · migration rollback/down yolu
- **anchor:** `server/store/migrations.ts` (v1-v6 forward-only, `down` fn yok — grep=0), `runMigrations`
- **action:** her migration'a opsiyonel `down(db)` + `rollbackTo(version)` fonksiyonu; başarısız upgrade'de son sağlam versiyona dön. Uniqueness assert (170-181) korunur.
- **test:** `tests/migration-rollback.test.ts` — upgrade→down→şema eski-haline.
- **kabul:** `vitest run tests/migration-rollback` yeşil; rollback şemayı geri alır.
- **dep:** M-012 · **durum:** ☐

### M-046 · V8 · M · GAP-042 · çoklu-platform install (Linux)
- **anchor:** `install.sh` (Docker/macOS-first; apt/yum grep=0), `deploy/` (Docker/k8s var)
- **action:** `install.sh`'e Linux-native yol (apt/dnf paket + systemd unit alternatifi) VEYA en az CI-matrix (ubuntu) ile Docker-yol doğrulama + `docs/deploy-guide.md` Linux bölümü.
- **test:** CI matrix (ubuntu-latest) install smoke VEYA yerel Linux-container test.
- **kabul:** Linux'ta `install.sh` (veya Docker-yol) exit 0 + `ollamas status`.
- **dep:** M-036 (deploy-guide) · **durum:** ✅ KANIT: Docker-yol + `docker compose config -q` exit-0 + install.sh launchctl-gate Linux-toleranslı + deploy-guide Linux bölümü; ⚠ tam Linux smoke CI-ubuntu-matrix'e (dürüst not) · S-015

### M-047 · V6 · ✅ · GAP-043 · GDPR veri-silme + export
- **anchor:** `server/store/index.ts` (tenant data), `oauth-gc.ts` (retention var), erasure endpoint yok
- **action:** `POST /api/account/delete` (self-service tenant erasure — tüm veri+key sil) + `GET /api/account/export` (JSON export). Audit log'a kaydet. SaaS auth-korumalı.
- **test:** `tests/account-erasure.test.ts` — delete→veri gitti, export→tam JSON.
- **kabul:** erasure sonrası tenant verisi 0; export tam.
- **dep:** yok · **durum:** ☐

### M-048 · V6 · ✅ · GAP-044 · i18n RTL + Intl format
- **anchor:** `src/locales/{en,tr}.ts` (LTR), `src/` (Intl grep=0)
- **action:** locale'e `dir` (ltr/rtl) alanı + `<html dir>` bind; tarih/sayı `Intl.DateTimeFormat`/`NumberFormat` locale-aware. (RTL locale eklenince hazır.)
- **test:** `tests/ui/i18n-format.test.tsx` — Intl format locale'e göre; dir doğru.
- **kabul:** Intl format çalışır + dir bind test.
- **dep:** M-019 · **durum:** ☐

### M-049 · V9 · S · GAP-045 · harici error-tracking/alerting
- **anchor:** `server/metrics.ts` (/metrics var), `server/logger.ts`, exception-aggregation yok
- **action:** merkezi exception hook (`process.on('unhandledRejection'/'uncaughtException')` + Express error-middleware) → structured-log + sayaç + eşik-alert (opsiyonel webhook). Sentry-opsiyonel (env-gated), zorunlu dep değil.
- **test:** `tests/error-tracking.test.ts` — exception → aggregation kaydı + sayaç.
- **kabul:** yakalanan exception aggregation'a düşer + eşik-alert tetiklenebilir.
- **dep:** yok · **durum:** ✅ KANIT: server/error-tracking.ts ring+sayaç+webhook-alert+process-hooks, 11/11 test, yeni route yok (guard yüzeyi değişmedi) · db14cdb · S-016

---

## Özet sayaç

| Faz/Versiyon | Mikro-görev | Kod/UX-değişen | Doküman | Test-only (⊘) |
|---|---|---|---|---|
| P2/V4 | M-001..011 (11) | M-009,010,011 | — | M-002..008,012 regresyon |
| P3/V5 | M-012..016 (5) | M-015,016 (git) | M-014 | M-012 ⊘ |
| P4/V6 | M-017..019 (3) | M-017,018,019 | — | — |
| P5/V1,V8 | M-020..025 (6) | M-020,021,023,024,025 | M-022 | — |
| P6/V1,V2,V3,V7 | M-026..040 (15) | M-031,037,038,039 | M-028,029,030,032..036,040 | — |
| V9-V10 | M-041..044 (4) | M-042,044 (koşum/gate) | M-041,043 | — |
| Completeness | M-045..049 (5) | M-045,046,047,048,049 | — | — |
| **Toplam** | **49 mikro-görev** | ~26 kod/git/UX | ~15 doküman | ~8 regresyon |

**Doğrulama:** `grep -c '^### M-' 10-MIKRO.md` = 49. Her M-xxx `anchor`+`action`+`test`+`kabul`+`dep` doldurulu.
Versiyon-atama: 16-VERSIYON-YOLHARITASI (her M tam bir Vn'de).
