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

## v4 — Cross-Platform Bench (adopt: llm-benchmark MIT tok/s)

- `[2026-06-19] kind=phase | GitHub adoption search | WebSearch+WebFetch ile macOS eşleşen tamamlanmış projeler tarandı; haritalandı: llm-benchmark(MIT)→v4, ollama-shortcuts-ui(Apache-2.0)→Shortcuts, multi-level self-heal→v7, bertvv+shellcheck→v6. Lisans disiplini: MIT/Apache kopya+attribution, SiriLLama(lisanssız) fikir-only. | plan onaylı`
- `[2026-06-19] kind=phase | P0 metrik çekirdeği | bin/host-bridge/bench-metrics.mjs — pure tok/s çıkarımı (MIT pattern attribution): tokensPerSecond=count/(durNs/1e9), extractOllamaMetrics prompt/response split, parsePlatformArg, detectDevice, benchRecord şema | node --check OK`
- `[2026-06-19] kind=phase | P0 wire | benchmark.mjs --platform macos|ios arg + DEVICE detection + v4 records[] (platform+device+method anahtarı) report'a eklendi; mevcut IIFE korundu | smoke: header "platform: ios device: Apple M4 Max 16c/48GB arm64" bastı`
- `[2026-06-19] kind=phase | P2 calibrate_hardware.py | per-device profil (sysctl CPU/ncpu/mem + thermalClass heuristic) → benchmark.json calibration[] merge; stdlib-only, --dry-run | dry-run: M4 Max → workstation`
- `[2026-06-19] kind=phase | P3 Shortcuts upgrade | Shortcuts/README.md "Recipe D — Function Router" (ollama-shortcuts-ui Apache-2.0 adopt+attribution): modüler Block + Router dispatch + chaining | -`
- `[2026-06-19] kind=phase | P4 test | scripts/tests/benchmark.test.ts golden: tokensPerSecond (50/200 tok/s + div-by-zero null guard), extractOllamaMetrics fixture (prompt 200 / response 50 / total 48), parsePlatformArg, benchRecord şema, detectDevice shape | 8 yeni test`
- `[2026-06-19] kind=phase | P5 gate | vitest 96 pass/1 skip (88→+8) + swift build/test 8 pass + node --check + calibrate dry-run | YEŞİL`
- `[2026-06-19] kind=note | GOTCHA→registry | RISK-SCR-006 LaunchAgent-LAN-privacy (openclaw#24018: host-bridge LaunchAgent PPID=1 → outbound LAN sessiz blok) + RISK-SCR-007 Ollama cached-prompt prompt_eval_* atlama → null guard`

---

## v5 — Script-tool Registration Hooks (adopt: MCP SDK + zod)

- `[2026-06-19] kind=phase | GitHub adoption search | en-yıldızlı MIT/Apache repo tarandı (3 paralel Explore+web): typescript-sdk(MIT registerTool), zod(43k)+zod-to-json-schema(ISC), bats-core(6.1k v6), shfmt/shellcheck(v6), pino(v8), PersistentURLRequestQueue+swift-crypto(v9/10), actionlint(v10). Adoption Map → SCRIPTS_AGENTS §5.1 | plan onaylı`
- `[2026-06-19] kind=phase | P0 deps+manifest | package.json zod^3.25.76 + zod-to-json-schema^3.25.2 (transitive→explicit); scripts/inventory.json 15 host tool (name/tier/entry/description, tier server/tool-registry.ts'ten aynalandı) tek doğruluk kaynağı | import smoke OK`
- `[2026-06-19] kind=phase | P1 schema | bin/host-bridge/schema.mjs — zod SCHEMAS{15} .strict() + toJsonSchema (openApi3, $schema strip) + validateArgs; saf (fs/net yok) | -`
- `[2026-06-19] kind=phase | P2 seam | bin/host-bridge/register-host-scripts.mjs — loadInventory(drift guard: name+schema+builder şart) + buildToolDef (OpenAI function şekli) + registerHostScripts reconciler; BUILDERS 15 tool argv server defs ayna; invoke yalnız deps.execOnHost (choke-point) | -`
- `[2026-06-19] kind=error | ERR-SCR-004 (high) | ilk tasarım host_ prefix dupe + flat schema → mcp-gateway.e2e 3 fail (108→105): (1) host_ dupe expose'a sızdı "15 safe-tier" bozuldu, (2) expose t.schema.function.description okuyor, flat schema undefined | vitest McpError -32603`
- `[2026-06-19] kind=fix | ERR-SCR-004 | tasarım reconciler'a çevrildi (registry.has→skip, canonical isim, host_ prefix kaldırıldı) + schema OpenAI function şekline (fn() ayna). Boot'ta statik 15 skip → expose/ReAct kirlenmez. Prevention→registry: canonical+has reconciler ZORUNLU, flat schema YASAK, kayıt öncesi mcp-gateway.e2e koş`
- `[2026-06-19] kind=phase | P3 wire | server.ts +2 satır: import registerHostScripts + try-guard boot çağrısı (onaylı escalation, dispatch/execute'a dokunulmadı, yalnız register-seam) | -`
- `[2026-06-19] kind=phase | P4 test | scripts/tests/register-hooks.test.ts 12 case: manifest drift, reconciler register/skip/idempotent, OpenAI function schema, invoke argv (git_commit --push, apply_patch stdin pipe, logbook tail 20), zod invalid-arg reject host'a ulaşmadan | 12 yeni`
- `[2026-06-19] kind=phase | P5 gate | tsc --noEmit OK + vitest 108 pass/1 skip (96→+12) + swift build/test 8 pass | YEŞİL`
- `[2026-06-19] kind=note | Next precomputed (→v6 Hardening) | shellcheck (kuru) tüm .sh + shfmt format + bats-core .sh unit test (macOS native) + pure-bash/sh-bible portable snippet (sed -i, trim, read); ERR-SCR-003 (bridge-client.mjs:9 hardcoded home) burada düzelt; RISK-SCR-003 BSD/GNU divergence test. Bulgular errors_registry kategori=portability`

---

## v6 — Hardening & Portability (adopt: bats-core + shfmt + shellcheck + pure-bash-bible)

- `[2026-06-20] kind=phase | GitHub adoption search | derin web-search: bats-core(6.1k MIT) install+@test/run/$status, mvdan/sh shfmt(8.8k BSD-3) -i 2 -ci, koalaman/shellcheck(39.6k GPL=araç) severity+disable, pure-bash-bible+pure-sh-bible(MIT) trim/script-dir/sed-i.bak. SCRIPTS_AGENTS §5.1 doğrulandı | plan onaylı`
- `[2026-06-20] kind=fix | ERR-SCR-003 (v2'den ertelenen) | bin/host-bridge/tools/lib/bridge-client.mjs REPO = process.env.OLLAMAS_REPO || dirname(fileURLToPath(import.meta.url)) 4-üst; home literal kaldırıldı (8 tool cd ${REPO} korunur) | node: env→/tmp/custom-repo, default→türetilmiş`
- `[2026-06-20] kind=phase | P1 statik gate (TDD kırmızı) | scripts/tests/sh-hardening.test.ts (vitest, brew'siz daima-açık): 8 .sh shebang+set-euo, 7 destructive DRY_RUN + repo-path.test.ts (child-process izolasyon) | önce 10 fail (gaps)`
- `[2026-06-20] kind=phase | P2 set-euo audit | install/setup/join-cluster/uninstall → set -euo pipefail + IFS=$'\n\t' + ERR-trap($LINENO); join-cluster set hiç yoktu | -`
- `[2026-06-20] kind=phase | P3 DRY_RUN guard | install/setup/setup-keys/join-cluster → run() helper (stop.sh ayna) + destructive gate (docker build/up, npm, go build, daemon spawn, .env, read prompt); DRY modunda [DRY] yaz, exit 0 | bats: 4 script DRY exit=0 + [DRY]`
- `[2026-06-20] kind=phase | P4 shfmt+portable | shfmt -i 2 -ci -w 8 .sh (indent normalize 4sp/2sp→2sp); setup.sh BSD-safe script_dir (pure-bash-bible MIT) | shfmt -d boş diff`
- `[2026-06-20] kind=error | ERR-SCR-005 (low) | shfmt/shellcheck'e unquoted $SH ile dosya listesi geçtim; zsh unquoted-skaler word-split ETMEZ → tüm liste tek arg "no such file" | lstat 'start.sh stop.sh...' err`
- `[2026-06-20] kind=fix | ERR-SCR-005 | literal dosya listesi + Makefile $(SH_FILES) (make word-split yapar). Prevention→registry: zsh'te çoklu-arg unquoted skaler YASAK | -`
- `[2026-06-20] kind=phase | P5 shellcheck+bats+Makefile | shellcheck --severity=warning temiz (SC2034 setup-keys i→_); scripts/tests/sh/dry-run.bats 5 case (core-only); Makefile lint-sh/fmt-sh/fmt-sh-check/test-sh/harden (permissive skip-if-missing) + package.json harden | make harden CLEAN, bats 5/5`
- `[2026-06-20] kind=fix | self-introduced finding | eklediğim safe-bash `IFS=$'\n\t'` 5 scriptte semgrep bash.ifs-tampering tetikledi (pre-commit non-blocking). Gizleme yok → IFS satırları kaldırıldı; çekirdek hardening (set -euo pipefail + ERR trap) korundu; default IFS sadece gevşetir, hiçbir splitting bozulmaz. Prevention: safe-bash header'da global IFS ekleme; set -euo pipefail yeterli | re-gate: shellcheck/shfmt/vitest 134 + bats 5/5 yeşil`
- `[2026-06-20] kind=phase | P6 gate | tsc OK + vitest 134 pass/1 skip (108→+26) + bats 5/5 + shellcheck/shfmt clean + swift 8 | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v7 Self-Healing) | tools_doctor.mjs+health_probe.mjs oku; remediation map (port 7345 çakışma→kill+restart, stale bridge.pid temizle, plist launchctl kickstart -k); tjluoma/launchd-keepalive MIT KeepAlive/SuccessfulExit adopt; idempotent + simüle-arıza recovery testi`

---

## v7 — Self-Healing (adopt: launchd-keepalive + p-retry + node-pid)

- `[2026-06-20] kind=phase | adoption search | derin web: tjluoma/launchd-keepalive (public-domain→fikir-only, KeepAlive{SuccessfulExit=false}+ThrottleInterval+modern launchctl kickstart -k gui/$UID/LABEL), sindresorhus/p-retry(1k MIT backoff deseni), MathieuTurcotte/node-pid(MIT kill-0 stale), devjskit/kill-port(MIT lsof). Karar: tam+güvenli-kill, DRY-default --apply, zero-dep backoff | plan onaylı`
- `[2026-06-20] kind=phase | P0 pure çekirdek (TDD) | bin/host-bridge/lib/remediation.mjs — planRemediation(health)→sıralı idempotent action (clean_pid/kill_7345_node/restart_bridge/plist_kickstart/port_blocked/app_report) + retryWithBackoff (p-retry deseni, inject sleep). remediation.test.ts 10 case | önce kırmızı→yeşil`
- `[2026-06-20] kind=phase | P1 self_heal tool | bin/host-bridge/tools/self_heal.mjs — DOĞRUDAN child_process (bridge-bağımsız, mimari karar). probe: bridge 7345/health + bridge.pid kill-0 + lsof tcp:7345 + launchctl print. Güvenli kill: ps comm "node" doğrula, sadece 7345. DRY default; --apply gerçek; retryWithBackoff re-check | DRY smoke: bridge-down→clean_pid+restart planlandı, applied=false, exit 0, kill YOK`
- `[2026-06-20] kind=phase | P2 plist hardening | com.missioncontrol.terminalbridge.plist KeepAlive→dict{SuccessfulExit=false}+ThrottleInterval=10 (crash-only restart, launchd safety-net) | plutil -lint OK`
- `[2026-06-20] kind=phase | P3 registry | inventory.json self_heal (tier host) + schema.mjs zod {apply?} + register BUILDERS (--apply argv); register-hooks 15→16 otomatik | -`
- `[2026-06-20] kind=phase | P4 test | self-heal.test.ts 3 (DRY exit0/applied=false/no-exec, restart planı, JSON şekli) + sh/self-heal.bats 2 (DRY exit0); flake gözlemi: tam suite ilk koşuda 1 fail (mcp-gateway self-boot port race, v7-dışı) → 3x re-run 147/1 deterministik | -`
- `[2026-06-20] kind=fix | self-introduced finding | self_heal.mjs:44 semgrep react-insecure-request (http://127.0.0.1:3000 loopback probe). Gizleme yok → gerekçeli nosemgrep (loopback-only, app düz HTTP konuşur, health_probe.mjs ile aynı desen; kaldırılamaz=suppression doğru disposition, IFS'ten farklı). | re-gate tsc OK + self-heal 3/3`
- `[2026-06-20] kind=phase | P5 gate | tsc OK + vitest 147 pass/1 skip (134→+13) + bats 7/7 + shellcheck/shfmt clean + plist lint + swift 8 | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v8 Observability) | logbook.mjs oku; structured seyir event {tool,latency,exit,device,ts}→seyir-defteri-scripts.jsonl; pino+pino-pretty(MIT) JSONL logger + CLI dashboard (event-rate, p50/p95, error-rate SLO eşik uyarı); self_heal sonuçları da stream'e`

---

## v8 — Observability (adopt: pino-pretty + pure-percentile + slo-generator + OTel)

- `[2026-06-20] kind=phase | adoption search | derin web: pino-pretty(MIT render), pure-JS percentile(MIT linear-interp), google/slo-generator(Apache burn-rate EB=1-SLI), OTel semantic-conventions(Apache alan adları), node readline(builtin ndjson). Karar: plain JSONL appendFileSync(zero-dep) + oto-instrument emit() seam + SLO %99/1h burn-rate alert | plan onaylı`
- `[2026-06-20] kind=phase | P0 pure stats (TDD) | bin/host-bridge/lib/stats.mjs — percentile(sortedAsc,p) linear-interp + summarize(events)→{total,errorRate,p50/p95/p99,avg,byTool} + sloCheck(window-filter+burn-rate, now injectable). stats.test.ts 11 case | kırmızı→yeşil`
- `[2026-06-20] kind=phase | P1 event writer | bin/host-bridge/lib/events.mjs — buildEvent (OTel-ish {ts,ts_ms,tool,duration_ms,status,exit,device,attributes}, now injectable) + recordEvent appendFileSync <DATA_DIR>/seyir-defteri-scripts.jsonl, best-effort never-throw, SEYIR_EVENTS=0 opt-out. events.test.ts 5 (temp-dir izole, unwritable→no-throw) | yeşil`
- `[2026-06-20] kind=phase | P2 oto-instrument | bridge-client.mjs T0=import + emit()/main() → recordEvent(tool=basename argv1, duration, status, exit). Tek seam → tüm bridge tool'ları enstrümante. self_heal kendi recordEvent (bridge-client kullanmaz) | kanıt: temp DATA_DIR'de logbook+self_heal event satırı (duration_ms 0/85)`
- `[2026-06-20] kind=phase | P3 dashboard | bin/host-bridge/tools/seyir_stats.mjs — readline ndjson → summarize+sloCheck → terminal/--json, --window/--slo, SLO alert→exit1, READ-ONLY (kendi event'ini yazmaz, feedback önle) | smoke: p50 43 p95 81, sloAlert false`
- `[2026-06-20] kind=error | near-miss (ERR-SCR-004 prevention çalıştı) | seyir_stats tier=safe eklenince mcp-gateway.e2e 'free-plan 15 safe' → 16 (reconciler yeni safe tool'u expose'a kaydetti). KÖK: seyir_stats host-operatör aracı (host FS okur), tenant-safe değil + info-leak riski | vitest: expected 16 to be 15`
- `[2026-06-20] kind=fix | seyir_stats tier safe→host | operatör observability host'a expose edilmez; e2e 15'te kalır, server-test'e dokunulmadı (§3 korundu). Prevention: scripts manifest'e safe-tier tool eklemeden önce 'tenant'a expose edilmeli mi?' sor + mcp-gateway.e2e koş | vitest 167/1 2x deterministik`
- `[2026-06-20] kind=phase | P4-5 gate+gov | tsc OK + vitest 167 pass/1 skip (147→+20) + bats 9/9 + shellcheck/shfmt clean + swift 8; register-hooks 16→17 oto | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v9 iOS Deepening) | bin/ios-bridge oku; offline queue (ralfebert/PersistentURLRequestQueue MIT, URLSession persistent retry) + Shortcuts automation trigger envanteri + flush/replay testi (Swift XCTest + node fixture parity); iOS=consumer-only, HMAC parity korunur`

---

## v9 — iOS Deepening (adopt: PersistentURLRequestQueue desen + Codable actor)

- `[2026-06-20] kind=phase | adoption search | derin web: ralfebert/PersistentURLRequestQueue(MIT enqueue/flush/retry şekli), Codable+FileManager actor(Foundation builtin), NWPathMonitor(Network builtin), App Intents(app-target gerektirir-dürüst sınır), ollama-shortcuts-ui(Apache automation). Karar: zero-dep Codable actor + manual/CLI flush + HTTP-reçete (dep/glue/app-target eklenmez) | plan onaylı`
- `[2026-06-20] kind=phase | P0 OfflineQueue (TDD) | Sources/OllamasKit/OfflineQueue.swift — RequestEnvelope Codable {id,createdAt,path,method,bodyJSON,attempts} + actor enqueue/list/count/flush(sender); başarı→drain, throw→kal+attempts++; atomic persist (JSONEncoder iso8601, .atomic write); defaultFileURL OLLAMAS_QUEUE_FILE||~/.llm-mission-control/ios-outbox.json. OfflineQueueTests 6 case | swift 8→14`
- `[2026-06-20] kind=phase | P1 CLI | main.swift queue add/list/flush (runQueue async) + Client.sendEnvelope(path,method,body) generic gönderici; OLLAMAS_QUEUE_FILE onurlandır | smoke: add×2→pending2, flush(gateway kapalı)→delivered0/remaining2/attempts↑1, persistence-across-process (her komut ayrı süreç)`
- `[2026-06-20] kind=phase | P2 Shortcuts | Shortcuts/README.md Recipe E — automation triggers (saat/konum-varış/app-open→gateway POST Bearer) + offline davranış (CLI queue ile eşleş) + sharing (binary per-device, CLI=test edilebilir referans); iOS consumer-only | -`
- `[2026-06-20] kind=phase | P3 gate+gov | swift build+test 14 (regresyon yok) + node tsc OK + vitest 167/1 (ios-hmac-vectors parity korundu) + make harden clean | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v10 GA & Drift Guard, FINAL) | .github/workflows CI matrix (macOS: node tsc+vitest+harden + swift build/test) + actionlint(rhysd) + shellcheck-action(bewuethr) + inventory↔dosya drift detector (inventory tool adları==schema.mjs keys==tools/*.mjs) + HMAC Wycheproof-genişletilmiş parity + GA tag/release notları`

## v10 — GA & Drift Guard ✅ (GA)

- `[2026-06-20] kind=phase | P1 drift detector | bin/host-bridge/drift-check.mjs pure zero-dep: 4-kaynak çift-yönlü symmetric-diff (inventory↔schema↔BUILDERS↔tools/*.mjs) + entry existsSync; register-host-scripts BUILDERS export | node drift-check → 'OK 17 aligned' exit0; drift-check.test.ts 6 case (missing-schema/orphan-file/missing-builder/missing-entry yakalar) | YEŞİL`
- `[2026-06-20] kind=phase | P2 HMAC RFC4231 KAT | hmac.mjs hmacSha256Hex primitif ayrıldı (DRY); gen-vectors.mjs kats[] RFC4231 #1-#4 + self-check (mac≠expected→throw); node test mac==RFC published; Swift testRFC4231KATsMatch CryptoKit==fixture | self-consistency→correctness; fixture regenerate edildi (5 vector + 4 kat) | YEŞİL`
- `[2026-06-20] kind=phase | P3-4 macOS CI + gate | .github/workflows/scripts-ci.yml (macos-latest: npm ci→tsc→vitest→brew shellcheck/shfmt/bats→make harden→drift-check→swift build/test) + actionlint job (ubuntu docker rhysd/actionlint:1.7.7); paylaşılan ci.yml DOKUNULMADI | YAML safe_load OK (2 job, 9+2 step) | YEŞİL`
- `[2026-06-20] kind=phase | P5 GA | RELEASE_NOTES_SCRIPTS.md (v1-v10 + gate matrisi + adoption ledger) + inventory.json version 5.0.0→10.0.0 GA marker; git tag push YOK (release-please ezme, operatör kararı) | — | YEŞİL`
- `[2026-06-20] kind=phase | P6 portable prompt | SCRIPTS_PORTABLE_PROMPT.md tek-dosya self-contained (kimlik+scope+choke-point+verimli-seçim+gate+7-adım trigger+adoption); nereye yapıştırılırsa lane'i en verimli seçimlerle yürütür, harici dosya okumadan | dış-referans yok ({TASK} hariç) | YEŞİL`
- `[2026-06-20] kind=phase | P7 gate (taze) | tsc 0 + vitest 174/1 skip (+7: drift 6 + RFC KAT 1, regresyon yok) + make harden 9 bats + drift-check exit0 (17 aligned) + swift build+test 15/0 (was 14, +1 KAT) | YEŞİL — GA`
- `[2026-06-20] kind=note | Next precomputed (→v11 Scripts-as-SaaS metering) | tool-registry.execute() metering noktasını oku (dokunma) → host tool invoke'larına per-call usage event (tenant+tool+latency+exit) billing/recordEvent seam'ine yay; çift-sayım önle (execute zaten sayıyorsa script-side sayma); canonical AGENTS.md SaaS metering backlog ile hizala`

## v11 — Autonomous Gate + Scripts-as-SaaS Metering ✅ (zero-manual)

- `[2026-06-20] kind=phase | P1 zero-manual gate | bin/host-bridge/gate.mjs pure runGate(steps,exec) injectable + CLI (tsc→vitest→harden→drift→swift→actionlint, exit-code zorunlu non-zero→throw, skip-loud); Makefile gate/ship; scripts-ci.yml macOS job→tek make gate | gate-runner.test.ts 5 case; canlı tsc-kırıkken GATE RED exit1→düzeltince GATE GREEN exit0 (RISK-SCR-014 false-green imkansız) | YEŞİL`
- `[2026-06-20] kind=phase | P2 host-cost metering | lib/metering.mjs pure meter(events,{toolTier,tierWeights,rate,budget}) per-tool tier-weighted billableUnits+estCost+period+budget; tools/usage.mjs host-tier seyir-stream raporu (--json/--month/--budget→exit1) | metering.test.ts 6 case; canlı usage self_heal 33call×host3=99units | YEŞİL`
- `[2026-06-20] kind=note | SCOPE düzeltmesi | tenant-billing SERVER-side (execute→store.recordUsage→stripe, tenantId) = integrations lane YASAK; host-bridge events tenant taşımaz → metering host-LOCAL cost telemetry, çift-sayım yok (RISK-SCR-013); execute()/store/billing DOKUNULMADI`
- `[2026-06-20] kind=phase | P3 registration | usage → inventory(v11.0.0)+schema.mjs+BUILDERS+tools/usage.mjs; drift-check 18 aligned exit0 | YEŞİL`
- `[2026-06-20] kind=phase | P4 zero-manual sözleşme | SCRIPTS_PORTABLE_PROMPT.md ZERO-MANUAL DECISION DEFAULTS (adoption/model/gate/commit auto; push+tag asla otomatik) + gate=make gate; SCRIPTS_AGENTS §6 GATE→make gate+auto-commit+zero-manual; TAB_IDENTITY self-refresh+make gate | — | YEŞİL`
- `[2026-06-20] kind=phase | P5 gate (TEK KOMUT) | make gate → PASS tsc/vitest 185-1/harden 9/drift 18/swift 15 · SKIP actionlint · GATE GREEN exit0 | 0 manuel işlem kanıtı | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v12 gate auto-commit + budget enforcement) | gate.mjs --commit modu (yeşilde per-file auto-stage+conventional commit, push hariç, scope-guard scripts/+bin/) + usage --budget'i make gate'e opsiyonel SLO-step; ilk hamle gate.mjs commit-step iskeleti (git status --porcelain parse)`

## v12 — Gate Auto-Commit + Budget Enforcement ✅ (zero-manual COMMIT)

- `[2026-06-20] kind=phase | P1 commit guard core | bin/host-bridge/lib/commit.mjs pure: parsePorcelain(rename) + isInScope(scripts/bin/.github-workflows/Makefile) + isConventional(spec regex marcojahn MIT) + commitDecision (scope-dışı tracked→block kontaminasyon, non-conv/boş-stage→block, node_modules ?? bloklamaz) | commit-guard.test.ts 7 case | YEŞİL`
- `[2026-06-20] kind=phase | P2 gate --commit | gate.mjs GATE GREEN sonrası --commit --message → git status --porcelain→commitDecision→per-file git add -- (asla -A)+git commit -m (arg-array, shell yok); push/tag YOK; gate RED/message-yok/non-conv→block exit1 | YEŞİL`
- `[2026-06-20] kind=phase | P3 budget SLO-step (opt-in) | defaultSteps USAGE_BUDGET env set ise usage --budget (Number-sanitized) step→over-budget gate RED; default OFF | YEŞİL`
- `[2026-06-20] kind=phase | P4 wire | make commit MSG=; SCRIPTS_PORTABLE_PROMPT + SCRIPTS_AGENTS §6 step-7 → gate --commit; TAB_IDENTITY | — | YEŞİL`
- `[2026-06-20] kind=phase | P5 gate + DOGFOOD | make gate GATE GREEN; v12 kendi gate.mjs --commit'iyle commit'lendi (zero-manual commit canlı kanıt, scope-guard geçti server/src yok) | git show --stat: yalnız scripts/+bin/+Makefile | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v13 gate --watch + auto-precompute) | gate.mjs --watch (node:fs.watch debounce, chokidar yok) otonom dev-loop + ROADMAP next-precomputed'tan sonraki versiyon iskelet (test/lib stub) üreten scaffold; ilk hamle fs.watch debounce-runner iskeleti`

## v13 — Gate Watch Dev-Loop + TDD Scaffold ✅ (zero-manual bootstrap)

- `[2026-06-20] kind=phase | P1 watch core | bin/host-bridge/lib/watch.mjs pure: debounce(fn,ms) trailing-edge (injectable timer) + isWatchable(path) IGNORE seti (node_modules/.git/dist/.build/coverage/.swiftpm) | watch-debounce.test.ts 4 case (collapse/cancel/ignore) | YEŞİL`
- `[2026-06-20] kind=phase | P2 gate --watch | gate.mjs fs.watch(scripts/+bin/ recursive macOS)→watchable→debounce(300ms)→runGate→verdict; watch read-only (commit/write YOK, self-trigger storm engeli RISK-SCR-017); SIGINT temiz | bounded smoke: başlar→ilk gate→kill, hang/exception yok | YEŞİL`
- `[2026-06-20] kind=phase | P3 scaffold | bin/host-bridge/scaffold.mjs pure scaffoldPlan (red vitest test + pure lib stub camelCase export, --tool→4-nokta checklist) + validSlug (path-traversal/slash red RISK-SCR-018) + --write no-overwrite + dry default + --from-roadmap; inventory'ye GİRMEZ (dev-time, drift 18 sabit) | scaffold.test.ts 5 case | YEŞİL`
- `[2026-06-20] kind=phase | P4 wire | make watch/scaffold; SCRIPTS_PORTABLE_PROMPT DECISION DEFAULTS + SCRIPTS_AGENTS §6 TDD scaffold/watch | — | YEŞİL`
- `[2026-06-20] kind=phase | P5 gate + DOGFOOD | make gate GATE GREEN (tsc/vitest/harden/drift 18/swift) + scaffold demo dry; v13 gate.mjs --commit ile self-commit | git show --stat server/src yok | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v14 incremental gate) | gate.mjs --since/değişen-dosya → etkilenen-step seçimi (.sh→harden+drift, swift→swift, .ts→tsc+vitest), watch'ta incremental koş (hız); ilk hamle lib/affected.mjs pure affectedSteps(changedPaths) + gate --since git-diff parse`

## v14 — Host-Bridge Security Hardening ✅ (CRITICAL, North Star §0-2)

- `[2026-06-20] kind=note | PIVOT (gereksiz-iş tespiti) | precomputed v14 incremental-gate=saf-DX cila→backlog; 2 read-only audit terminal-bridge'de 3 gerçek sömürülebilir açık buldu (kod-okuma kanıtlı) → v14=güvenlik (host op güvenlileştir, iOS/LAN ön-koşulu)`
- `[2026-06-20] kind=phase | P1 guard core | bin/host-bridge/lib/bridge-guard.mjs pure: safeWritePath(resolve+startsWith(root+sep) server/files.ts deseni) + withinLimit + bindRequiresAuth | bridge-security.test.ts 8 case | YEŞİL`
- `[2026-06-20] kind=fix | ERR-SCR-006 CRITICAL /write path-traversal | safeWritePath(WRITE_ROOTS=repo+tmp+~/.llm-mission-control) confine→escape 403; canlı curl /tmp/v14ok/../../etc/evilx→403, /etc/evilx oluşmadı, in-root→200 | YEŞİL`
- `[2026-06-20] kind=fix | ERR-SCR-007 high unbounded payload | readBody MAX_BODY 16MB append-durdur+413 (/run /exec /write); canlı 20MB→413 | YEŞİL`
- `[2026-06-20] kind=fix | RISK-SCR-019 high fail-open bind | bindRequiresAuth non-loopback+no-auth→exit1; canlı BRIDGE_BIND=0.0.0.0 no-token→REFUSING+exit; loopback dev korundu | YEŞİL`
- `[2026-06-20] kind=phase | P3 gate + DOGFOOD | /run+/exec dokunulmadı (/health 200 regresyon yok); make gate GREEN + bridge-security 8 + canlı saldırı smoke; v14 gate.mjs --commit self-commit | git show --stat server/src yok | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v15 real e2e bridge harness) | mock-only açığı kapat: bridge-e2e.test.ts opt-in (BRIDGE_E2E=1) gerçek terminal-bridge spawn+token+tool roundtrip+güvenlik regresyon (403/413) assert; ilk hamle startBridge(port,token) helper + health_probe assert`

## v15 — Real E2E Bridge Harness ✅ (mock-only açığı kapat)

- `[2026-06-20] kind=phase | P1 real-bridge helper | tests/helpers/real-bridge.mjs: freePort (net listen 0, PORT=0→7345 tuzağı bypass) + startRealBridge gerçek terminal-bridge spawn + /health-poll timeout'lu → {started,url,proc,exitCode,close SIGTERM+await}; mock-bridge.mjs deseni | YEŞİL`
- `[2026-06-20] kind=phase | P2 e2e test | bridge-e2e.test.ts skipIf(!BRIDGE_E2E): /health 200 + /exec echo roundtrip (gerçek bash) + v14 güvenlik regresyon-kilidi (traversal 403/etc-yazılmadı, oversized 413, no-auth 401, in-root 200) + fail-closed (0.0.0.0+no-auth→started:false exitCode≠0) | BRIDGE_E2E=1→3 pass, env yok→4 skip, leftover yok | YEŞİL`
- `[2026-06-20] kind=note | DÜRÜST limitasyon RISK-SCR-021 | 18 tool HEPSİ /run (osascript GUI+TCC) → per-tool roundtrip headless-edilemez (platform kısıtı). Sahte-geçen test YAZILMADI; e2e headless yüzeyi (/exec+güvenlik+fail-closed) kapsar, /run manual/local belgelendi. git_ops headless denendi→fail→kaldırıldı`
- `[2026-06-20] kind=phase | P3 wire + DOGFOOD | make e2e + scripts-ci.yml macOS gate step env BRIDGE_E2E=1 (CI gerçek e2e, local skip); RISK-SCR-020 (port/teardown) + 021; v15 gate.mjs --commit self-commit | make gate GREEN + drift 18 | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v16 install.sh LaunchAgent auto-load) | restart→bridge-down fix: install.sh plist install (renderPlist template→~/Library/LaunchAgents + launchctl bootstrap/enable, idempotent; uninstall bootout); ilk hamle pure renderPlist(template,{path,token}) + lib/test`

## v16 — LaunchAgent Auto-Load ✅ (reboot→bridge-down kapat)

- `[2026-06-20] kind=phase | P1 render-plist | bin/host-bridge/render-plist.mjs pure renderPlist(template,{repoPath,token,nodePath,port}): /usr/local/bin/node→command-v-node, REPLACE_WITH_*→değer, PORT enjekte; REPLACE_WITH leftover→throw (RISK-SCR-023), absolute/token assert | render-plist.test.ts 6 case + canlı render REPLACE=0 | YEŞİL`
- `[2026-06-20] kind=phase | P2 install-agent.sh | DRY-guarded idempotent: token-ensure (start-bridge deseni)→render→~/Library/LaunchAgents chmod 600 (token plaintext RISK-SCR-022)→launchctl bootout||true→bootstrap gui/UID→enable→kickstart -k (modern API, load değil) | launchagent.bats DRY no-write | YEŞİL`
- `[2026-06-20] kind=phase | P3 wire | install.sh macOS run bash install-agent.sh; uninstall.sh bootout+rm plist (purge öncesi); Makefile SH_FILES+=install-agent.sh + install-agent/DRY target; plist 'render-only' yorum; shfmt -w format | make harden 11 bats clean | YEŞİL`
- `[2026-06-20] kind=note | GÜVENLİK kararı (outward-facing) | gerçek launchctl bootstrap = kullanıcı Mac'inde kalıcı daemon (port 7345) → BEN koşmadım; DRY_RUN+unit ile kanıt; gerçek install=operatör install.sh. Dogfood yalnız kodu commit'ler`
- `[2026-06-20] kind=phase | P4 gate + DOGFOOD | make gate GREEN (render-plist 6 + harden 11) + drift 18; v16 gate.mjs --commit self-commit | git show --stat server/src yok | YEŞİL`
- `[2026-06-20] kind=note | Next precomputed (→v17 efficient local-model auto-select) | North Star §0-1: scripts-v4 bench-metrics tok/s tüket → pure pickModel(benchResults,{minTokS,fitsRAM}) + model-select.mjs host-tool (benchmark.json→en-hızlı-doğru model); ilk hamle lib/model-select.mjs pickModel + fixture test`

---

## Hata Anlatıları

### ERR-SCR-001 (CRITICAL) — Paylaşılan working tree branch hijack
- `[2026-06-19] kind=error | v2 commit aşamasında git log HEAD'in feat/scripts-v1 değil c19a0b6 (v1.3 merge) olduğu görüldü; scripts/ governance dosyaları working tree'den kayıp. reflog: eşzamanlı sekme `checkout scripts-v1→main→v1.4→frontend-vf1` yapmış. v2 işim frontend branch'inde duruyordu — oraya commit = cross-tab kontaminasyon (RISK-SCR-005 gerçekleşti).`
- `[2026-06-19] kind=fix | SCRIPTS_AGENTS §6 hard-stop → kullanıcıya soruldu → İZOLE WORKTREE seçildi: git worktree add ~/Desktop/ollamas-scripts-wt feat/scripts-v1; v2 dosyaları kopyalandı; burada commit. Paylaşılan tree dokunulmadı. Prevention: scripts sekmesi BUNDAN SONRA hep bu worktree'de çalışır; her oturum başı branch teyidi.`

> Kural (SCRIPTS_AGENTS.md §9): registry'deki bir hata **asla tekrarlanmaz**; tekrarlanırsa `recurrence_count++` + prevention_rule güçlendirilir.
