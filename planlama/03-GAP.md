# 03-GAP — mevcut durum → v-FINAL gap tablosu

> DoD (02) eksenleri × mevcut envanter (01) × threat model (05) × kör-nokta (06) farkı.
> Kaynak triage: `NEXT_TODO.md` (2026-06-21 cycle-2). **Stale-severity uyarısı (00-ANAYASA §3.7):**
> NEXT_TODO'daki bazı P0'lar derin-audit ile FP'ye düştü (path-traversal guard VAR) veya değeri
> değişti (npm audit 7→3) — bu tablo CANLI ölçümü esas alır, kopyalamaz.
> Her gap faz oturumunda güncellenir: kapatınca `[x]` + KANIT bloğu. Damga: 2026-07-10 · c5ac42d.
>
> **⚠️ RECONCILE (S-001, 2026-07-10, canlı kod okuması):** NEXT_TODO'dan tohumlanan güvenlik
> gap'lerinin çoğu ZATEN FIX'Lİ veya FP çıktı — DURUM sütunu canlı anchor'la işaretli. Gerçek kalan
> iş `10-MIKRO.md`'de M-id ile atomize edildi. Mimari harita: `11-MIMARI.md`.

## Severity: 🔴 P0 → 🟡 P1 → 🔵 P2 → ⚪ P3 · DURUM: ✅DONE · FP · ⬇downgrade · **gerçek**

## Gap tablosu (reconcile edilmiş)

| ID | Boyut | Sev | DURUM (canlı anchor) | DoD | Gap özeti | Mikro | Kabul-komutu |
|---|---|---|---|---|---|---|---|
| GAP-001 | güvenlik | 🔴→🟡 | ⬇ **RCE mitige** — `localOwnerGuard` server.ts:276-294 SaaS'ta 403; kalan = test+allowlist tamlık | D2 | dashboard route'ları SaaS'ta guard'lı; per-tenant auth yok (owner-only, tasarım) | M-001, M-002 | `vitest run tests/localowner-guard*` yeşil + allowlist tamlık |
| GAP-002 | güvenlik | 🔴 | ✅**DONE/FP** — `commander.ts:46` zaten `execFile` argv-array; yorum 6-9 eski `exec()` sink'ini belgeliyor | D3 | command-injection zaten kapatılmış; yalnız regresyon testi | M-003 | `vitest run tests/commander-exec*` injection reddi yeşil |
| GAP-003 | güvenlik | 🟡 | ✅**DONE/FP** — `/api/pipeline` validate (server.ts:2072-2074) SETHEADER'dan (2076-2078) ÖNCE | D3/T-03 | sıra zaten doğru; yorum 2070-2071 bilinçli | M-004 | pipeline empty-prompt→400 testi yeşil |
| GAP-004 | güvenlik | 🟡 | ⬇ **iç-swallow var** — `recordUsage/recordAudit` (store/index.ts:229,266) try/catch swallow; unhandled-rejection YOK, yalnız ordering | D10/T-08 | rejection riski yok; ordering garantisi opsiyonel | M-005 | best-effort swallow testi (DB-fail→throw-yok) |
| GAP-005 | güvenlik | 🟡 | ✅**DONE/FP** — adminGuard rate-limit MEVCUT (server.ts:2563-2574, MAX_FAILS=5, lock 15dk, timing-safe) | T-04 | throttle zaten var | M-006 | brute-force→429 regresyon testi |
| GAP-006 | güvenlik | 🟡 | ✅**DONE/FP** — `safeParse` (providers.ts:204) tool-call metnini sarıyor (209/213/219); ham `JSON.parse(tc.function.arguments)` dosyada YOK | T-05 | guard zaten uygulanmış | M-007 | bozuk-JSON→fallback testi |
| GAP-007 | CI | 🟡 | ✅**DONE/FP** — `release-binary.yml:86` `REF: ${{github.ref_name}}` env ara-değişken; yorum 73 injection'a karşı | D14/T-06 | env-fix zaten var | M-008 | `actionlint` / workflow lint temiz |
| GAP-008 | güvenlik | 🟡→🔵 | **gerçek (küçük)** — `new RegExp` server/ içinde yalnız 3 (threatfeed.ts:72-73 bounded, memory-stats.ts:21 static); "×18" semgrep repo-geneli düşük-risk | D4/T-11 | ReDoS audit: threatfeed dynamic pattern doğrula | M-009 | `semgrep scan --severity ERROR` yeni=0 + threatfeed anchor/escape |
| GAP-009 | güvenlik | 🔵 | **gerçek** — colab_exec.py file:// scheme guard yok (colab lane, python) | T-10 | urllib scheme allowlist | M-010 | urllib scheme allowlist testi |
| GAP-010 | güvenlik | ⚪ | **gerçek** — docker-compose writable-fs | T-09 | `read_only: true` + tmpfs | M-011 | compose config denetimi |
| GAP-011 | test | 🔴→🔵 | ⬇ **uniqueness assert VAR** — migrations.ts:170-181 `seenVersions` Set + throw; divergent-lane collision MERGE-anı (mevcut branch'te yok) | D8 | mevcut branch temiz; reconcile kararı gateway-v2/v1.8-bench merge'de | M-012 | `grep version migrations.ts` = 6 + dup-assert testi yeşil |
| GAP-012 | test | 🟡 | **gerçek** — full-suite + e2e FRESH koşulmadı (son damga 2026-06-21) | D6/D7 | canlı doğrulama | M-013 | `vitest run` 0 fail + `npm run test:e2e` 0 fail |
| GAP-013 | test | ⚪ | **gerçek** — 22 skipped (12-TEST-PLANI skip-map), hepsi env-gate soft-skip, gerekçe-belge yok | D6 | her skip'e `// gated:` + docs/TESTING.md tablo | M-014 | `grep -rn skip tests` = 22, hepsi "gated:" |
| GAP-014 | lane hijyeni | 🔵 | **gerçek** — 67 `audit/*` + divergent lane | D9 | konsolidasyon kararı | M-015 | `git branch --list 'audit/*' \| wc -l` ≤ hedef + kayıt |
| GAP-015 | lane hijyeni | 🔵 | **gerçek** — 6 iç `claude/*` + completion-integration/audit-cont worktree | D9 | prune (canlı-süreç/kaza-dirty kontrolü ile) | M-016 | iç worktree = 0 |
| GAP-016 | billing | 🟡 | **gerçek** — stripe.ts + parça testler VAR; uçtan-uca zincir tek-testte kanıt YOK | D10 | checkout→webhook→meter→rollup e2e | M-017 | zincir testi yeşil + test-mode kanıt |
| GAP-017 | performans | 🟡→🔵 | ⬇ **config VAR** — `lighthouserc.json` (perf≥0.85, LCP≤2500) + `budget.json` mevcut; RUN edilmemiş | D11 | Lighthouse RUN + eşik-doğrula | M-018 | `npx lighthouse` json eşik-geçer |
| GAP-018 | i18n | 🟡 | **gerçek (küçük)** — en/tr 159 key parite VAR; `tests/ui/i18n.test.tsx` var ama key-count assert YOK | D12 | key-count parite assert ekle | M-019 | `vitest run tests/ui/i18n*` fark=0 assert |
| GAP-019 | persistence | 🔵 | **gerçek (darwin-dışı)** — Cloud master-key boot regenerate (ROADMAP T3.1) | D2/T-07 | Secret Manager + fail-closed | M-020 | key'siz cloud-boot fail-closed testi |
| GAP-020 | hijyen | 🟡 | **gerçek** — `package.json` react-example@0.0.0; VERSION dosyası YOK | D17 | gerçek ad+semver + VERSION tek-kaynak | M-021 | `node -p version` gerçek semver |
| GAP-021 | docs | 🟡 | **gerçek** — README/QUICKSTART komut-güncelliği doğrulanmadı | D16 | ≥10 komut spot-check + ölü link | M-022 | ≥10 komut exit 0 + link=0 |
| GAP-022 | release | 🟡 | ⬇ **install.sh VAR** (DRY_RUN'lı) + RELEASE_ROLLBACK.md VAR (144 satır); temiz-makine + tatbikat koşulmadı | D13/D15 | install temiz-dizin + rollback tatbikat | M-023, M-024 | temiz-dizin `install.sh` exit 0 + rollback kanıt |
| GAP-023 | canonical plan | ⚪ | **gerçek** — kök PLAN.md eski "Genesis" | — | canonical notu (Emre onayı) | M-025 | PLAN.md başına canonical notu |

**Reconcile özeti (P0-P5):** 5 FP/DONE (GAP-002,003,005,006,007), 4 downgrade (001,004,011,017,022), 
14 gerçek. Kodlama yükü ilk sanılandan KÜÇÜK — çoğu güvenlik zaten çözülü; kalan iş test-coverage +
release-hijyen + lane-konsolidasyon ağırlıklı.

## P6 — Benimseme/DX gap'leri (dogfooding S-003, kaynak: 15-KULLANICI-IHTIYAC)

> Persona journey-tracing (BYO-model / geliştirici / onboarding). **Mekanizmalar olgun; boşluk
> kullanıcıya-dönük dokümantasyon + birkaç UX-wiring.** Anchor'lar 15-KULLANICI-IHTIYAC'ta.

| ID | Boyut | Sev | DURUM (canlı anchor) | DoD | Gap özeti | Mikro | Kabul-komutu |
|---|---|---|---|---|---|---|---|
| GAP-024 | onboarding | 🔴 | **gerçek** — `README.md:1` "LLM Mission Control mesh" kurgusal ürün anlatıyor | D23 | README gerçek ollamas onboarding (QUICKSTART hizalı) | M-026 | `grep -ci "mission control.*mesh" README.md` = 0 kurgu |
| GAP-025 | onboarding | 🔴 | **gerçek** — `setup.sh` olmayan `bin/main.go`/`go build` arıyor (eski Genesis) | D23 | kaldır veya `npm run ready`e yönlendir | M-027 | `bash -n setup.sh` + `go build` referansı yok |
| GAP-026 | docs | 🟡 | **gerçek** — `CONTRIBUTING.md`/`CODE_OF_CONDUCT.md` YOK | D22 | dev-env + branch/commit + test-gate | M-028 | dosyalar var + QUICKSTART link |
| GAP-027 | docs/DX | 🟡 | **gerçek** — tool ekleme kod-olgun (`tool-registry.ts:195,852`), HOWTO yok | D22 | `docs/adding-a-tool.md` (tier matrisi + ToolDef şablonu) | M-029 | dosya var + 4 tier açıklı + örnek |
| GAP-028 | docs/DX | 🟡 | **gerçek** — 9 uzatma noktası dağınık (AGENTS/INTEGRATIONS/HOWTO-ADD-CLI) | D22 | Extension Guide tek indeks | M-030 | dosya var + 9 nokta linkli |
| GAP-035 | UX/kod | 🟡 | **gerçek bug** — custom-openai + catalog KeyVault'ta girilebiliyor, `ReactAgentTab.tsx:211` dropdown'da YOK | D21 | dropdown'a ekle | M-031 | dropdown'da seçilebilir + test |
| GAP-031 | docs | 🟡 | **gerçek** — troubleshooting/FAQ yok (ollama-down/port/OOM/503) | D22 | `docs/troubleshooting.md` | M-032 | dosya var + 5 senaryo |
| GAP-032 | docs | 🟡 | **gerçek** — model kılavuzu yok (VRAM/model seçimi) | D21 | `docs/model-guide.md` | M-033 | dosya var + VRAM tablosu |
| GAP-029 | docs/DX | 🔵 | **gerçek** — HOWTO-ADD-SKILL yok (HOWTO-ADD-CLI muadili) | D22 | skill ekleme rehberi | M-034 | dosya var |
| GAP-030 | docs/DX | 🔵 | **gerçek** — CLI alt-komut ekleme rehberi zayıf | D22 | `cli/commands/*` deseni belge | M-035 | rehber var |
| GAP-033 | docs | 🔵 | **gerçek** — deploy parçalı + stack-update yok | D22 | birleşik deploy-guide | M-036 | `docs/deploy-guide.md` var |
| GAP-034 | UX/kod | 🔵 | **gerçek** — model yoksa `ai.ts:77` throw; wizard yok | D21 | first-run model-pull wizard/net-mesaj | M-037 | model-yok → yönlendirici mesaj + test |
| GAP-037 | UX/kod | 🔵 | **gerçek** — model-başına ayar global (`providers.ts:933`) | D21 | per-model num_ctx/temp/keep_alive UI | M-038 | UI override + persist test |
| GAP-036 | kod | ⚪ | **gerçek** — GGUF/Modelfile import yok (yalnız bench_gguf) | D21 | `ollama create` akışı veya doküman | M-039 | import akışı veya belge |
| GAP-038 | docs | ⚪ | **gerçek** — OpenAPI var, "key al→ilk /mcp" quickstart yok | D22 | API quickstart | M-040 | örnekli quickstart var |

**P6 özeti:** 15 gerçek gap. **2 kod-bug/UX** (GAP-035 gerçek bug, GAP-034/037/036 UX), **13 dokümantasyon**.
Kimlik-borcu kümesi: GAP-024+025 (+P5 GAP-020+023) = repo gerçek kimliğini yansıtmıyor (15 §4).

## V9-V10 — GA-yolu tamamlayıcı gap'leri (S-004, 16-VERSIYON)

| ID | Boyut | Sev | DURUM | DoD | Gap özeti | Mikro | Kabul-komutu |
|---|---|---|---|---|---|---|---|
| GAP-039 | docs | 🔵 | **gerçek** — CHANGELOG YOK (tag v1.21→v1.23 var, sürüm-notu yok) | D16 | Keep-a-Changelog | M-041 | `CHANGELOG.md` var + geçmiş |
| GAP-040 | test | 🟡 | **gerçek** — full-E2E tek-geçiş acceptance kanıtı yok | D6/D7 | vitest+e2e+conformance+install tek-oturum | M-042 | 4 komut 0-fail 09-SEYIR'de |

**GA-yolu:** V9 (M-041,042,043) + V10 (M-044 GA-gate) = "uçtan uca hazır" son adımlar. Yürütme: 16-VERSIYON.

## Completeness-critic gap'leri (S-006, GAP-001..040 dışında — doğrulanmış eksik)

> Çoğu boyut ZATEN kapsanıyor (a11y, backup, coverage %95, Prometheus /metrics, rate-limit). Bu 5 gerçek eksik.

| ID | Boyut | Sev | DURUM (canlı) | Ver | Gap özeti | Mikro | Kabul |
|---|---|---|---|---|---|---|---|
| GAP-041 | test/migration | 🟡 | **gerçek** — `migrations.ts` down/rollback fn YOK (grep=0), forward-only | V5 | migration rollback/down yolu | M-045 | down-migration + rollback testi |
| GAP-042 | release/platform | 🟡 | **gerçek** — `install.sh` Docker/macOS-first, Linux-native yok (apt/yum grep=0) | V8 | çoklu-platform install (Linux) | M-046 | Linux'ta install exit 0 (veya CI matrix) |
| GAP-043 | güvenlik/gizlilik | 🔵 | **gerçek** — GDPR erasure/export endpoint YOK (grep=0); retention prune var | V6 | self-service veri-silme + export | M-047 | `/api/account/{delete,export}` + test |
| GAP-044 | i18n | ⚪ | **gerçek** — RTL + `Intl` format YOK (grep=0); GAP-018 sadece key-parite | V6 | RTL yön + Intl tarih/sayı | M-048 | RTL dir + Intl format testi |
| GAP-045 | observability | ⚪ | **gerçek** — exception-aggregation/alert YOK (sentry grep=0); /metrics var | V9 | harici error-tracking/alerting | M-049 | error-aggregation hook + alert eşiği |

## FP / yeniden-açma YASAK (00-ANAYASA §3.7 — canlı doğrulandı S-001)

- **commander.ts command-injection** → `execFile` argv-array VAR (satır 46). **Kodu değiştirme, yalnız test.**
- **path-traversal `files.ts`/`commander.ts`** → `resolve`+`startsWith(root+sep)` guard VAR (commander.ts:35-38 kanıtlı).
- **adminGuard throttle** → MEVCUT (2563-2574). **pipeline validate sırası** → doğru (2072-2078).
- **providers JSON.parse** → `safeParse` sarılı (204). **release ref_name** → env-var (86).
- **migration uniqueness** → assert VAR (170-181). Vault AES-GCM → zayıflık yok. MCP subscribe → guard+test var.
- gcm-no-tag-length ×2 → muhtemel FP; M-009 kapsamında doğrula, gerçek değilse nosemgrep+gerekçe.

## Kaynak eşlemesi

`NEXT_TODO.md` satırları → GAP: shell-injection→GAP-007, path-traversal→FP, command-injection→GAP-002,
auth-boundary→GAP-001, SSE-validate→GAP-003, unawaited→GAP-004, admin-throttle→GAP-005,
JSON.parse→GAP-006, migration-v3→GAP-011, divergent-lane→GAP-014, npm-audit→D5, ReDoS→GAP-008.
`docs/ROADMAP-vNext.md` T3.1→GAP-019, T2.1→(P4 performans backlog, ayrı).
