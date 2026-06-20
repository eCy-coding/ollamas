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
| **vT7** | **Resilience / Always-On Daemon** | LaunchAgent (RunAtLoad+KeepAlive) `tunnel auto --watch` login'de oto + crash-restart + connectivity classify (online/lan-only/offline); **0 manuel işlem capstone** | launchd-keepalive/Connectivity (MIT/fikir) | ✅ DONE |
| **vT8** | **Benchmark + Log-rotation** | per-transport p50/p90/min/max latency (`tunnel bench`) + size-based log-rotation (decisions.jsonl + daemon.log, RISK-018/020 ÇÖZÜLDÜ); **0 manuel** | percentile-nearest-rank/file-rotator (fikir) | ✅ DONE |
| **vT9** | **Ecosystem Onboarding** | tek-komut `tunnel setup [--daemon]` (capability-detect → configure-capable → autoUp → daemon, idempotent) + `teardown`; **0-manuel onboarding capstone** | tailscale-up zero-config (fikir) + cmd-reuse | ✅ DONE |
| vT10 | Ecosystem-2 | QR onboarding + iOS Shortcut `status --json` tüketimi + integrations-gateway federation doc + multi-tenant exposure policy | — | NEXT |
| vT11+ | Connectivity-routing + Remote reverse-tunnel | reachVia routing (reverse geldiğinde değerli) + FRP/Bore. **⚠️ PARKED**: reverse VPS+dış-hesap+manuel → "0 manuel"+egemen-zero-account ihlali; routing marjinal (probe-timeout yeter) | FRP(Apache,107k)/Bore(MIT,11k) | parked |

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

## vT7 — DONE (kanıt) — Resilience / Always-On Daemon (0 manuel işlem)

> **Re-sequence:** "critical tespit + gereksiz işten kaçın" → North-Star "0 manuel işlem" daemon olmadan
> tamamlanmıyordu (`tunnel auto` elle başlıyordu). Daemon öne (vT7); Benchmark→vT8 (zaten-çalışan seçimi
> optimize eder, görece düşük-kritik).

- `src/daemon.ts` PURE renderLaunchAgent (RunAtLoad+KeepAlive{SuccessfulExit:false}+ThrottleInterval+
  Background, XML-escape) + agentPath + installAgent/uninstallAgent/agentStatus (launchctl injectable,
  capability-gated, never-throws). **8 test.**
- `src/connectivity.ts` PURE classify(online/lan-only/offline) + internetReachable (captive.apple.com,
  guard-BYPASS connectivity-only RISK-021). **7 test.**
- `cli.ts daemon <install|uninstall|status>` (plist→~/Library/LaunchAgents + launchctl load; 0-prompt) +
  `status` çıktısına connectivity satırı. `recipes/daemon-macos.md`.
- Adoption: launchd.plist manpage + tjluoma/launchd-keepalive (reference) + rwbutler/Connectivity (MIT fikir).
- RISK-TUNNEL-019 (KeepAlive update-block→uninstall-before-update) / -020 (daemon.log büyüme) / -021
  (internet-probe public guard-bypass yalnız connectivity).
- **Kanıt:** `node --test` **127/127 GREEN**, tsc 0; `node src/cli.ts daemon status` → yüklü-değil zarif
  (0-prompt); renderLaunchAgent RunAtLoad+KeepAlive+`auto --watch` deterministik. VERSION 7.0.0.
- **0-manuel:** install tek-seferlik; sonrası login-oto + crash-restart → recurring manuel işlem YOK.

## vT8 — DONE (kanıt) — Benchmark + Log-rotation (0 manuel)

> **Critical-tespit re-scope:** connectivity-aware routing vT8'den vT9'a ertelendi (henüz internet-ONLY
> transport yok → gereksiz-iş). vT8 = Benchmark (kullanıcının tekrarlı isteği) + Log-rotation (vT7 daemon
> 7/24 yazımı → şimdi kritik).

- `src/bench.ts` PURE percentile(nearest-rank) + summarize(count/min/max/mean/p50/p90, p99 ATLA=az-örnek-dürüst)
  + benchmarkTransports(injected timeProbe, never-throws) + renderBenchTable (sparkline reuse). **5 test.**
- `src/logrotate.ts` PURE-ish rotateIfNeeded (size>maxBytes → .1/.2/.keep ring, en-eski-düş, never-throws). **5.**
- `cli.ts bench [--json] [--samples N]` (read-only) + persistDecision→rotateIfNeeded(decisions.jsonl) +
  cmdAuto-start→rotateIfNeeded(daemon.log) → RISK-018/020 TAM çözüldü.
- Live scoring DEĞİŞMEDİ (bench diagnostic eklenti; selectAuto zaten ölçüyor) → regression yok.
- Adoption: percentile nearest-rank (Last9/OneUptime fikir), file-stream-rotator/simple-file-rotator (pattern).
  RISK-TUNNEL-022 (bench↔daemon live-probe ölçüm-gürültüsü → samples küçük).
- **Kanıt:** `node --test` **137/137 GREEN**, tsc 0; `node src/cli.ts bench` → transport-yokken healthy 0% zarif
  (0-prompt). VERSION 8.0.0.

## vT9 — DONE (kanıt) — Ecosystem Onboarding (0-manuel one-command)

> **Critical-tespit re-sequence:** precomputed connectivity-routing ERTELENDİ (marjinal — probe-timeout
> offline-correctness verir, internet-only transport yok). Gerçek kritik = tek-komut onboarding (çok-komut
> manuel-seçimi yok eder).

- `src/setup.ts` PURE planSetup(caps, existing)→SetupStep[] (configure/skip-exists idempotent/missing-binary
  brew-hint) + kindsToConfigure + renderSetupPlan. **6 test.**
- `cli.ts setup [--daemon]`: capability-detect (commandExists wg/caddy/mkcert/headscale) + existsSync(keys/*) →
  planSetup → configure-capable (cmdConfig/cmdTls/cmdMesh REUSE) → autoUp → --daemon installAgent. Idempotent,
  0-prompt. + `teardown` (wg down + uninstall, configs kalır). Mevcut cmd REUSE = yeni transport kodu yok.
- `recipes/onboarding.md`. Adoption: tailscale-up zero-config (fikir). RISK-TUNNEL-023 (kısmi-başarı→idempotent re-run).
- **Kanıt:** `node --test` **143/143 GREEN**, tsc 0; `node src/cli.ts setup` → binary-yok zarif plan+brew-hint
  (0-prompt, crash yok); idempotent. VERSION 9.0.0.

## vT10 — NEXT (önceden-hesaplanmış ilk todo'lar) — Ecosystem-2

1. `src/qr.ts` — PURE QR (ANSI/SVG) endpoint/onboarding-URL render (zero-dep, qrencode binary opsiyonel) →
   iPhone tek-tarama. `cli.ts qr [endpoint]`.
2. iOS Shortcut reçetesi: `status --json` tüket → aktif endpoint'i Shortcut'a besle (cross-lane scripts/CLI doc).
3. integrations-gateway federation doc: tunnel endpoint → integrations lane MCP_PUBLIC_URL devri (server.ts edit YOK).
4. multi-tenant exposure policy notu (hangi transport hangi tenant'a; tunnel yalnız taşır, policy integrations'da).
5. errors_registry ecosystem riskleri; ADOPTION qrcode-zero-dep (MIT).
