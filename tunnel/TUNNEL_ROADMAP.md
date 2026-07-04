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
| **vT10** | **Live Integration Fix + `doctor`** | health-path /healthz→**/api/health** (ERR-TUNNEL-003, gerçek ollamas'a karşı tünel kırıktı) + `tunnel doctor` canlı e2e self-test; **CANLI 200 kanıtı** | ollamas-introspection | ✅ DONE |
| **vT11** | **Konsolidasyon Adaptasyonu + Canlı E2E** | lane `ollamas-tunnel-wt`→`ollamas/tunnel` (integration/all-lanes), 10-dosya path-fix + whoami branch-guard + ERR-TUNNEL-004; **entegre-tree'de canlı doctor OK** | — | ✅ DONE |
| **vT12** | **Proxy Gateway ("use everywhere" core)** | zero-dep streaming reverse-proxy: `proxy.ts` pure core (route/auth/rewrite/vault) + `proxy-server.ts` IO shell + `ratelimit.ts` token-bucket; pxy_ auth (timing-safe) + secret-free access-log + path-allowlist; `/v1`→ollama:11434 (OpenAI-compat), `/api`+`/mcp`→ollamas:3000 (Host/Origin rewrite); `cli proxy up/down/status/key/daemon` + setup/doctor wiring; **T0-kararı: mesh + Cloudflare ikisi birden** | node built-ins only | ✅ DONE |
| vT13 | Cloudflare REVERSE transport | `transports/cloudflare.ts` (Transport, PRIORITY.REVERSE=30, injected exec): quick-tunnel (hesapsız, ephemeral trycloudflare URL) + named-tunnel (ops., stabil host); **auth-gate: aktif pxy_ key yoksa up() reddeder (RISK-TUNNEL-024)**; selectAuto/autopilot/status/bench oto-entegre; doctor --full public e2e | cloudflared(Apache-2.0) binary-only | NEXT |
| vT14 | Ecosystem-2 | QR onboarding (`tunnel qr`) + iOS Shortcut `status --json` tüketimi + integrations-gateway endpoint handoff doc | — | parked |
| vT14+ | Connectivity-routing + FRP/Bore reverse | reachVia routing + FRP/Bore. **⚠️ PARKED**: VPS+dış-hesap+manuel ihlal; CF quick-tunnel (vT13) hesapsız reverse ihtiyacını karşılar | FRP(Apache,107k)/Bore(MIT,11k) | parked |

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

## vT10 — DONE (kanıt) — Live Integration Fix + `doctor`

> Kullanıcı "ollamas'ı çalıştır + gerçek görevde test et" dedi → 9 versiyon unit-test'liydi ama hiç canlı
> ollamas'a koşulmamıştı. Canlı koşum **ERR-TUNNEL-003** açığa çıkardı (tünel gerçek ollamas'a karşı kırıktı).

- **ERR-TUNNEL-003 fix:** merkezi `HEALTH_PATH` (default `/api/health`, env-override); probeHttp/probeHttps default
  + 3 transport probe + cli prints + 3 recipe `/healthz`→`/api/health`.
- `src/doctor.ts` PURE buildDoctorReport + renderDoctorReport; `cli.ts doctor [--json]` canlı e2e (ollamas
  upstream probe + selectAuto + connectivity + capable). **doctor 3 + health +2 test.**
- **CANLI KANIT:** `node src/cli.ts doctor` → `ollamas upstream : OK 46ms (http://localhost:3000/api/health)`,
  exit 0, connectivity online. Regresyon: `OLLAMAS_HEALTH_PATH=/healthz` → UNREACHABLE(401) vs default → OK.
- **Kanıt:** `node --test` **148/148 GREEN**, tsc 0. VERSION 10.0.0. (select "no healthy transport" = transport
  binary'leri yok; upstream-probe DOĞRU = Emre cihaz-kanıtı transport-IP'leri için.)

## vT11 — DONE (kanıt) — Konsolidasyon Adaptasyonu + Canlı E2E

> Kullanıcı "ollamas'ı çalıştır + tüm değişiklikleri projeye entegre et + canlı test" dedi. Bulgu: lane'ler
> `~/Desktop/ollamas` (integration/all-lanes) altında KONSOLİDE edilmiş; tünel zaten entegre (vT1-vT10).

- **Durum:** izole worktree `ollamas-tunnel-wt` silindi → lane `~/Desktop/ollamas/tunnel/` (integration/all-lanes).
  Git-entegrasyonu ZATEN yapılmış (tunnel/ ağaçta, 148 test, tsc 0).
- **Fix (ERR-TUNNEL-004):** 10 dosyada stale `ollamas-tunnel-wt`→`ollamas/tunnel`; whoami branch-guard
  {feat/tunnel-v1|integration/*}; AGENTS/IDENTITY konsolidasyon notu. (zsh word-split gotcha→xargs.)
- **Kararlar:** PUSH YOK (yalnız tunnel/** yerel commit; cross-lane+outward, remote eCy-coding≠adobemre1).
  connectivity-routing/QR → vT12.
- **CANLI E2E (entegre tree):** `node src/cli.ts doctor` → ollamas upstream OK ~22ms /api/health; whoami →
  integration/all-lanes (hijack-uyarısı yok); node --test 148/148; tsc 0. VERSION 11.0.0.

## vT12 — DONE (kanıt) — Proxy Gateway ("use everywhere" core)

> T0 (Emre) "her yerde kullanılabilir proxy server" istedi + AskUser kararı: **mesh + Cloudflare ikisi birden**,
> tam gateway, tunnel lane. Eski vT12(QR/Ecosystem-2) → vT14'e kaydırıldı (silinmedi). Plan:
> `~/.claude/plans/ollamas-projesini-focuslan-isteklerimi-robust-stardust.md`.

- **P1 `src/ratelimit.ts`** — pure token bucket (injected clock, LRU-bound maxKeys=10k → sınırsız-IP guard). 10 test.
- **P2 `src/proxy.ts`** — PURE core: `routeRequest` path-allowlist (`/v1`→ollama, `/mcp`+`/api`→ollamas, gerisi
  404; lexical `..`-normalize), `authorize` (Bearer/X-Proxy-Key `pxy_`, SHA-256 + timingSafeEqual, revoked-reject),
  `rewriteHeaders` (Host/Origin→localhost — ollamas `/mcp` origin-allowlist şartı; inbound x-forwarded-*/x-proxy-key
  strip; authorization DOKUNULMAZ upstream'e), vault ops (addKey raw-BİR-KEZ, revokeKey, listKeys sha256-sızdırmaz).
  UPSTREAMS 127.0.0.1'e hard-pin (RISK-TUNNEL-026). 19 test.
- **P3 `src/proxy-server.ts`** — IO shell: node:http(s) `pipe()` streaming (SSE buffersız — testte gerçek
  ephemeral-port stub, chunk-1 stream-bitmeden gözlendi), gate sırası route(404)→health-public→auth(401,
  body-öncesi)→ratelimit(429)→forward; upstream-down→jenerik 502 (errno/url sızmaz); JSONL access-log
  secret-free (keyPrefix-only, RISK-TUNNEL-025) + rotateIfNeeded reuse. requestTimeout=0 (uzun stream). 12 test.
- **P4 `cli.ts proxy`** — up/down/status/key add|list|revoke/daemon install|uninstall|status;
  `parseProxyArgs` (default :8443 + mkcert TLS; `--no-tls` cloudflared/loopback için), `proxyDaemonPlan`
  (label com.ollamas.tunnel.proxy, renderLaunchAgent REUSE). 4 test.
- **P5 setup/doctor wiring** — planSetup `proxy` kind (binary'siz, idempotent vault+default-key; readiness'e
  sayılmaz — gateway katmandır, transport değil); doctor proxy fazı (canlı 401-without-key + keyed health). 6 test.
- **CANLI KANIT (gerçek ollamas :3000 + ollama :11434):** `proxy up --no-tls` → no-key `/api/agent/chat`=**401**,
  public `/api/health`=**200**, keyed health=**200**, `/admin`=**404**, keyed `/v1/models`=**200** (ollama model
  listesi gateway'den aktı); `doctor` → `proxy gateway: UP / 401 without key: OK / keyed /api/health: OK 3ms`,
  exit 0. `/v1/chat/completions` canlı LLM turu upstream-doygunluğunda takıldı (fleet qwen3:8b'yi kullanıyordu;
  gateway'siz direkt :11434 de AYNI şekilde asıldı = parite kanıtı, darboğaz gateway değil; SSE geçişi P3
  gerçek-soket testiyle kanıtlı).
- **Kanıt:** `node --test` **199/199 GREEN** (148→199), tsc 0. VERSION 12.0.0. RISK-TUNNEL-024/025/026 kayıtlı.
  `recipes/proxy-gateway.md`. Commits: 9452cc9, bfca3fd, 86b05da, 60bfbc0, e8985fb (+bookkeeping).

## vT13 — NEXT (önceden-hesaplanmış ilk todo'lar) — Cloudflare REVERSE transport

1. `src/transports/cloudflare.ts` + test (TDD): `parseQuickTunnelUrl` (cloudflared stderr'den
   `https://*.trycloudflare.com` yakala), injected-Exec `up()` (`cloudflared tunnel --url http://127.0.0.1:8443
   --no-autoupdate`; **aktif pxy_ key yoksa THROW — RISK-TUNNEL-024 auth-gate**), `down()` idempotent,
   `probe()`=probeHttps(publicUrl+HEALTH_PATH), `endpoint()`; binary-yok → `brew install cloudflared` hint.
2. Named-tunnel: `renderNamedConfig({tunnelId, credFile, hostname, localPort})` pure YAML (tek manuel adım
   `cloudflared login` DÜRÜST belgelenir).
3. cli transport-registry wiring → selectAuto/autopilot/status/bench oto; `detectCapable` cloudflared.
4. `doctor --full`: quick-tunnel aç → public URL keyed `/api/health` → (ops.) `/v1/chat` tek-token → kapat.
5. ADOPTIONS: cloudflared **SPDX `Apache-2.0`** binary-only (RISK-ORCH-017: kategori-kelimesi değil);
   `recipes/cloudflare-tunnel.md`; VERSION 13.0.0.
