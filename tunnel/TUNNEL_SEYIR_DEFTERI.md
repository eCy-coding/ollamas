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

---
**Toplam (vT1+vT2 kod):** 5 governance + 7 src modül (transport/switch/health/wireguard/caddy-tls/
mobileconfig/cli) + 6 test dosya (37 test) + 2 iOS reçete. Zero-dep (Node 24 strip + node:test),
zero-account. tsc 0 + test 37/37. Gotcha ERR-TUNNEL-001 (strip param-property yasak).
vT1 (WireGuard 200) + vT2 (LAN-TLS 200) cihaz-kanıtları Emre'de.
