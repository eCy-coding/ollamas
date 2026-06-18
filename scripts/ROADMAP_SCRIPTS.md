# ROADMAP_SCRIPTS.md — 10 Versiyon

> Yürütme: `SCRIPTS_AGENTS.md` §6 trigger protokolü. Her versiyonun sonunda **"Next precomputed"** bloğu vardır — bir sonraki versiyonun ilk hamlesi orada hazırdır, böylece iş asla durmaz.
>
> Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. Güncel: **v1 ✅ · v2 ✅** (test harness, 86 pass/1 skip), **v3 NEXT**.
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

## v3 — iOS Bridge (Shortcuts + Swift CLI) ⬜

**Tema:** Yeteneği iPhone'a ulaştır — HTTP/MCP-only, app-iç coupling yok.

**Phases:**
1. `bin/ios-bridge/` Swift CLI: `Package.swift` + `URLSession` HTTP client, MacBook'a `/mcp` + `/api/generate`.
2. Swift **HMAC client**: `canonicalMessage` (`METHOD\nPATH\nBODY\nTIMESTAMP\nNONCE`) aynası; HMAC-SHA256.
3. Apple **Shortcuts** tanımları (`.shortcut` / dökümante akış): `/mcp` tool çağrısı tetikler.
4. **NTP-aware timestamp** (clock-skew riski — bkz. errors_registry kategori `hmac`).
5. Secret = **Keychain** (plist değil); dökümante et.

**Canonical prompt:** "iOS Swift CLI köprüsü kur (`bin/ios-bridge/`): HTTP/MCP-only, canonicalMessage HMAC aynası, NTP-aware ts, Keychain secret, Shortcuts akışı; MacBook'a /health roundtrip kanıtla."

**Next precomputed (→v4):** `benchmark.mjs`'e `--platform` arg parse iskeleti + `benchmark.json` şemasına `platform`/`device` anahtarı.

---

## v4 — Cross-Platform Efficiency Bench ⬜

**Tema:** MacBook vs iOS'ta en verimli yöntemi ölçümle bul.

**Phases:**
1. `benchmark.mjs --platform macos|ios`: ortak deterministik task, ölç latency / tok-s / success-rate / transport RTT.
2. iOS tarafı: Swift CLI sonucu `benchmark.json`'a `platform+device+method` anahtarıyla post eder.
3. `calibrate_hardware.py` per-device profil (CPU/RAM/thermal class).
4. Platform başına **en hızlı *doğru*** method seç; rapor.
5. Regresyon eşiği (CI'da fail için).

**Canonical prompt:** "benchmark.mjs'i çok-platformlu yap (--platform macos|ios), iki tarafı `benchmark.json`'a yaz, platform başına en hızlı doğru method'u seç, regresyon eşiği koy."

**Next precomputed (→v5):** `server/tool-registry.ts` register-seam'ini bul (mevcut `run_tests`/`lint_format` register satırları); `registerHostScripts()` imza taslağı.

---

## v5 — Script-tool Registration Hooks ⬜

**Tema:** Scriptleri choke-point'e doğru tier'la, temiz seam'le bağla.

**Phases:**
1. `registerHostScripts(deps)` — `scripts/inventory.json`'dan tier + schema okuyup `ToolRegistry.register()`.
2. Reload'da `unregisterByPrefix("script__")` → çift kayıt yok.
3. **Schema-from-manifest**: her tool'un input schema'sı manifest'ten gelir.
4. Hard wrapper: server edit'i yalnız register satırı (§3 escalate guard).
5. Gate: e2e tool çağrısı choke-point'ten geçiyor (`master_e2e_workflow.ts`).

**Canonical prompt:** "scriptleri ToolRegistry'e `registerHostScripts()` ile bağla: manifest'ten tier+schema, reload'da unregisterByPrefix, sadece register-seam'e dokun; e2e choke-point doğrula."

**Next precomputed (→v6):** tüm `.sh`'ı `shellcheck` ile tara (kuru), bulguları `errors_registry.json` kategori `portability`'e listele.

---

## v6 — Hardening & Portability ⬜

**Tema:** Shell'i kırılmaz ve BSD/macOS-taşınır yap.

**Phases:**
1. Tüm `.sh` → `shellcheck` temiz.
2. BSD vs GNU divergence pass (`sed -i`, `date`, `readlink`, `grep -P` vb.).
3. `set -euo pipefail` audit — eksik olan scriptlere ekle.
4. `Makefile` reproducibility (Go/Rust/C hedefleri deterministik).
5. Gate: shellcheck CI gate'i taslağı.

**Canonical prompt:** "tüm .sh'ı shellcheck-temiz + BSD/GNU taşınır yap, set -euo pipefail audit, Makefile reproducibility; shellcheck gate ekle."

**Next precomputed (→v7):** `tools_doctor.mjs` + `health_probe.mjs`'i oku; auto-repair remediation map taslağı (port 7345, plist reload).

---

## v7 — Self-Healing ⬜

**Tema:** Bridge kendini onarsın.

**Phases:**
1. `tools_doctor.mjs` extension: bridge down → auto-restart (port 7345), plist reload, key rotation.
2. `health_probe.mjs` → remediation map (sorun → düzeltme thunk).
3. Idempotent repair (tekrarlı çalıştırma güvenli).
4. Repair denemeleri seyir'e loglanır.
5. Gate: simüle arıza → otomatik recover testi.

**Canonical prompt:** "bridge self-healing: tools_doctor auto-restart + plist reload + key rotation, health_probe remediation map, idempotent, simüle arıza recover testi."

**Next precomputed (→v8):** `logbook.mjs`'i oku; structured seyir event şeması (`latency`/`exit`/`device`/`tool`).

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
