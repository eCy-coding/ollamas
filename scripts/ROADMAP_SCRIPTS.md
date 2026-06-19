# ROADMAP_SCRIPTS.md — 10 Versiyon

> Yürütme: `SCRIPTS_AGENTS.md` §6 trigger protokolü. Her versiyonun sonunda **"Next precomputed"** bloğu vardır — bir sonraki versiyonun ilk hamlesi orada hazırdır, böylece iş asla durmaz.
>
> Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. Güncel: **v1 ✅ · v2 ✅ · v3 ✅ · v4 ✅ · v5 ✅ · v6 ✅ · v7 ✅** (self-healing: remediation map + self_heal DRY-default + plist SuccessfulExit; swift 8 + node 147/1 skip), **v8 NEXT**.
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

## v8 — Observability ⬜

**Tema:** Her script run görünür olsun.

**Phases:**
1. Her script run için structured seyir event → `~/.llm-mission-control/seyir-defteri-scripts.jsonl`.
2. Alanlar: latency, exit code, device, tool, tenant.
3. CLI/SVG mini-dashboard (error-rate, p50/p95 latency).
4. **Error-rate SLO** tanımı + eşik aşımında uyarı.
5. Gate: dashboard testi.

**Canonical prompt:** "her script run'a structured seyir event ekle (latency/exit/device/tool), CLI/SVG dashboard, error-rate SLO + eşik uyarısı."

**Next precomputed (→v9):** iOS Shortcuts automation trigger envanteri + offline queue veri modeli taslağı.

---

## v9 — iOS Deepening ⬜

**Tema:** iOS'u pasif tüketiciden proaktif istemciye taşı.

**Phases:**
1. Shortcuts automation trigger (konum/saat/olay → MacBook job).
2. Background sync (iOS → MacBook periyodik).
3. **Offline queue**: bağlantı yokken job kuyruğa, dönünce flush.
4. iOS = **consumer-only** (asla host-exec target — sandbox sınırı).
5. Gate: offline→online flush testi.

**Canonical prompt:** "iOS deepening: Shortcuts automation trigger, background sync, offline queue+flush; iOS consumer-only kalır; flush testi."

**Next precomputed (→v10):** CI matrix taslağı (`.github/workflows`) — macOS runner + iOS-sim job iskeleti.

---

## v10 — GA & Drift Guard ⬜

**Tema:** Üretim olgunluğu + kayma koruması.

**Phases:**
1. CI matrix: macOS + iOS-sim.
2. **HMAC-parity gate** (server ↔ bridge ↔ Swift byte-identical CI'da fail-safe).
3. **shellcheck gate** zorunlu.
4. **Drift detector**: inventory.json ↔ gerçek dosya seti tutarsızlığı → fail.
5. GA tag + release notes.

**Canonical prompt:** "scripts domain GA: CI matrix (macOS+iOS-sim), HMAC-parity gate, shellcheck gate, drift detector (inventory↔gerçek), GA tag."

**Next precomputed (→v11):** GA sonrası — per-call realtime metering hook'u scriptlere yay (canonical AGENTS.md backlog ile hizala); v11 teması "Scripts-as-SaaS metering".

---

## Versiyon → Commit Eşlemesi
Her versiyon: kendi phase'leri commit-batch'lenir, quality-gate (tsc→lint/shellcheck→vitest) geçer, conventional commit (`feat(scripts): vN ...`) ile `feat/scripts-v1` branch'ine işlenir.
