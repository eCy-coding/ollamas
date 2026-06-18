# SEYIR_DEFTERI_SCRIPTS.md — Scripts Domain Logbook

> Her phase ve her hata buraya işlenir (kanıt/komut çıktısı ile). Canlı ayna: `~/.llm-mission-control/seyir-defteri-scripts.jsonl` (`kind:"script_run"`), `bin/host-bridge/tools/logbook.mjs` pattern'i ile.
>
> **Entry formatı:** `[ISO ts] kind=phase|error|fix | what | evidence | green-gate sonucu`
>
> Hata sınıfları kalıcı olarak `errors_registry.json`'da; burası kronolojik anlatı.

---

## v1 — Foundation & Inventory

- `[2026-06-19] kind=phase | Governance 4 dosya kuruldu (SCRIPTS_AGENTS.md, ROADMAP_SCRIPTS.md, SEYIR_DEFTERI_SCRIPTS.md, errors_registry.json) | scripts/ altında, feat/scripts-v1 branch | gate: pending`
- `[2026-06-19] kind=phase | Branch feat/scripts-v1 main'den ayrıldı (CLI worktree izolasyonu) | git checkout -b feat/scripts-v1 | OK`

- `[2026-06-19] kind=phase | v1 commit dbb8f9c | governance 4 dosya + baseline 68/1 | gate OK`

---

## v2 — Script Test Harness

- `[2026-06-19] kind=phase | P0 shared HMAC lib | bin/host-bridge/hmac.mjs oluşturuldu (canonicalMessage/HMAC_WINDOW_MS/computeSignature/verifyHmacHeaders); terminal-bridge.mjs inline kopyayı (33-49) import ile değiştirdi; unused crypto import silindi (§7) | node --check OK`
- `[2026-06-19] kind=phase | P1 HMAC parity | scripts/tests/hmac-parity.test.ts: TS↔mjs canonicalMessage byte-identical (6 fuzz case: boş/unicode/gömülü-\n/uzun), window eşit, sign→verify çapraz, tamper reddi | 5 test pass`
- `[2026-06-19] kind=phase | P2 mock bridge | helpers/mock-bridge.mjs (paylaşılan verifyHmacHeaders) + mock-bridge.test.ts: imzalı POST kabul, tamper/eksik 401 | 4 test pass`
- `[2026-06-19] kind=phase | P3 DRY_RUN | start.sh/stop.sh/uninstall.sh DRY_RUN guard; DRY_RUN=1 bash stop.sh → [DRY], docker çağrılmadı | dryrun.test.ts 5 pass. setup/install/setup-keys/join-cluster ERTELENDİ → v6 (açık, sessiz kesme yok)`
- `[2026-06-19] kind=phase | P4 golden | tools-golden.test.ts logbook.mjs (tempdir, add/tail/limit/bad-subcmd) deterministik; class-C tool'lar bilinçli ertelendi | 4 test pass`
- `[2026-06-19] kind=phase | P5 gate | izole worktree'de tsc=0, vitest 86 pass/1 skip (68 backend + 18 scripts) | YEŞİL`

---

## v3 — iOS Bridge (Swift CLI + Shortcuts + HMAC parity)

- `[2026-06-19] kind=phase | Mimari pivot | araştırma: iOS host bridge'e erişemez (127.0.0.1) → app API tüketicisi (Bearer). ROADMAP "Swift HMAC client" yeniden hizalandı: API-client birincil + HMAC Swift mirror parity-asset | Swift 6.2.4 + Xcode teyit`
- `[2026-06-19] kind=phase | P0 Swift Package | bin/ios-bridge OllamasKit (HMAC.swift CryptoKit + Config.swift env + Client.swift URLSession) + Package.swift | swift build OK (4s)`
- `[2026-06-19] kind=phase | P1 CLI | ollamas-ios health|generate|tools (semaphore async driver) | build OK`
- `[2026-06-19] kind=phase | P2 HMAC parity | gen-vectors.mjs (hmac.mjs tek-kaynak) → hmac-vectors.json fixture; HMACParityTests.swift #filePath ile okur; ios-hmac-vectors.test.ts node drift guard | Swift 3 + node 2 test`
- `[2026-06-19] kind=phase | P3 ClientTests.swift | URL/Bearer/body/envelope/config saf assertion | 5 test`
- `[2026-06-19] kind=fix | ios-hmac-vectors.test.ts kendi test bug'ım | adversarial vector body "a\nb\nc" gömülü \n → canonical.split(\n) 7 parça (5 değil). Düzeltme: field-count yerine structural prefix/suffix check. Parity'nin kendisi geçmişti; evidence-before-claim yakaladı.`
- `[2026-06-19] kind=phase | P4 Shortcuts | bin/ios-bridge/Shortcuts/README.md reçete (binary .shortcut text-author edilemez → dokümante HTTP blok) | -`
- `[2026-06-19] kind=phase | P5 gate | swift build OK + swift test 8 pass + node vitest 88 pass/1 skip | YEŞİL`

---

## Hata Anlatıları

### ERR-SCR-001 (CRITICAL) — Paylaşılan working tree branch hijack
- `[2026-06-19] kind=error | v2 commit aşamasında git log HEAD'in feat/scripts-v1 değil c19a0b6 (v1.3 merge) olduğu görüldü; scripts/ governance dosyaları working tree'den kayıp. reflog: eşzamanlı sekme `checkout scripts-v1→main→v1.4→frontend-vf1` yapmış. v2 işim frontend branch'inde duruyordu — oraya commit = cross-tab kontaminasyon (RISK-SCR-005 gerçekleşti).`
- `[2026-06-19] kind=fix | SCRIPTS_AGENTS §6 hard-stop → kullanıcıya soruldu → İZOLE WORKTREE seçildi: git worktree add ~/Desktop/ollamas-scripts-wt feat/scripts-v1; v2 dosyaları kopyalandı; burada commit. Paylaşılan tree dokunulmadı. Prevention: scripts sekmesi BUNDAN SONRA hep bu worktree'de çalışır; her oturum başı branch teyidi.`

> Kural (SCRIPTS_AGENTS.md §9): registry'deki bir hata **asla tekrarlanmaz**; tekrarlanırsa `recurrence_count++` + prevention_rule güçlendirilir.
