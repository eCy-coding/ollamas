# Seyir Defteri — ollamas Tunnel/Switch Lane

> Lane'in doğuşundan e2e kanıta kadar adım-adım kayıt. Her faz: **ne / nasıl / niçin / kanıt**.

## Faz 0 — Lane doğuşu (vT1 P0)

- **Ne:** Tünel/switch lane bootstrap. İzole worktree + 5 governance dosya + zero-dep TS proje iskeleti.
- **Nasıl:** `git worktree add ~/Desktop/ollamas-tunnel-wt -b feat/tunnel-v1`. `tunnel/` altında
  `TUNNEL_AGENTS.md` (master prompt §0-§11) + `TUNNEL_ROADMAP.md` (vT1→vT10) + `TUNNEL_ADOPTION.md`
  (WireGuard/Caddy/Headscale/FRP matris) + `errors_registry.json` (6 preloaded risk) + `VERSION` 1.0.0
  + `package.json`/`tsconfig.json` (Node 24 native TS strip, `node --test`, sıfır npm bağımlılığı).
- **Niçin:** Diğer lane'lerin (frontend/cli/scripts/integrations/orchestration) governance pattern'i
  ile aynı sözleşme; her oturum aynı kurallarla, hatasız, kesintisiz sürdürülebilir çalışsın.
- **Kanıt:** `git -C ~/Desktop/ollamas-tunnel-wt branch --show-current` → `feat/tunnel-v1`. Dosyalar `tunnel/` altında.

## Faz 1 — Switch iskeleti (vT1 P1)

- **Ne:** `transport.ts` (Transport iface + TunnelEndpoint + PRIORITY), `switch.ts` (registry +
  probe-all + lowest-priority-healthy select + current), `health.ts` (timeout-guarded probeHttp).
- **Nasıl:** Zero-dep, yalnız `node:*` + global fetch/AbortSignal. TDD: probe (200/500/custom/err/timeout/slash)
  + switch (empty/priority-pick/fallthrough/all-unhealthy/current/ordered).
- **Niçin:** Switch transport-agnostik kalsın; vT2-vT4 transport'ları aynı arayüzle plug-in olsun.
- **Kanıt:** `node --test` → 12/12 green (health 6 + switch 6).

## Faz 2 — WireGuard p2p transport (vT1 P2)

- **Ne:** `transports/wireguard.ts` (genKeypair spawn `wg`, **pure** renderServerConfig/renderPeerConfig,
  serviceUrl, WireGuardTransport probe/endpoint), `cli.ts` (config/up/down/select + LAN-IP detect + QR),
  `recipes/wireguard-ios.md`.
- **Nasıl:** Adoption: wireguard-tools GPL → **yalnız binary spawn** (kaynak kopya yok, RISK-TUNNEL-005);
  iOS = wireguard-apple MIT (QR import). Split-tunnel: peer AllowedIPs = server /32 (telefon interneti etkilenmez).
  Keys `tunnel/keys/` 0600 gitignored (RISK-TUNNEL-004).
- **Niçin:** vT1 done-gate = sıfır-hesap, sıfır-VPS iPhone→ollamas yolu.
- **Kanıt:** `node --test` → 19/19 green; `tsc -p` → 0 error; `node src/cli.ts select` → exit 1 + temiz mesaj
  (tünel kapalıyken); `config` `wg` yokken temiz "brew install wireguard-tools" mesajı (uncaught yok).

## Faz 3 — iOS e2e kanıt (vT1 P3, done-gate) — ⏳ CİHAZ BEKLİYOR

- **Ne:** Fiziksel iPhone gerektirir (Emre'nin manuel adımı). Reçete `recipes/wireguard-ios.md`:
  `brew install wireguard-tools qrencode` → `node src/cli.ts config` → `sudo cp keys/wg0.conf /etc/wireguard/` →
  `node src/cli.ts up` → iPhone WireGuard app QR tara → `curl http://10.7.0.1:3000/healthz`.
- **Kanıt:** _(cihazda doğrulanınca buraya: HTTP 200 + `wg show` handshake yapıştırılacak)_
- **Not:** Server-side `ALLOWED_ORIGINS`/`MCP_PUBLIC_URL` (WG IP) integrations lane'e devredildi (reçete §5) —
  bu lane server.ts edit etmez (RISK-TUNNEL-002).

## Faz 4 — LAN-TLS transport (vT2)

- **Ne:** `mobileconfig.ts` (pure Apple .mobileconfig render, root CA payload), `transports/caddy-tls.ts`
  (detectLocalHostname `scutil`, pure renderCaddyfile, CaddyTlsTransport pri=LAN_TLS), `health.ts`
  `probeHttpsInsecure` (node:https rejectUnauthorized:false), `cli.ts tls` + `select` çift-transport,
  `recipes/caddy-mkcert-ios.md`.
- **Nasıl:** Adoption: caddy(Apache)+mkcert(BSD) **binary-spawn-only** (kaynak kopya yok). iOS .mobileconfig
  güvenilir OSS jeneratörü yok → plist'i kendimiz render ettik (mullvad/encrypted-dns-profiles şekli, fikir).
  Hostname otomatik `<Mac>.local` (Bonjour, dns-sd gerekmez). cert/key/profile `keys/` 0600 gitignored.
- **Niçin:** Aynı-WiFi yaygın senaryo: VPN'siz, hesapsız HTTPS. LAN_TLS(10)<MESH(20) → switch WiFi'de
  LAN-TLS seçer, off-LAN WireGuard'a düşer (gerçek failover vT5).
- **Kanıt:** `node --test` → **37/37 green** (mobileconfig 7 + caddy-tls 6 + health 11 + switch 6 + wg 5 + cli 2);
  `tsc -p` → 0; `cli select` exit 1 + temiz mesaj (transport yokken); `cli tls` mkcert yokken temiz
  "brew install mkcert". iOS cihaz-kanıtı (https://<host>.local 200) Emre'de (reçete hazır).

## Faz 5 — Sovereign mesh transport (vT3)

- **Karar (research-driven):** mesh motoru = **Headscale** (juanfont/headscale, BSD-3). Karar matrisi
  M4+iOS+egemen+kod-bütünlüğü → vT1 WireGuard data-plane reuse + tek hafif Go binary + iOS resmi Tailscale
  app "ALTERNATE COORDINATION SERVER URL" (no-MDM, v1.38.1+) + BSD-3 binary-invoke. Nebula (kendi protokol →
  WG'den sapma) ve NetBird (ağır mgmt+signal+dashboard) elendi. Kaynaklar: headscale apple docs + 2026
  karşılaştırmaları (pinggy/dev.to/lilting).
- **Ne:** `transports/headscale.ts` — PURE renderHeadscaleConfig (sqlite + gömülü DERP = egemen NAT traversal,
  Tailscale SaaS relay YOK) + clientUpCommand (login-server; default `<PREAUTH_KEY>` placeholder) +
  preAuthKeyCommand + createUserCommand + serviceUrl; `HeadscaleTransport` (name=headscale, pri=PRIORITY.MESH,
  explicit field'lar, probe=probeHttp(meshIp/healthz), spawn `headscale serve`). `cli.ts mesh` (config.yaml +
  preauth adımları, keys/ 0600) + `select` LAN-TLS>WireGuard>Headscale. `recipes/headscale-ios.md`.
- **Nasıl:** Headscale **binary-invoke only** (BSD-3). Zero-account = preauth key. iOS resmi client =
  egemenlik control-plane self-host'ta (RISK-TUNNEL-009). Gömülü DERP = kendi relay (RISK-TUNNEL-008).
- **Bonus root-fix (ERR-TUNNEL-002):** `npm test` glob `src/**/*.test.ts` /bin/sh'de `**` desteklemiyordu →
  yalnız 21 test (top-level src/*.test.ts atlanıyordu). Düzeltme: script → `node --test` (recursive). 48/48.
- **Niçin:** vT1/vT2 tek-cihaz/aynı-LAN'ı çözdü; vT3 = çok-cihaz + remote tek overlay, kendi-barındırılan.
- **Kanıt:** `node --test` → **48/48 green** (headscale 10 yeni); `npm run typecheck` → 0;
  `node src/cli.ts mesh` → keys/headscale.yaml + Coordination URL `http://Emre-MacBook-Pro.local:8080` (canlı);
  keys/ gitignored. iOS cihaz-kanıtı (mesh `100.64.0.1:3000/healthz` 200) Emre'de. **Taşınabilir master prompt**
  `prompts/ollamas-tunnel-portable.md` üretildi.

## Faz 6 — Otonom Switch Engine (vT4) — 0 manuel seçim / 0 manuel işlem

- **Kısıt-kaynaklı re-sequence:** Emre "0 manuel seçim ve 0 manuel işlem" dedi → precomputed vT4
  (reverse-tunnel) GEÇERSİZ (VPS+dış-hesap+manuel = hem 0-manuel hem egemen-zero-account ihlali). Kök-neden
  kararı: "0 manuel seçim" = switch otomatik en-iyi transport'u seçer; "0 manuel işlem" = otomatik up + self-heal.
  Bu = Switch Engine (eski vT5) → öne alındı. Security→vT5, reverse-tunnel→vT6 (deferred). AskUser YOK.
- **Karar (research):** hysteresis iki-eşik+hold-down (Google Patents US20230012193A1 + SD-WAN), 3-durum
  circuit-breaker (TS-CB dev.to/Resily MIT + orchestration MCP_CB), lowest-latency scheduler (sigcomm20 mptp).
  Fikir/pattern-port, zero-dep.
- **Ne:** `breaker.ts` (PURE 3-durum CB, enjekte clock) · `scoring.ts` (PURE scoreCandidate latency*1+priority*10
  + chooseWithHysteresis margin/holdRounds anti-flap) · `switch.ts` selectAuto (paralel zamanlı probe
  `performance.now()` + breaker + scoring + hysteresis + decision-log; select() geri-uyumlu) · `autopilot.ts`
  (detectCapable `which` + autoUp best-capable + runLoop self-heal, never-throws) · `cli.ts auto [--watch]` +
  select→selectAuto.
- **Nasıl:** Tüm karar fn'leri PURE+deterministik (enjekte clock+fake transport+timeProbe) → canlı ağsız test.
  probe() interface DEĞİŞMEDİ (latency switch'te ölçülür). auto-up yalnız capable binary (eksikse zarif atla).
- **Niçin (0-manuel):** kullanıcı hangi transport'u seçeceğini bilmek/seçmek zorunda değil; sistem ölçer,
  skorlar, en iyisini seçer, ayağa kaldırır, düşerse iyileştirir. Sıfır prompt, sıfır komut.
- **Kanıt:** `node --test` → **75/75 green** (breaker 6 + scoring 10 + switch +5 + autopilot 6 yeni);
  `npm run typecheck` → 0; `node src/cli.ts auto` → binary yokken zarif "no capable transport" + decision-log JSON
  (sıfır prompt). RISK-TUNNEL-011 (flapping→hysteresis) / -012 (auto-up capable-only) / -013 (log secret-free).

## Faz 7 — Security hardening (vT5) — 0 manuel

- **Karar (research):** DNS-rebind guard (GitHub Blog/Palo Alto/pfSense), AES-256-GCM (AndiDittrich/rjz +
  Node docs, authTagLength:16), WG key-rotation 90g + AllowedIPs-çakışmasız (Pro Custodibus/defguard).
  0-manuel için secrets passphrase YOK → auto-keyfile; rotation yaş-tabanlı otomatik. mTLS ERTELENDİ
  (iPhone client-cert manuel).
- **Ne:** `guard.ts` (isPrivateHost/assertPrivateUrl) + `health.ts` opt-in `requirePrivateHost` (3 transport
  probe true) · `crypto.ts` (seal/open GCM, tamper→throw) · `keystore.ts` (loadOrCreateKeyfile auto-0600 +
  vault sealToFile/openFromFile graceful) · `rotate.ts` (needsRotation/daysUntilRotation/rotationPlan PURE) ·
  `cli.ts rotate [--force]` (eski config→vault.enc seal, sonra yeni key; 0-prompt).
- **Nasıl:** Tüm kripto/guard/rotate PURE+deterministik (enjekte key/iv/clock) → round-trip+tamper test, canlı yok.
  guard opt-in default false → mevcut 24 health/switch testi kırılmadı. keys/ 0600 gitignored.
- **Dürüstlük (RISK-014):** auto-keyfile vault ile co-located → casual leak'e karşı korur, keyfile'a erişen
  yerel saldırgana karşı DEĞİL; passphrase/Keychain 0-manuel'i bozar → belgelendi, overclaim yok.
- **Niçin:** switch'i rebind-zehirli endpoint'ten koru (guard), sırları düz-metin bırakma (vault), WG anahtarını
  süresi dolunca otomatik döndür (rotate) — hepsi kullanıcı eylemi olmadan.
- **Kanıt:** `node --test` → **103/103 green** (guard 7 + crypto 7 + keystore 5 + rotate 5 + health +4);
  `typecheck` 0; `node src/cli.ts rotate` → wg yoksa zarif "cannot rotate" (0-prompt). RISK-014/015/016.

## Faz 8 — Observability + kaldığın-yer tamamlama (vT6) — 0 manuel

- **Kaldığın yer:** vT5 kod tam+103/103 ama COMMIT'SİZ kalmıştı (önceki tur kesildi) → ilk iş vT5 ship
  (be9124f). Sonra eksik-temizlik: VERSION 1.0.0→6.0.0 align (+ package.json), whoami.sh `**` strip +
  drift-check düzgün (major-vs-vT, hardcode kaldırıldı).
- **Karar (research):** node-sparkline (MIT zero-dep), CLI-best-practice (--json opt-out), JSONL feed
  (Gatus/Burnd). Pure render + secret-free feed.
- **Ne:** `status.ts` PURE (statusReport + sparkline + renderStatusTable + appendDecision/readDecisions
  JSONL) · `cli.ts status [--json|--watch]` (alt-ekran+SIGINT-restore) · `auto/select/status`→decisions.jsonl
  feed · `recipes/observability-feed.md` (orchestration cockpit cross-lane handoff, edit YOK).
- **Nasıl:** render fn'leri PURE+deterministik (enjekte decisions) → unit-test, canlı yok. Feed secret-free
  (RISK-013). readDecisions limit=son-N-geçerli + bozuk-satır-atla (RISK-018 hafif cap, tam rotation vT8).
- **Niçin:** switch'in NE seçtiği/NEDEN'i görünür olsun (status) + orchestration canlı cockpit'i beslensin
  (JSONL feed) — hepsi salt-okuma, kullanıcı eylemi yok.
- **Kanıt:** `node --test` → **112/112 green** (status 9 yeni); `typecheck` 0; `node src/cli.ts status --json`
  → transport yokken zarif active:null (0-prompt); whoami VERSION-drift uyarısı GİTTİ. RISK-017/018.

## Faz 9 — Resilience / Always-On Daemon (vT7) — 0 manuel işlem capstone

- **Critical tespit (gereksiz işten kaçın):** North-Star "0 manuel işlem" `tunnel auto` elle başladığı için
  TAMAMLANMAMIŞTI. ROADMAP-NEXT Benchmark zaten-çalışan seçimi optimize eder (düşük-kritik). EN KRİTİK boşluk =
  always-on daemon → re-sequence vT7=Daemon, Benchmark→vT8.
- **Karar (research):** LaunchAgent RunAtLoad+KeepAlive (launchd.plist + tjluoma/launchd-keepalive), captive-
  portal endpoint-probe (rwbutler/Connectivity MIT fikir). Fikir-port.
- **Ne:** `daemon.ts` PURE renderLaunchAgent + agentPath + installAgent/uninstallAgent/agentStatus (launchctl
  injectable, capability-gated, never-throws) · `connectivity.ts` PURE classify + internetReachable (guard-bypass
  connectivity-only) · `cli.ts daemon <install|uninstall|status>` + status'a connectivity satırı ·
  `recipes/daemon-macos.md`. VERSION 6.0.0→7.0.0.
- **Nasıl:** renderLaunchAgent/classify PURE+deterministik (enjekte path/launchctl/fetch) → launchctl gerektirmez
  test. install plist'i ~/Library/LaunchAgents'e yazar (runtime; kaynak tree'de kalır, wg-quick/etc-wireguard gibi).
  internet-probe public endpoint → guard BİLEREK bypass (RISK-021), tünel-probe'lar hâlâ requirePrivateHost.
- **Niçin (0-manuel capstone):** install tek-seferlik (brew-benzeri); sonrası login-oto-başlat + crash-restart →
  kullanıcı bir daha hiçbir şey çalıştırmaz. "0 manuel işlem" hedefi SAĞLANDI.
- **Kanıt:** `node --test` → **127/127 green** (daemon 8 + connectivity 7 yeni); `typecheck` 0;
  `node src/cli.ts daemon status` → yüklü-değil zarif (0-prompt). RISK-019/020/021. Device-daemon kanıtı
  (login restart) Emre'de.

## Faz 10 — Benchmark + Log-rotation (vT8) — 0 manuel

- **Critical-tespit (gereksiz işten kaçın):** precomputed vT8 üçlüsünden connectivity-routing vT9'a ertelendi
  (henüz internet-only transport yok → gereksiz). vT8 = Benchmark (kullanıcının tekrarlı isteği) + Log-rotation
  (vT7 daemon 7/24 yazımı → şimdi kritik).
- **Karar (research):** percentile nearest-rank (Last9/OneUptime; p99 ATLA=az-örnek-dürüst), file-rotator
  zero-dep (rogerc/Zelgadis87). Fikir/pattern-port.
- **Ne:** `bench.ts` PURE percentile/summarize(p50/p90/min/max/mean) + benchmarkTransports(injected timeProbe) +
  renderBenchTable · `logrotate.ts` PURE-ish rotateIfNeeded(size→ring keep-N) · `cli.ts bench [--json|--samples]`
  + persistDecision→rotate(decisions.jsonl) + cmdAuto-start→rotate(daemon.log).
- **Nasıl:** percentile/summarize/rotateIfNeeded PURE+deterministik (enjekte values/timeProbe/temp-fs) → ağsız
  test. Live scoring DEĞİŞMEDİ (bench diagnostic) → regression yok. RISK-018/020 TAM çözüldü (resolved_in vT8).
- **Niçin:** "benchmark'tan geçen en iyi seçim" görünürlüğü (p50/p90 stabil) + daemon 7/24 log büyümesini sınırla.
- **Kanıt:** `node --test` → **137/137 green** (bench 5 + logrotate 5 yeni); `typecheck` 0; `node src/cli.ts
  bench` → transport-yokken healthy 0% zarif (0-prompt). RISK-022. VERSION 8.0.0.

## Faz 11 — Ecosystem Onboarding (vT9) — 0-manuel one-command

- **Critical-tespit (gereksiz işten kaçın):** precomputed connectivity-routing ERTELENDİ (dürüst: probe-timeout
  offline-correctness verir → marjinal; internet-only transport yok). Gerçek kritik = tek-komut onboarding
  (çok-komut `config`+`tls`+`mesh`+`daemon` = manuel-seçim/sıralama → tek `setup`).
- **Karar (research):** tailscale `up` zero-config idempotent onboarding (fikir). Mevcut cmd REUSE = yeni
  transport kodu yok.
- **Ne:** `setup.ts` PURE planSetup(caps,existing)→configure/skip-exists/missing-binary + kindsToConfigure +
  renderSetupPlan · `cli.ts setup [--daemon]` (capability-detect→configure-capable[cmdConfig/Tls/Mesh reuse]→
  autoUp→daemon, idempotent) + `teardown` · `recipes/onboarding.md`.
- **Nasıl:** planSetup PURE+deterministik (enjekte caps+existing) → ağ/fs'siz test. setup idempotent (config-var
  skip) + her adım try/catch (RISK-023). 0-prompt, transport-seçimi otomatik (capability-based).
- **Niçin (0-manuel capstone):** sıfırdan otonom-tünel TEK komut → `setup --daemon` → kullanıcı hiç seçim
  yapmaz/sıralamaz. North-Star "0 manuel" onboarding tamam.
- **Kanıt:** `node --test` → **143/143 green** (setup 6 yeni); `typecheck` 0; `node src/cli.ts setup` →
  binary-yok zarif plan+brew-hint (0-prompt). VERSION 9.0.0.

## Faz 12 — Live Integration Fix + `doctor` (vT10) — GERÇEK ollamas'a karşı

- **Kullanıcı: "ollamas'ı çalıştır + gerçek görevde test et."** 9 versiyon unit-test'liydi ama hiç canlı
  ollamas'a koşulmamıştı. Canlı koşum **kritik bug açığa çıkardı (ERR-TUNNEL-003):** tünel `/healthz` probe
  ediyordu, ollamas health = `/api/health` (`/healthz`=401) → gerçek ollamas'a karşı switch hiçbir transport'u
  healthy görmez = TÜNEL KIRIK. 143 unit-test yakalayamadı (fake-fetch /healthz=200 = canlı-kör nokta).
- **Ne:** merkezi `HEALTH_PATH` (default /api/health, env-override) → probe default + 3 transport + cli + 3 recipe.
  `doctor.ts` PURE report + `cli.ts doctor [--json]` (ollamas upstream probe + selectAuto + connectivity + capable).
- **Nasıl:** tek-sabit merkezi endpoint sözleşmesi; doctor canlı self-test (localhost:3000 loopback→guard izin).
  Probe-path testleri PURE; entegrasyon CANLI doğrulandı (unit-test gerçek-path varsayamaz — prevention).
- **Niçin:** kullanıcının "gerçek görevde test" isteği = canlı-kör noktayı kapat; tünel artık gerçek ollamas'a
  forward edebileceğini KANITLAR.
- **CANLI KANIT (gerçek ollamas, port 3000):**
  - `node src/cli.ts doctor` → `ollamas upstream : OK 46ms (http://localhost:3000/api/health)` · exit 0 · online.
  - Regresyon: `OLLAMAS_HEALTH_PATH=/healthz doctor` → `UNREACHABLE (.../healthz)` (eski bug) vs default `OK 24ms`.
  - `node --test` **148/148 green** (doctor 3 + health +2); tsc 0. VERSION 10.0.0.
- select/status "no healthy transport" = wg/caddy/headscale binary yok (transport-IP endpoint'leri Emre cihaz-
  kanıtı); ama UPSTREAM (ollamas reachability) artık DOĞRU path'te canlı doğrulandı.

---
**Toplam (vT1..vT10 kod):** 5 governance + 23 src modül (…+doctor) + 22 test dosya (148 test) + 6 reçete +
1 taşınabilir prompt. Zero-dep (Node 24 strip + node:test), zero-account. tsc 0 + test 148/148. VERSION 10.0.0.
Gotcha ERR-TUNNEL-001 (strip param-property), -002 (test glob → node --test), **-003 (health-path /healthz→
/api/health, canlı-e2e şart)**. vT1/vT2/vT3 + vT7 daemon + vT9 setup cihaz-kanıtı Emre'de; **vT10 ollamas
upstream CANLI 200 doğrulandı**; transport-IP endpoint'leri (binary gerektirir) Emre'de. RISK-018/020 vT8'de çözüldü.
