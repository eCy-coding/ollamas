# ollamas Tunnel Lane — ROADMAP (vT1 → vT10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla.
> Her versiyonun "done" tanımı sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Adopt | Durum |
|-----|------|----------|-------|-------|
| **vT1** | Foundation + iOS reach | governance 5-dosya + `Transport` iface + `switch.ts` skeleton + **WireGuard p2p** (QR, zero-acct) + iPhone→ollamas 200 e2e | wireguard-apple(MIT), wireguard-tools | ✅ DONE (97d65a1) |
| **vT2** | LAN-TLS | Caddy reverse-proxy + mkcert local CA + **iOS .mobileconfig render** + `<Mac>.local` auto-host → `https://<host>.local` | Caddy(Apache,73k), mkcert(BSD,59k) | ✅ DONE |
| **vT3** | Sovereign mesh | Headscale self-host control-plane + embedded DERP + zero-account preauth; çok-cihaz + remote tek overlay (WG data-plane reuse) | Headscale(BSD,38k) binary-only | ✅ DONE |
| **vT4** | **Otonom Switch Engine** | ölçülen-latency scoring + 3-durum circuit-breaker + hysteresis (anti-flap) + autopilot (capability-detect + auto-up + self-heal) + decision-log; **0 manuel seçim/işlem** | hysteresis/CB/multipath pattern (fikir/MIT) | ✅ DONE |
| **vT5** | **Security hardening** | private-host DNS-rebind guard + AES-256-GCM vault (auto-keyfile, **0-manuel**) + age-based auto WG key-rotation; mTLS ertelendi (iPhone client-cert manuel) | guard/GCM/rotation pattern (fikir/MIT) | ✅ DONE |
| **vT6** | **Observability** | `tunnel status [--json\|--watch]` (active + latency sparkline + breaker) + secret-free decision-log JSONL feed → orchestration cockpit; pure, **0-manuel** | node-sparkline/CLI-best-practice/JSONL-feed (MIT/fikir) | ✅ DONE |
| vT7 | Benchmark | MacBook↔iOS per-transport latency/throughput, en-verimli seçim, leaderboard (scripts bench-metrics reuse) | — | NEXT |
| vT8 | Resilience | auto-reconnect, LaunchAgent daemon, NAT/captive-portal detect, IPv6, fallback-chain | — | planned |
| vT9 | Remote reverse-tunnel | kendi VPS'te FRP/Bore server. **⚠️ ERTELENDİ (parked)**: VPS+dış-hesap+manuel → "0 manuel" + egemen-zero-account ihlali; yalnız kullanıcı açıkça remote-erişim isterse | FRP(Apache,107k)/Bore(MIT,11k) | deferred |
| vT10 | Ecosystem | `ollamas tunnel up` one-command, QR onboarding, federation w/ integrations gateway, multi-tenant exposure policy | — | planned |

---

## vT1 — Detay (IN PROGRESS)

**Done tanımı:** iPhone → ollamas `200 OK` (WireGuard p2p üzerinden), switch iskeleti + testler green.

- **P0** Lane bootstrap: worktree + 5 governance dosya + package.json/tsconfig + VERSION. ✅
- **P1** Switch iskeleti (TDD): `transport.ts` iface, `switch.ts` registry+select, `health.ts` probe + node:test. ✅ (12 test)
- **P2** WireGuard transport: `transports/wireguard.ts` keygen+config render+QR; `cli.ts`; `recipes/wireguard-ios.md`. ✅ (19 test, tsc 0)
- **P3** iOS e2e: WireGuard app QR import → `curl http://10.7.0.1:3000/healthz` → 200. ⏳ kod+reçete hazır; cihaz-kanıtı Emre'de.
- **P4** Kalite kapısı (test 19/19 + tsc 0) + conventional commit + bu blok güncelle. ✅

---

## vT2 — DONE (kanıt)

- P1 `mobileconfig.ts` pure plist render (com.apple.security.root payload, 7 test).
- P2 `transports/caddy-tls.ts` detectLocalHostname(scutil)+renderCaddyfile+CaddyTlsTransport(pri LAN_TLS, 6 test).
- P3 `health.ts` `probeHttpsInsecure` (node:https rejectUnauthorized:false, injectable, 5 yeni test).
- P4 `cli.ts tls` (mkcert -install+cert + Caddyfile + rootCA→.mobileconfig) + `select` LAN-TLS>WireGuard + `recipes/caddy-mkcert-ios.md`.
- P5 Gate: **37/37 test, tsc 0**. iOS cihaz-kanıtı (https://<host>.local 200) Emre'de (reçete hazır).

## vT3 — DONE (kanıt)

- **Karar (research):** mesh motoru = Headscale. M4+iOS+egemen+kod-bütünlüğü matrisi → vT1 WireGuard data-plane reuse + tek hafif Go binary + iOS alternate-coordination-URL (no-MDM) + BSD-3 binary-invoke. Nebula (kendi protokol→sapma) ve NetBird (ağır) elendi (ADOPTION karar-log).
- P2 `transports/headscale.ts` PURE: renderHeadscaleConfig (sqlite + gömülü DERP) + clientUpCommand (login-server, default <PREAUTH_KEY> placeholder) + preAuthKeyCommand + createUserCommand + serviceUrl. **10 test.**
- P3 `HeadscaleTransport implements Transport` (name=headscale, priority=PRIORITY.MESH, explicit field'lar, probe=probeHttp(meshIp), spawn `headscale serve`).
- P4 `recipes/headscale-ios.md` (brew→config→serve+preauth→iPhone alternate-URL→register→/healthz 200, zero-account).
- P5 `cli.ts mesh` (config.yaml + preauth adımları, keys/ 0600 gitignored) + `select` LAN-TLS>WireGuard>Headscale.
- **Bonus root-fix ERR-TUNNEL-002:** `npm test` glob sh'de `**` desteklemiyordu (21 koşuyordu) → `node --test` auto-discovery → **48/48 GREEN**, tsc 0.
- errors_registry: RISK-TUNNEL-008 (NAT/DERP), -009 (iOS Tailscale-client), -010 (preauth-key sızıntısı).
- iOS cihaz-kanıtı (`http://100.64.0.1:3000/healthz` 200, mesh) Emre'de (reçete hazır).

## vT4 — DONE (kanıt) — Otonom Switch Engine

> **Re-sequence:** "0 manuel seçim/işlem" kısıtı reverse-tunnel'i (VPS/hesap/manuel) geçersiz kıldı →
> vT4 = Switch Engine (eski vT5) öne alındı; Security vT5'e, reverse-tunnel vT6'ya (deferred) kaydı.

- **Karar (research):** hysteresis (iki-eşik+hold-down, Google Patents US20230012193A1+SD-WAN), 3-durum
  circuit-breaker (TS-CB deseni dev.to/Resily MIT + orchestration MCP_CB), lowest-latency scheduler
  (sigcomm20 mptp). Hepsi fikir/pattern-port (lisanssız→fikir, MIT→pattern), zero-dep.
- `src/breaker.ts` PURE 3-durum circuit-breaker (closed/open/half-open, enjekte clock). **6 test.**
- `src/scoring.ts` PURE `scoreCandidate` (latency*1+priority*10, düşük=iyi) + `chooseWithHysteresis`
  (margin+holdRounds anti-flap, breaker-open elenir). **10 test.**
- `src/switch.ts` `selectAuto` (paralel zamanlı probe `performance.now()` + breaker + scoring + hysteresis
  + decision-log) — `select()` geri-uyumlu korundu. **+5 test.**
- `src/autopilot.ts` `detectCapable`/`autoUp`/`runLoop` — capability-detect (binary on PATH) + best-capable
  auto-up + self-heal loop; never-throws, **0 prompt**. **6 test.**
- `cli.ts auto [--watch]` (0-manuel: oto-detect→selectAuto→auto-up→decision-log JSON) + `select`→selectAuto.
- errors_registry: RISK-TUNNEL-011 (flapping→hysteresis çözdü), -012 (auto-up yalnız capable binary),
  -013 (decision-log secret-free).
- **Kanıt:** `node --test` **75/75 GREEN**, tsc 0; `node src/cli.ts auto` → binary yokken zarif
  "no capable transport" (sıfır prompt). 0-manuel: kullanıcı hiç seçim yapmaz/komut çalıştırmaz.

## vT5 — DONE (kanıt) — Security hardening (0 manuel)

- `src/guard.ts` PURE isPrivateHost/assertPrivateUrl (loopback/RFC1918/CGNAT 100.64/.local) → `health.ts`
  opt-in `requirePrivateHost` (default false=geri-uyum); 3 transport `probe()` true geçer → public/rebind
  hedef reddedilir. **7+4 test.**
- `src/crypto.ts` PURE AES-256-GCM seal/open (12-byte IV, authTagLength:16, base64 zarf; tamper→throw). **7 test.**
- `src/keystore.ts` loadOrCreateKeyfile (auto 32-byte 0600, passphrase YOK) + sealToFile/openFromFile
  (graceful-degrade). **5 test.**
- `src/rotate.ts` PURE needsRotation/daysUntilRotation (yaş-tabanlı) + rotationPlan (render reuse, /32 korunur).
  **5 test.**
- `cli.ts rotate [--force]`: yaş-tabanlı oto-rotation; eski config rotation öncesi vault.enc'e seal (auto-keyfile);
  0-prompt (wg yoksa zarif).
- **mTLS ERTELENDİ** (iPhone client-cert manuel = 0-manuel ihlali). errors_registry RISK-TUNNEL-014 (auto-keyfile
  co-location limiti, dürüst) / -015 (rotation AllowedIPs-overlap-yasak) / -016 (guard public-host-refuse).
- **Kanıt:** `node --test` **103/103 GREEN**, tsc 0; `node src/cli.ts rotate` → wg yoksa zarif mesaj (0-prompt).

## vT6 — DONE (kanıt) — Observability (0 manuel)

- `src/status.ts` PURE: `statusReport(decisions)` (aktif/reason/transports/per-transport latency history) +
  `sparkline(values)` (▁▂▃▄▅▆▇█, node-sparkline pattern) + `renderStatusTable` + `appendDecision`/
  `readDecisions` JSONL (secret-free, limit=son-N-geçerli, bozuk-satır-atla). **9 test.**
- `cli.ts status [--json|--watch]`: canlı probe → tablo/JSON; --watch alt-ekran + SIGINT-restore (N-016).
  `auto`/`select`/`status` → `keys/decisions.jsonl` feed yazar (best-effort).
- `recipes/observability-feed.md`: cross-lane handoff (orchestration cockpit feed'i tail/parse eder; iki taraf
  birbirinin kodunu düzenlemez).
- **Eksik-temizlik:** VERSION 1.0.0→6.0.0 (+ package.json) align; whoami.sh `**` strip + drift-check
  hardcoded `=="1.0.0"` → major(VERSION) vs son-vT karşılaştır. **vT5 commit'lendi** (be9124f, kaldığın-yer).
- RISK-TUNNEL-017 (watch terminal-restore) / -018 (JSONL büyüme→read-limit, tam rotation vT8).
- **Kanıt:** `node --test` **112/112 GREEN**, tsc 0; `node src/cli.ts status --json` → transport yokken zarif
  active:null (0-prompt); feed secret-free.

## vT7 — NEXT (önceden-hesaplanmış ilk todo'lar) — Benchmark

1. `src/bench.ts` — PURE per-transport latency/throughput örnekleme (selectAuto timed-probe serisini topla) +
   p50/p90 özet (yaklaşık, CLI top N-018 deseni). Leaderboard skor reuse (scoring.ts).
2. `cli.ts bench [--json]` — her transport'a N-örnek probe → tablo (tok/s değil, ms/throughput); 0-manuel.
3. scripts lane `bench-metrics.mjs` çıktı-formatı ile uyumlu (cross-lane doküman, edit YOK).
4. decision-log JSONL'den geçmiş latency → benchmark trend (status.ts history reuse).
5. errors_registry bench riskleri; ADOPTION MinhNgyuen/llm-benchmark (MIT, ölçüm deseni).
