# ROADMAP_SCRIPTS.md — 10 Versiyon

> Yürütme: `SCRIPTS_AGENTS.md` §6 trigger protokolü. Her versiyonun sonunda **"Next precomputed"** bloğu vardır — bir sonraki versiyonun ilk hamlesi orada hazırdır, böylece iş asla durmaz.
>
> Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. Güncel: **v1 ✅ · v2 ✅ · v3 ✅ · v4 ✅ · v5 ✅ · v6 ✅ · v7 ✅ · v8 ✅ · v9 ✅ · v10 ✅ GA · v11 ✅ · v12 ✅ · v13 ✅ · v14 ✅ GÜVENLİK · v15 ✅ · v16 ✅ · v17 ✅ · v18 ✅** (doctor preflight: tek-komut `make doctor` M4 e2e-hazırlık [node/drift critical + ollama/bridge/launchagent/token/benchmark warn+actionable-hint]; doctor 5 test + canlı dürüst readiness + drift 19 + dogfood), **v19 NEXT (operatör onboarding README — v1-v18 yeteneğini tek e2e akışta belgele: install→agent→doctor→tools→iOS)**.

> ⚠️ **v14 sapması (dürüst):** precomputed v14 (incremental-gate) = saf-DX cila, ürüne değmez → **backlog'a alındı**. İki audit host-bridge'de 3 gerçek sömürülebilir açık buldu (kod-okuma kanıtlı) → v14 = **güvenlik** (North Star §0-2, iOS/LAN ön-koşulu). Backlog: incremental-gate (düşük), install.sh LaunchAgent auto-load (orta, v16).
>
> ⚠️ **İzolasyon (ERR-SCR-001):** scripts sekmesi artık izole worktree **`~/Desktop/ollamas-scripts-wt`** (branch `feat/scripts-v1`) içinde çalışır — paylaşılan `~/Desktop/ollamas` tree branch-hijack'e açıktı. Her oturum başı branch teyidi zorunlu.

---

## v1 — Foundation & Inventory ✅ (inventory.json → v6'ya ertelendi)

**Tema:** Scripts domain'ini kendi kendini yöneten bir motora çevir; tüm script varlıklarını sınıfla.

**Phases:**
1. ✅ Governance 4 dosya: `SCRIPTS_AGENTS.md`, `ROADMAP_SCRIPTS.md`, `SEYIR_DEFTERI_SCRIPTS.md`, `errors_registry.json`.
2. ⬜ Inventory manifest: 7 `.sh` + 16 bridge tool + 3 py + 2 ts'i tier'a (`safe|host|privileged`) göre sınıfla → `scripts/inventory.json`.
3. ⬜ Baseline doğrula: `npm test` → 68/1; kaydet.
4. ⬜ HMAC parity self-check: `server/bridge-hmac.ts` canonical msg ↔ `bin/host-bridge/tools/bridge-client.mjs` byte-identical mı? Manuel diff.
5. ⬜ Memory pin + commit.

**Canonical prompt:** "ollamas scripts domain için governance 4 dosyasını kur, tüm scriptleri tier'a göre `scripts/inventory.json`'a sınıfla, baseline 68/1 doğrula, HMAC parity'yi kontrol et, commit'le."

**Next precomputed (→v2):** v2'nin ilk hamlesi = `scripts/tests/` dizini aç + `vitest` config'in `bin/**` ve `scripts/**`'i topladığını doğrula; ilk test dosyası `scripts/tests/hmac-parity.test.ts` (server ↔ bridge canonical msg byte eşitliği).

---

## v2 — Script Test Harness ✅

**Tema:** Scriptlerin yan etkisiz test edilebilirliği. **DONE** — 18 yeni test (hmac-parity 5 + mock-bridge 4 + dryrun 5 + golden 4); HMAC tek-kaynak `bin/host-bridge/hmac.mjs`; DRY_RUN guard 3 lifecycle script. Ertelenen: setup/install/setup-keys/join-cluster DRY_RUN + class-C tool golden → v6/v7.

**Phases:**
1. `scripts/tests/hmac-parity.test.ts` — server `signRequest` ↔ bridge client HMAC byte-identical assertion.
2. `.sh` **dry-run mode**: lifecycle scriptlere `DRY_RUN=1` guard ekle (yan etki yok, komutları echo'la).
3. **Mock bridge**: test-bridge.mjs'i in-memory mock'a saran helper; `/run` `/exec` `/write` stub.
4. 16 `tools/*.mjs` için **golden-output** testleri (deterministik input → sabit JSON).
5. Gate: `vitest run` yeni testlerle yeşil; baseline + N yeni test.

**Canonical prompt:** "scripts domain'e vitest harness ekle: HMAC parity testi, .sh DRY_RUN modu, mock bridge, 16 tool için golden-output; hepsi yeşil."

**Next precomputed (→v3):** `bin/ios-bridge/` iskeleti = Swift Package (`Package.swift`) + `Sources/ollamas-ios/main.swift` stub; HTTP client `URLSession` ile `/health`'e vurur.

---

## v3 — iOS Bridge (Shortcuts + Swift CLI) ✅

**Tema:** Yeteneği iPhone'a ulaştır — HTTP/MCP-only, app-iç coupling yok. **DONE** — `bin/ios-bridge/` Swift Package: OllamasKit (HMAC CryptoKit + Config env + URLSession Client) + `ollamas-ios` CLI (health/generate/tools) + cross-lang HMAC parity (hmac-vectors.json fixture, Swift 3 + node drift 2 test) + Shortcuts reçetesi. **Mimari karar:** iOS = app API tüketicisi (Bearer); host bridge erişilemez (127.0.0.1) → HMAC parity-asset olarak korundu. Gate: swift 8 + node 88/1.

**Phases:**
1. `bin/ios-bridge/` Swift CLI: `Package.swift` + `URLSession` HTTP client, MacBook'a `/mcp` + `/api/generate`.
2. Swift **HMAC client**: `canonicalMessage` (`METHOD\nPATH\nBODY\nTIMESTAMP\nNONCE`) aynası; HMAC-SHA256.
3. Apple **Shortcuts** tanımları (`.shortcut` / dökümante akış): `/mcp` tool çağrısı tetikler.
4. **NTP-aware timestamp** (clock-skew riski — bkz. errors_registry kategori `hmac`).
5. Secret = **Keychain** (plist değil); dökümante et.

**Canonical prompt:** "iOS Swift CLI köprüsü kur (`bin/ios-bridge/`): HTTP/MCP-only, canonicalMessage HMAC aynası, NTP-aware ts, Keychain secret, Shortcuts akışı; MacBook'a /health roundtrip kanıtla."

**Next precomputed (→v4):** `benchmark.mjs`'e `--platform` arg parse iskeleti + `benchmark.json` şemasına `platform`/`device` anahtarı.

---

## v4 — Cross-Platform Efficiency Bench ✅ (adopt: llm-benchmark MIT)

**Tema:** MacBook vs iOS'ta en verimli yöntemi ölçümle bul. **DONE** — GitHub adoption: kanıtlanmış tok/s deseni `MinhNgyuen/llm-benchmark` (MIT) `bin/host-bridge/bench-metrics.mjs`'e pure modül olarak lift edildi (attribution); `benchmark.mjs --platform macos|ios` + device detection + v4 `records[]` (platform+device+method); `calibrate_hardware.py` per-device thermal class; Shortcuts/README "Function Router" (ollama-shortcuts-ui Apache-2.0). Gate: swift 8 + node 96/1 (+8 golden). GOTCHA: RISK-SCR-006 LaunchAgent-LAN-privacy (openclaw#24018), RISK-SCR-007 cached-prompt null guard.

**Phases:**
1. ✅ `benchmark.mjs --platform macos|ios`: arg parse + device detection + normalized record şema.
2. ✅ tok/s çekirdeği `bench-metrics.mjs` (MIT pattern): `eval_count`/`eval_duration`(ns) → prompt/response/total tok-s; div-by-zero null guard.
3. ✅ `calibrate_hardware.py` per-device profil (CPU/RAM/thermalClass) → `benchmark.json` calibration[] merge.
4. ✅ Shortcuts upgrade: Function Router + modüler Block (Apache-2.0 adopt).
5. ⬜ Regresyon eşiği (CI'da fail) → v10 CI matrix ile birleştir (ertelendi, açık).

**Canonical prompt:** "benchmark.mjs'i çok-platformlu yap (--platform macos|ios), llm-benchmark MIT tok/s desenini adopte et, iki tarafı `benchmark.json`'a yaz, calibrate_hardware.py per-device, golden test."

**Next precomputed (→v5):** `server/tool-registry.ts` register-seam'ini bul (mevcut `run_tests`/`lint_format` register satırları); `registerHostScripts()` imza taslağı.

---

## v5 — Script-tool Registration Hooks ✅

**Tema:** Scriptleri choke-point'e doğru tier'la, temiz seam'le bağla. **DONE** — manifest `scripts/inventory.json` (15 host tool, tek doğruluk kaynağı) + `bin/host-bridge/schema.mjs` (zod + zod-to-json-schema, saf) + `bin/host-bridge/register-host-scripts.mjs` (idempotent reconciler) + `server.ts` tek-satır import (onaylı escalation). Gate: tsc ✓ · vitest **108/1** (+12 register-hooks) · swift 8.

**Phases (gerçekleşen):**
1. ✅ `registerHostScripts(registry, deps)` — `scripts/inventory.json`'dan tier+schema okuyup `ToolRegistry.register()`.
2. ✅ **Reconciler** (tasarım değişti): `unregisterByPrefix` yerine `registry.has(name)` ile register-if-absent / skip-if-present → boot'ta statik 15 tool skip → expose/ReAct yüzeyi kirlenmez (ERR-SCR-004). Re-run idempotent.
3. ✅ **Schema-from-manifest**: input schema zod'dan, registry'ye OpenAI function şekli (`{type:"function",function:{...}}`) ile.
4. ✅ Hard wrapper: server edit'i yalnız 1 import + 1 try-guard çağrı satırı.
5. ✅ Gate: invoke yalnız `deps.execOnHost` (bridge HTTP choke-point) üzerinden; zod invalid-arg reddi host'a ulaşmadan.

**Canonical prompt:** "scriptleri ToolRegistry'e `registerHostScripts()` ile bağla: manifest'ten tier+schema, reconciler (has→skip) ile çift kayıt yok, OpenAI function schema şekli, sadece register-seam'e dokun; invoke choke-point'ten geçer."

**Adopt:** `modelcontextprotocol/typescript-sdk` (registerTool), `colinhacks/zod` + `zod-to-json-schema`.

**Next precomputed (→v6):** tüm `.sh`'ı `shellcheck` ile tara (kuru) + `mvdan/sh` shfmt format + `bats-core` ekle (.sh unit test, macOS native) + `pure-bash-bible`/`pure-sh-bible` portable snippet (sed -i, trim); bulguları `errors_registry.json` kategori `portability`'e listele. ERR-SCR-003 (hardcoded home path bridge-client.mjs:9) burada düzeltilir.

---

## v6 — Hardening & Portability ✅

**Tema:** Shell'i kırılmaz ve BSD/macOS-taşınır yap. **DONE** — 8 .sh shellcheck-temiz + shfmt-format (2-space) + set-euo audit + 4 yeni DRY_RUN guard + ERR-SCR-003 fix. Gate: tsc ✓ · vitest **134/1** (+26: sh-hardening + repo-path) · bats 5/5 · swift 8.

**Phases (gerçekleşen):**
1. ✅ Tüm `.sh` `shellcheck --severity=warning` temiz (SC2034 setup-keys `i`→`_` fix).
2. ✅ BSD/GNU: aktif `sed -i`/`readlink -f` yok; preventive BSD-safe `script_dir` (`cd "$(dirname "$0")" && pwd`, pure-bash-bible MIT) setup.sh'a; setup-keys zaten temp-file portable in-place. ERR-SCR-003 (bridge-client REPO hardcoded home) → `OLLAMAS_REPO || import.meta.url türetme`.
3. ✅ `set -euo pipefail` + `IFS` + ERR-trap($LINENO) audit → install/setup/join-cluster/uninstall (eksikti); start/stop/setup-keys/start-bridge zaten ✓.
4. ✅ DRY_RUN guard (v2 ertelenen) → install/setup/setup-keys/join-cluster (`run()` helper stop.sh ayna). Tüm 7 destructive script dry-runnable.
5. ✅ Gate: `make harden` (lint-sh+fmt-sh-check+test-sh, permissive skip-if-missing) + `package.json harden` + her-zaman-açık vitest `sh-hardening.test.ts` (brew'siz statik).

**Canonical prompt:** "tüm .sh shellcheck-temiz + shfmt(2sp) + set-euo/IFS/ERR-trap audit + DRY_RUN guard (run() ayna); ERR-SCR-003 REPO türetme; make harden gate (permissive) + vitest statik gate; bats davranış testi."

**Adopt:** `bats-core` (MIT), `mvdan/sh` shfmt (BSD-3), `koalaman/shellcheck` (GPL=araç), `dylanaraps/pure-bash-bible`+`pure-sh-bible` (MIT).

**Next precomputed (→v7 Self-Healing):** `tools_doctor.mjs` + `health_probe.mjs` oku; auto-repair remediation map (port 7345 çakışma→kill+restart, bridge.pid stale→temizle, plist reload `launchctl kickstart -k`); idempotent; `tjluoma/launchd-keepalive` (MIT) KeepAlive/SuccessfulExit deseni adopt; simüle-arıza recovery testi (vitest mock + bats).

---

## v7 — Self-Healing ✅

**Tema:** Bridge kendini onarsın. **DONE** — pure `remediation.mjs` (planRemediation map + zero-dep backoff) + `self_heal.mjs` tool (DRY default, --apply, bridge-bağımsız direct child_process, güvenli 7345-node kill) + plist `KeepAlive{SuccessfulExit=false}`+`ThrottleInterval`. Gate: tsc ✓ · vitest **147/1** (+13) · bats 7/7 · plist lint OK · swift 8.

**Phases (gerçekleşen):**
1. ✅ Pure `bin/host-bridge/lib/remediation.mjs`: `planRemediation(health)` → sıralı idempotent action (clean_pid/kill_7345_node/restart_bridge/plist_kickstart/port_blocked/app_report) + `retryWithBackoff` (p-retry deseni, inject-edilebilir sleep).
2. ✅ `bin/host-bridge/tools/self_heal.mjs`: probe (bridge 7345 + pidfile kill-0 + lsof port + launchctl print) → plan → execute → backoff re-check; **güvenli kill** sadece 7345-LISTEN node (ps comm doğrula). DRY default; `--apply` ile gerçek.
3. ✅ Idempotent: healthy→[] no-op; re-run güvenli; non-node port-holder → kill YOK, escalate.
4. ✅ Repair planı/sonucu JSON `{healthyBefore, actions, executed, healthyAfter}`; DRY [DRY] stderr.
5. ✅ Gate: simüle-arıza (unreachable bridge) recover testi — vitest self-heal + remediation, bats self-heal DRY. plist `SuccessfulExit=false` (crash-only restart) launchd safety-net.

**Mimari karar:** bridge'i onaran tool bridge'e bağımlı OLAMAZ → bridge-client (bridgeRun) DEĞİL, doğrudan child_process. Key rotation kapsam-dışı bırakıldı (çalışan istemcileri kırar).

**Canonical prompt:** "bridge self-healing: pure planRemediation(health)→idempotent action map + retryWithBackoff; self_heal tool DRY-default/--apply, doğrudan child_process (bridge-bağımsız), güvenli 7345-node kill, plist SuccessfulExit=false; simüle-arıza recover testi."

**Adopt:** `tjluoma/launchd-keepalive` (public-domain, fikir-only), `sindresorhus/p-retry` (MIT deseni), `MathieuTurcotte/node-pid` (MIT stale-pid kill-0), `devjskit/kill-port` (MIT lsof kill).

**Next precomputed (→v8 Observability):** `logbook.mjs` oku; structured seyir event şeması (`tool`/`latency`/`exit`/`device`/`ts`) → `~/.llm-mission-control/seyir-defteri-scripts.jsonl`; `pinojs/pino`+`pino-pretty` (MIT) JSONL logger + CLI dashboard (event-rate, p50/p95 latency, error-rate SLO + eşik uyarısı). self_heal sonuçları da bu event stream'e yazılsın.

---

## v8 — Observability ✅

**Tema:** Her script run görünür olsun. **DONE** — pure `stats.mjs` (percentile/summarize/sloCheck) + `events.mjs` (zero-dep JSONL writer, never-throw) + bridge-client emit()/main() oto-instrument + `seyir_stats.mjs` dashboard (p50/p95/p99 + SLO burn-rate). Gate: tsc ✓ · vitest **167/1** (+20) · bats 9/9 · shellcheck/shfmt clean · swift 8.

**Phases (gerçekleşen):**
1. ✅ Structured event → `<DATA_DIR>/seyir-defteri-scripts.jsonl` (`events.mjs` appendFileSync, OTel alan adları `tool/duration_ms/status/exit/device/attributes`); `MISSION_CONTROL_DATA_DIR` override; `SEYIR_EVENTS=0` opt-out; best-effort never-throw.
2. ✅ Oto-instrument: `bridge-client.mjs` emit()/main() seam → her bridge tool otomatik event (T0 import + basename tool adı); `self_heal.mjs` kendi event'i (bridge-client kullanmaz).
3. ✅ `seyir_stats.mjs` dashboard: ndjson readline parse → summarize + sloCheck → terminal/`--json`; error-rate + p50/p95/p99 + per-tool + SLO; `--window`/`--slo`.
4. ✅ Error-rate SLO: `%99 / 1 saat` burn-rate (google/slo-generator deseni); alert'te `seyir_stats` exit≠0 (CI/launchd gate).
5. ✅ Gate: stats/events/seyir_stats vitest + bats; oto-instrument kanıtı (temp DATA_DIR → event satırı).

**Karar (info-leak önlenimi):** `seyir_stats` tier=**host** (safe değil) — host-local operatör observability okur, tenant'a expose edilmez. ERR-SCR-004 prevention ("kayıt öncesi mcp-gateway.e2e koş") bunu yakaladı (15→16 safe sayısı → tier host'a alındı → 15).

**Canonical prompt:** "structured seyir event (events.mjs zero-dep JSONL, never-throw) + bridge-client emit/main oto-instrument + pure stats.mjs (percentile/summarize/sloCheck) + seyir_stats dashboard (p50/p95 + SLO burn-rate, alert→exit1); operatör tool'ları tier=host (tenant-expose etme)."

**Adopt:** `pinojs/pino-pretty` (MIT, opsiyonel render), pure-JS percentile (MIT), `google/slo-generator` (Apache burn-rate deseni), OTel semantic-conventions (Apache alan adları), node readline (builtin).

**Next precomputed (→v9 iOS Deepening):** `bin/ios-bridge` Swift Package oku; offline queue veri modeli (`ralfebert/PersistentURLRequestQueue` MIT adopt — URLSession persistent retry); Shortcuts automation trigger envanteri; iOS=consumer-only (host-exec YOK); flush+replay testi (Swift XCTest + node fixture parity); HMAC parity korunur.

---

## v9 — iOS Deepening ✅

**Tema:** iOS'u pasif tüketiciden proaktif istemciye taşı. **DONE** — zero-dep `OfflineQueue` actor (Codable persist + flush/retry) + `queue add|list|flush` CLI + Shortcuts Recipe E (automation triggers). Gate: swift **14** (8→+6) · node 167/1 regresyon-yok · tsc · make harden clean · CLI smoke.

**Phases (gerçekleşen):**
1. ✅ Shortcuts automation trigger → `Shortcuts/README.md` Recipe E (saat/konum-varış/app-open → gateway POST Bearer; iOS consumer-only).
2. ✅ Offline queue: `OfflineQueue.swift` actor — `RequestEnvelope` Codable → JSON dosya (atomic write), `enqueue`/`list`/`count`/`flush(sender)`; başarı→drain, hata→item kalır+`attempts++` (retry); kısmi flush yalnız başarısızları tutar.
3. ✅ CLI: `queue add "<prompt>"` (/api/generate envelope) / `queue list` (JSON) / `queue flush` (Client.sendEnvelope; başarı→drain, hata→kal). `OLLAMAS_QUEUE_FILE` env.
4. ✅ iOS **consumer-only**: envelope = app-gateway HTTP (path+body), host-exec YOK; HMAC parity değişmedi.
5. ✅ Gate: offline→flush testi (`OfflineQueueTests` 6 case: enqueue/persist, success-drain, fail-keep+attempts, partial-retry, persistence-across-instances, env). CLI smoke kanıt: flush(offline)→delivered:0 remaining:2 attempts↑.

**Karar:** persistence zero-dep Codable+FileManager actor (ralfebert/PersistentURLRequestQueue dep eklenmedi, desen-only); flush manual/CLI (NWPathMonitor untested-glue eklenmedi); Shortcuts HTTP-reçete (App Intents app-target gerektirir, eklenmedi). Hepsi tam test edilebilir + consumer-only sınır korundu.

**Canonical prompt:** "iOS offline queue: zero-dep Codable+FileManager actor (enqueue/flush/retry, atomic persist) + queue CLI (add/list/flush, OLLAMAS_QUEUE_FILE) + Shortcuts automation reçetesi; iOS consumer-only, HMAC parity değişmez; flush(success-drain/fail-keep+attempts) testi."

**Adopt:** `ralfebert/PersistentURLRequestQueue` (MIT, desen-only), Codable+FileManager actor (Foundation builtin), `elsheppo/ollama-shortcuts-ui` (Apache, automation reçete).

**Next precomputed (→v10 GA & Drift Guard):** `.github/workflows` CI matrix (macOS runner: node tsc+vitest+make harden + swift build/test) + `rhysd/actionlint` workflow-lint + inventory↔dosya drift detector (inventory.json tool adları == schema.mjs keys == bin/host-bridge/tools/*.mjs) + HMAC Wycheproof-tarzı genişletilmiş parity vektörleri + GA tag/release notları. `bewuethr/shellcheck-action` CI gate.

---

## v10 — GA & Drift Guard ✅

**Tema:** Üretim olgunluğu + kayma koruması. **DONE** — kayma + kripto + shell regresyonu CI'da (macOS runner) yakalanır; lane paste-anywhere portable prompt'la taşınabilir.

**Phases (gerçekleşen):**
1. ✅ **Drift detector** (pure, zero-dep): `bin/host-bridge/drift-check.mjs` — 4 kaynak ÇİFT-YÖNLÜ symmetric difference (inventory ↔ schema.mjs keys ↔ register BUILDERS ↔ tools/*.mjs) + entry-file existsSync → drift→exit1. `register-host-scripts.mjs` BUILDERS export edildi. Canlı: 17 tool hizalı, exit0. (RISK-SCR-011: tek-yön orphan kaçırır → çift-yön zorunlu.)
2. ✅ **HMAC extended parity (matematiksel KAT)**: `hmac.mjs` `hmacSha256Hex` primitifi ayrıldı (DRY); `gen-vectors.mjs` RFC 4231 #1-#4 known-answer bloğu (`kats[]`) + self-check (mac≠expected→throw). node test mac==RFC published; Swift `testRFC4231KATsMatch` CryptoKit==fixture. Self-consistency→correctness. (RISK-SCR-012.)
3. ✅ **shellcheck/drift gate**: macOS CI `make harden` (shellcheck+shfmt+bats 9) + `drift-check.mjs` zorunlu adım.
4. ✅ **macOS CI** (collision-safe, yeni): `.github/workflows/scripts-ci.yml` — `macos-latest`: npm ci→tsc→vitest→brew(shellcheck/shfmt/bats)→make harden→drift-check→swift build/test; + `actionlint` job (ubuntu, docker rhysd/actionlint:1.7.7). Paylaşılan `ci.yml` DEĞİŞMEDİ.
5. ✅ **GA**: `RELEASE_NOTES_SCRIPTS.md` (v1-v10 + gate matrisi + adoption ledger) + `inventory.json` version→10.0.0 (GA marker). Gerçek `git tag` push YOK (ürün release-please akışını ezmemek için; operatör kararı).
6. ✅ **Portable operating prompt**: `SCRIPTS_PORTABLE_PROMPT.md` — tek-dosya self-contained (kimlik+scope+choke-point+verimli-seçim kuralları+gate+7-adım trigger+adoption); nereye yapıştırılırsa lane'i en verimli seçimlerle yürütür.

**Adopt:** `C2SP/wycheproof`+RFC 4231 (Apache, HMAC KAT data), `rhysd/actionlint` (MIT tool, pinned 1.7.7), `koalaman/shellcheck`+`mvdan/sh`+`bats-core` (GPL/BSD/MIT tool), GitHub `macos-latest` runner; syncpack/knip drift-deseni (idea-only, pure zero-dep yazıldı).

**Canonical prompt:** "scripts GA: standalone bidirectional drift detector (inventory↔schema↔builders↔files + entry exists) + RFC4231 HMAC KAT parity (gen-vectors self-check, node+Swift) + macOS CI (tsc/vitest/harden/drift/swift) + actionlint + portable single-file operating prompt + GA release notes; paylaşılan ci.yml'e dokunma, git tag push yok."

**Gate (kanıt):** `tsc 0 · vitest 174/1 · make harden 9 bats · drift-check exit0 (17 aligned) · swift build+test 15/0 · scripts-ci.yml YAML valid`.

**Next precomputed (→v11 Scripts-as-SaaS metering):** `server/tool-registry.ts` execute()'taki metering noktasını oku (dokunma) → host tool invoke'larına per-call realtime usage event'i (tenant+tool+latency+exit) `recordEvent`/billing seam'ine yay; canonical AGENTS.md SaaS metering backlog'u ile hizala; ilk hamle = mevcut metering interceptor'ı + bridge-client emit() seam'ini eşle, çift-sayım önle (execute zaten sayıyorsa script-side sayma).

---

## v11 — Autonomous Gate + Scripts-as-SaaS Metering ✅ (zero-manual)

**Tema:** 0 manuel seçim / 0 manuel işlem — tek-komut gate + host-cost metering. **DONE.**

**Keşif düzeltmesi (scope):** tenant-billing SERVER-side (`execute()`→`store.recordUsage`→`billing/stripe`, tenantId'li) = **integrations lane, YASAK**. Host-bridge event'leri tenant taşımaz → v11 metering = **host-LOCAL cost telemetry** (çift-sayım yok, RISK-SCR-013).

**Phases (gerçekleşen):**
1. ✅ **Zero-manual gate runner**: `bin/host-bridge/gate.mjs` — pure `runGate(steps, exec)` (injectable, test'li) + CLI; sıralı tsc→vitest→harden→drift→swift→actionlint(skip-if-absent, sessiz değil); her step exit-code ZORUNLU (non-zero→throw, false-green imkansız RISK-SCR-014); JSON verdict + exit. `Makefile` `gate`/`ship` hedefi. `scripts-ci.yml` macOS job → tek `make gate`.
2. ✅ **Host-cost metering**: `lib/metering.mjs` (pure) `meter(events,{toolTier,tierWeights,rate,budget})` → per-tool count/errors/billableUnits(tier-weighted safe1<host3<privileged10)/estCost + period rollup + budget breach. `lib/stats.mjs` deseni. + `tools/usage.mjs` (yeni host-tier tool) seyir jsonl→rapor (--json/--month/--budget→exit1). execute()/store/billing DOKUNULMADI.
3. ✅ **4-nokta registration**: `usage` → inventory(v11.0.0)+schema.mjs+BUILDERS+tools/usage.mjs; drift-check **18 aligned**.
4. ✅ **Zero-manual sözleşme**: `SCRIPTS_PORTABLE_PROMPT.md` "ZERO-MANUAL DECISION DEFAULTS" (adoption=en-yıldız+permissive, model auto-route, gate=`make gate`, yeşil→auto-commit, push/tag asla otomatik) + gate→tek-komut; `SCRIPTS_AGENTS §6` GATE=`make gate`+auto-commit+zero-manual; `TAB_IDENTITY` self-refresh+make gate.

**Adopt:** `openmeterio/openmeter` (Apache, meter SUM/period **deseni**), `AgentOps-AI/tokencost` (MIT, rate-map **deseni**), `casey/just` (command-runner **fikri**; Makefile kullanıldı, yeni tool yok), GitHub `macos-latest`+`make gate`. Hepsi desen-port, zero yeni dep.

**Canonical prompt:** "scripts zero-manual: pure runGate(steps,exec) tek-komut gate (tsc+vitest+harden+drift+swift, exit-code zorunlu, skip-loud) + Makefile gate/ship + scripts-ci tek make gate; pure metering.mjs (tier-weighted billable units + budget) + usage host-tool (seyir stream, host-local, tenant-billing'e dokunma); 4-nokta drift-safe; portable prompt ZERO-MANUAL DECISION DEFAULTS."

**Gate (kanıt):** `make gate` → PASS tsc/vitest(185/1)/harden(9)/drift(18)/swift(15) · SKIP actionlint · **GATE GREEN exit0**. usage canlı: self_heal 33 call×host3=99 units.

**Next precomputed (→v12 gate auto-commit + budget enforcement):** `gate.mjs`'e `--commit` modu (yeşilde per-file auto-stage + conventional commit, push hariç) — zero-manual COMMIT adımını da otomatikle; + `usage.mjs --budget`'i `make gate`'e opsiyonel SLO-step olarak ekle (aylık unit bütçesi aşımı→gate uyarısı); ilk hamle = gate.mjs commit-step iskeleti (git status --porcelain parse + scope-guard: yalnız scripts/+bin/ değişmişse).

---

## v12 — Gate Auto-Commit + Budget Enforcement ✅ (zero-manual COMMIT)

**Tema:** 0 manuel işlemin son halkası — yeşil gate'te otonom commit. **DONE** (dogfood: v12 kendi `--commit`'iyle commit'lendi).

**Phases (gerçekleşen):**
1. ✅ **Commit guard core** (`lib/commit.mjs`, pure): `parsePorcelain` (rename dahil) + `isInScope` (scripts/+bin/+.github/workflows+Makefile) + `isConventional` (spec regex, marcojahn MIT) + `commitDecision` → scope-dışı **tracked**→block (kontaminasyon RISK-SCR-015), non-conventional/boş-stage→block (RISK-SCR-016), scope-dışı **untracked** (node_modules) bloklamaz/stage'lenmez.
2. ✅ **gate.mjs `--commit --message`**: GATE GREEN sonrası `git status --porcelain`→`commitDecision`→per-file `git add -- <path>` (asla -A)+`git commit -m` (arg-array, shell yok); **push/tag YOK**; gate RED→commit yok; message yok/non-conv→block+exit1.
3. ✅ **usage budget SLO-step** (opt-in): `USAGE_BUDGET` env set ise `defaultSteps`'e `usage --budget` (Number-sanitized) step; over-budget→gate RED. Default OFF.
4. ✅ **wire**: `make commit MSG="..."` hedefi; SCRIPTS_PORTABLE_PROMPT + SCRIPTS_AGENTS §6 step-7 → `gate --commit`; TAB_IDENTITY.

**Adopt:** Conventional Commits spec + `marcojahn` regex (MIT), `qoomon/git-conventional-commits` type-set (MIT, desen), git porcelain/add (builtin). Zero yeni dep.

**Canonical prompt:** "gate auto-commit: pure commit.mjs (parsePorcelain+isInScope+isConventional+commitDecision, scope-dışı tracked→block) + gate.mjs --commit --message (yeşil sonrası per-file git add -- + commit, arg-array, push/tag yok) + opt-in usage --budget SLO-step (USAGE_BUDGET); make commit MSG=."

**Gate (kanıt):** `make gate` GATE GREEN + commit-guard 7 test + **dogfood**: `gate.mjs --commit` ile v12 kendini commit'ledi (scope-guard geçti, server/src yok).

**Next precomputed (→v13 gate --watch + auto-precompute):** `gate.mjs --watch` (fs.watch scripts/+bin/ → debounce → gate koş, otonom dev-loop) + ROADMAP "next precomputed" bloğundan bir sonraki versiyonun iskelet dosyalarını (test stub + lib stub) otomatik üreten `scaffold` adımı; ilk hamle = gate.mjs'e fs.watch debounce-runner iskeleti (chokidar YOK, node:fs.watch builtin).

---

## v13 — Gate Watch Dev-Loop + TDD Scaffold ✅ (zero-manual bootstrap)

**Tema:** Otonom dev-loop (kaydet→gate) + sonraki versiyon TDD iskeletini otomatik üret. **DONE** (dogfood self-commit).

**Phases (gerçekleşen):**
1. ✅ **Watch core** (`lib/watch.mjs`, pure): `debounce(fn,ms)` trailing-edge (injectable timer) + `isWatchable(path)` IGNORE seti (node_modules/.git/dist/.build/coverage/.swiftpm → self-trigger storm engeli RISK-SCR-017).
2. ✅ **gate.mjs `--watch`**: `fs.watch(scripts/+bin/, {recursive})` (macOS) → watchable→debounce(300ms)→`runGate`→verdict; watch modu **read-only** (commit/write YOK); SIGINT temiz çıkış.
3. ✅ **scaffold** (`scaffold.mjs`, pure planner+CLI): `scaffoldPlan(feature,{tool})`→red vitest test + pure lib stub (camelCase export) (+`--tool` 4-nokta registration checklist); `validSlug` path-traversal red; `--write` no-overwrite (refuse); dry default; `--from-roadmap` slug öner. **inventory'ye girmez** (dev-time generator → drift 18 sabit).
4. ✅ **wire**: `make watch`/`make scaffold F=… [TOOL=1] [WRITE=1]`; SCRIPTS_PORTABLE_PROMPT DECISION DEFAULTS + SCRIPTS_AGENTS §6 TDD scaffold/watch.

**Adopt:** `yuanchuan/node-watch` (MIT, debounce+ignore deseni), node:fs.watch recursive (builtin macOS, chokidar reddedildi=dep), `plopjs/plop`+`hygen` (MIT, plan→files deseni). Zero yeni dep.

**Canonical prompt:** "gate --watch: pure lib/watch.mjs (debounce + isWatchable IGNORE) + gate.mjs fs.watch(scripts/+bin/ recursive)→debounce→runGate, watch read-only (commit/write yok); scaffold.mjs pure scaffoldPlan (red test+lib stub, validSlug traversal-red, no-overwrite, dry default) + --tool registration checklist + --from-roadmap; make watch/scaffold; inventory'ye girmez."

**Gate (kanıt):** `make gate` GATE GREEN + watch-debounce 4 + scaffold 5 test + watch bounded smoke (başlar→ilk gate→kill, hang yok) + drift 18 + dogfood self-commit.

**Next precomputed (→v14 incremental gate):** [GERÇEKLEŞMEDİ — incremental-gate backlog'a alındı; v14 güvenliğe pivot etti, aşağıya bak.]

---

## v14 — Host-Bridge Security Hardening ✅ (CRITICAL, North Star §0-2)

**Tema:** host-exec bridge'i iOS/LAN exposure öncesi sömürülemez yap. **DONE** (canlı saldırı smoke + dogfood). **Pivot:** precomputed incremental-gate (saf-DX) yerine — iki audit `terminal-bridge.mjs`'de 3 gerçek açık buldu (kod-okuma kanıtlı, ajan iddiası değil).

**Phases (gerçekleşen):**
1. ✅ **Guard core** (`lib/bridge-guard.mjs`, pure): `safeWritePath(roots,target)` (resolve+startsWith(root+sep), server/files.ts deseni) + `withinLimit(len,max)` + `bindRequiresAuth(bind,hasAuth)` (non-loopback+no-auth→true).
2. ✅ **/write path-confine** (ERR-SCR-006 CRITICAL): `terminal-bridge.mjs` /write → safeWritePath(WRITE_ROOTS)→escape 403, ok→resolved'a yaz. WRITE_ROOTS=repo+tmp/llm-bridge+~/.llm-mission-control (BRIDGE_WRITE_ROOTS).
3. ✅ **payload-cap** (ERR-SCR-007 high): readBody MAX_BODY 16MB (BRIDGE_MAX_BODY) — aşımda append-durdur+413; /run /exec /write hepsi.
4. ✅ **fail-closed bind** (RISK-SCR-019 high): non-loopback BIND + auth-yok → startup exit 1 (fail-open kapatıldı); loopback dev değişmedi.
5. ✅ `/run`+`/exec` DOKUNULMADI (tasarım-gereği auth'lu exec, regresyon yok — /health 200).

**Adopt:** in-repo `server/files.ts:31`/`server/commander.ts:31` path-guard deseni (proje-kanıtlı, dep yok), Node http builtin payload-cap, OWASP path-traversal/upload prensibi. Zero yeni dep.

**Canonical prompt:** "host-bridge hardening: pure bridge-guard.mjs (safeWritePath resolve+startsWith confine + withinLimit + bindRequiresAuth) + terminal-bridge /write 403-confine + readBody 16MB-cap→413 + non-loopback fail-closed bind exit1; /run+/exec dokunma."

**Gate (kanıt):** bridge-security 8 test + CANLI smoke (traversal→403, in-root→200, no-auth→401, 20MB→413, /etc/evilx yazılmadı, fail-closed refuse, /health 200) + make gate GREEN + dogfood.

**Next precomputed (→v15 real e2e bridge harness):** [DONE — aşağı bak.]

---

## v15 — Real E2E Bridge Harness ✅ (mock-only açığı kapat)

**Tema:** 18 tool + v14 güvenlik yalnız mock/manuel test edilmişti → gerçek terminal-bridge spawn'lı otomatik e2e. **DONE** (dogfood).

**Phases (gerçekleşen):**
1. ✅ **real-bridge helper** (`tests/helpers/real-bridge.mjs`): `freePort()` (net listen 0 — PORT=0 falsy→7345 tuzağı bypass) + `startRealBridge({token,bind,writeRoots,maxBody})` gerçek `terminal-bridge.mjs` spawn + /health-poll (timeout'lu) → `{started,url,proc,exitCode,close}`; close SIGTERM+await (sızıntı yok). mock-bridge.mjs deseni adopt.
2. ✅ **e2e test** (`bridge-e2e.test.ts`, `describe.skipIf(!BRIDGE_E2E)`): /health 200 + /exec "echo e2e-ok" roundtrip (gerçek bash); **v14 güvenlik regresyon-kilidi** traversal→403 (/etc yazılmadı) / oversized→413 / no-auth→401 / in-root→200; **fail-closed** bind=0.0.0.0+no-auth→started:false+exitCode≠0.
3. ✅ **wire**: `make e2e` + scripts-ci.yml macOS gate step `env BRIDGE_E2E=1` (CI gerçek e2e; local gate skipIf-atlar).

**DÜRÜST limitasyon (RISK-SCR-021):** 18 tool'un HEPSİ `/run` (osascript→GUI terminal+TCC) kullanır → per-tool roundtrip headless test EDİLEMEZ (platform kısıtı). Sahte-geçen test yazılmadı; e2e headless yüzeyi (/exec + güvenlik + fail-closed) kapsar, /run path'i manual/local belgelendi.

**Adopt:** in-repo `helpers/mock-bridge.mjs` spawn/teardown deseni + v14 smoke assertion'ları otomatikleştirildi + node child_process/net (builtin, wait-on fikri). Zero yeni dep.

**Canonical prompt:** "real e2e bridge: helpers/real-bridge.mjs (freePort + startRealBridge spawn+health-poll+SIGTERM-teardown) + bridge-e2e.test.ts skipIf(!BRIDGE_E2E) (/exec roundtrip + v14 güvenlik 403/413/401 + fail-closed); make e2e + CI env; /run osascript headless-edilemez→belgele."

**Gate (kanıt):** `BRIDGE_E2E=1 vitest bridge-e2e` 3 pass; env yok→4 skip; leftover süreç yok; make gate GREEN; drift 18; dogfood.

**Next precomputed (→v16 install.sh LaunchAgent auto-load):** [DONE — aşağı bak.]

---

## v16 — LaunchAgent Auto-Load ✅ (reboot→bridge-down kapat)

**Tema:** host bridge reboot-dayanıklı LaunchAgent (audit CRITICAL #2). **DONE** (dogfood). **GÜVENLİK:** gerçek `launchctl bootstrap` kalıcı daemon (outward-facing) → operatör install.sh çalıştırınca; ben DRY+unit ile kanıtladım, daemon başlatmadım.

**Phases (gerçekleşen):**
1. ✅ **render-plist** (`render-plist.mjs`, pure `renderPlist`): template→node-path(`command -v node`)+repo+token+port enjekte; REPLACE_WITH leftover→throw (yarım-render imkansız RISK-SCR-023); absolute-path/token assert. CLI stdout.
2. ✅ **install-agent.sh** (DRY-guarded, idempotent): token-ensure (start-bridge deseni) → render → `~/Library/LaunchAgents/<label>.plist` + **chmod 600** (token plaintext RISK-SCR-022) → `launchctl bootout||true → bootstrap gui/$UID → enable → kickstart -k` (modern API, deprecated `load` değil).
3. ✅ **wire**: install.sh macOS'ta `run bash install-agent.sh`; uninstall.sh `launchctl bootout + rm plist` (purge'dan önce); Makefile SH_FILES+=install-agent.sh + `install-agent`/DRY target; plist template "render-only" yorum.

**Adopt:** `tjluoma/launchd-keepalive` (KeepAlive, mevcut), Apple launchctl modern bootstrap/enable/kickstart (builtin), in-repo start-bridge token + install.sh run()-DRY deseni. Zero yeni dep.

**Canonical prompt:** "LaunchAgent auto-load: pure render-plist.mjs (command -v node + token + repo enjekte, REPLACE_ leftover→throw) + install-agent.sh (token-ensure→render→chmod600→bootout||true→bootstrap→enable→kickstart, DRY-guarded idempotent) + install/uninstall wire; gerçek bootstrap=operatör (outward-facing daemon)."

**Gate (kanıt):** render-plist 6 test + bats 11 (install-agent/uninstall DRY no-write) + canlı render (REPLACE=0, node-path doğru) + make harden clean + make gate GREEN + drift 18 + dogfood. Gerçek `launchctl bootstrap` KOŞULMADI (operatör kararı).

**Next precomputed (→v17 efficient local-model auto-select):** [DONE — aşağı bak.]

---

## v17 — Efficient Local-Model Auto-Select ✅ (North Star §0-1, M4 verimlilik)

**Tema:** M4'te en-verimli lokal modeli kanıtla seç (kullanıcı çekirdek mandatesı). **DONE** (dogfood). benchmark.mjs ZATEN inline bestModel hesaplıyordu → naive dup yerine pure'e ÇIKARILDI (DRY) + constraint-aware + cached-json tool.

**Phases (gerçekleşen):**
1. ✅ **pure lib** (`lib/model-select.mjs`): `rankModels(results,{metric,minTokS,maxSizeGb})` + `pickModel` → `{model,correct,reason,ranked}`; correctness-gate DAİMA (correct-first, hiç-yok→fallback+reason); metric tps|latency; min-tok/s + sizeGb-fit **data-driven** (isimden RAM tahmini YOK, RISK-SCR-024); filtre-boşaltırsa gevşet.
2. ✅ **benchmark.mjs DRY-refactor**: inline rank/bestModel (`:116-118`) → `rankModels`/`pickModel` import; davranış-koruyan (default latency = eski sıralama); tek-kaynak ranking.
3. ✅ **model_select host-tool** (`tools/model_select.mjs`, read-only seyir_stats deseni): cached `benchmark.json` oku → pickModel → öneri (--json/--metric tps|latency/--min-tps); re-bench YOK. 4-nokta kayıt (inventory+schema+BUILDERS+tool), drift 18→**19**.

**Adopt:** `MinhNgyuen/llm-benchmark` (MIT, tok/s+correct-first, zaten v4) + `rockyRunnr/ollama-bench` (MIT seçim fikri) + in-repo inline ranking pure'e çıkarıldı. Zero yeni dep.

**Canonical prompt:** "efficient model-select: pure lib/model-select.mjs (rankModels/pickModel, correctness-gate + metric tps|latency + data-driven minTokS/maxSizeGb, fallback) + benchmark.mjs inline→pickModel (DRY) + tools/model_select.mjs (cached benchmark.json oku→öner, re-bench yok); 4-nokta kayıt drift 19."

**Gate (kanıt):** model-select 8 test + vitest 223/4skip + drift 19 + tsc 0 + canlı `model_select --json` (mevcut benchmark.json→fallback-reason, correct-yok) + make gate GREEN + dogfood. **Canlı ollama bench KOŞULMADI** (flaky-eşzamanlı UK-08; mevcut json yeter).

**Next precomputed (→v18 cluster join/enroll hardening):** [SAPILDI — join-cluster çok-düğüm mesh, tek-M4 kullanıcı için spekülatif → backlog. v18=doctor preflight. Aşağı bak.]

---

## v18 — Doctor Preflight Readiness ✅ (M4 e2e tek-komut hazırlık)

**Tema:** "M4 ollamas'ım e2e hazır mı?" tek-komut (`make doctor`). **DONE** (dogfood). **Pivot:** precomputed join-cluster (çok-düğüm mesh) tek-M4+iPhone kullanıcı için spekülatif → backlog; gerçek boşluk = bütünsel readiness (v16 LaunchAgent'in yüklü olduğunu hiçbir şey doğrulamıyordu).

**Phases (gerçekleşen):**
1. ✅ **pure lib** (`lib/doctor.mjs`): `nodeVersionOk` (vXX≥min) + `parseLaunchctlLoaded` (exit0/stdout) + `evaluate(checks)` → iki-seviye `{ok=critical-fail-yok, ready=hepsi-ok}` (runtime=warn, env-bağımlı false-alarm yok RISK-SCR-025).
2. ✅ **doctor CLI** (`doctor.mjs`, --json): critical (node≥24, drift exit0) + warn (ollama-cli/ollama-up/bridge.token/launchagent-loaded[launchctl print]/bridge-health/app-health/benchmark.json); her fail **actionable hint**. Standalone (registered tool DEĞİL → drift 19 sabit, tools_doctor çakışmaz). `make doctor`.
3. ✅ Mevcut beste: drift-check (spawn) + health_probe fetch deseni + install-agent label + model_select benchmark.json. Re-impl yok.

**Adopt:** brew/flutter `doctor` preflight+hint deseni; in-repo health_probe+drift-check beste. Zero yeni dep.

**Canonical prompt:** "doctor preflight: pure lib/doctor.mjs (nodeVersionOk + parseLaunchctlLoaded + evaluate two-level critical/warn) + doctor.mjs CLI (node/drift critical + ollama/bridge/launchagent/token/benchmark warn + actionable hints) + make doctor; standalone (drift 19 sabit)."

**Gate (kanıt):** doctor 5 test + canlı `make doctor` (bu M4: node✓/drift✓ critical→exit0; ollama✓/app✓/token✓/benchmark✓; launchagent+bridge WARN+hint dürüst çünkü daemon-kurulmadı) + drift 19 + make gate GREEN + dogfood.

**Next precomputed (→v19 operatör onboarding README):** v1-v18 yeteneğini tek **e2e operatör akışında** belgele (`bin/host-bridge/README.md` veya `OPERATING.md`): install.sh → make install-agent → make doctor → tools (tools_doctor) → model_select → iOS (ios-bridge/Shortcuts). Mevcut E2E_FLOW.md/MACOS_BASH_GUIDE.md'yi tek giriş-noktasına bağla; "0 manuel" akışı netleştir. İlk hamle = README iskeleti + doctor/install-agent/gate komut-referansı (kanıt: dosya var + linkler geçerli).

---

## Versiyon → Commit Eşlemesi
Her versiyon: kendi phase'leri commit-batch'lenir, quality-gate (tsc→lint/shellcheck→vitest) geçer, conventional commit (`feat(scripts): vN ...`) ile `feat/scripts-v1` branch'ine işlenir.
