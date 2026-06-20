# ollamas Tunnel Lane — ROADMAP (vT1 → vT10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla.
> Her versiyonun "done" tanımı sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Adopt | Durum |
|-----|------|----------|-------|-------|
| **vT1** | Foundation + iOS reach | governance 5-dosya + `Transport` iface + `switch.ts` skeleton + **WireGuard p2p** (QR, zero-acct) + iPhone→ollamas 200 e2e | wireguard-apple(MIT), wireguard-tools | ✅ DONE (97d65a1) |
| **vT2** | LAN-TLS | Caddy reverse-proxy + mkcert local CA + **iOS .mobileconfig render** + `<Mac>.local` auto-host → `https://<host>.local` | Caddy(Apache,73k), mkcert(BSD,59k) | ✅ DONE |
| **vT3** | Sovereign mesh | Headscale self-host control-plane + embedded DERP + zero-account preauth; çok-cihaz + remote tek overlay (WG data-plane reuse) | Headscale(BSD,38k) binary-only | ✅ DONE |
| vT4 | Remote reverse-tunnel | kendi VPS'te FRP/Bore server, MacBook client expose; mesh yokken fallback | FRP(Apache,107k)/Bore(MIT,11k) | planned |
| vT5 | **Switch engine** | health-probe + scoring + auto-failover + priority policy + decision-log | — | planned |
| vT6 | Security hardening | WG key-rotation, mTLS, DNS-rebind guard, secrets-at-rest (CLI AES-256-GCM reuse), gateway origin/auth doc | — | planned |
| vT7 | Observability | `tunnel status` endpoint/TUI, latency/throughput, switch kararları → orchestration feed | — | planned |
| vT8 | Benchmark | MacBook↔iOS per-transport latency/throughput, en-verimli seçim, leaderboard (scripts bench-metrics reuse) | — | planned |
| vT9 | Resilience | auto-reconnect, LaunchAgent daemon, NAT/captive-portal detect, IPv6, fallback-chain | — | planned |
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

## vT4 — NEXT (önceden-hesaplanmış ilk todo'lar)

1. `transports/frp.ts` — FRP (Apache-2.0, fatedier/frp) reverse TCP tunnel: kendi VPS'te `frps`, MacBook'ta `frpc` config render (PURE) + `serviceUrl` (public host:port); mesh/LAN yokken remote fallback.
2. `transports/bore.ts` (alt) — ekzhang/bore (MIT) minimal Rust tunnel; daha hafif, secret-tabanlı.
3. Reverse transport `priority=PRIORITY.REVERSE` (30) — switch'e register; LAN-TLS(10)>mesh(20)>reverse(30) tam zincir.
4. `recipes/frp-ios.md` — kendi VPS reçetesi (frps server + frpc client + iPhone public URL); zero-account (kendi sunucu).
5. `TUNNEL_ADOPTION.md` FRP/Bore ✅; errors_registry reverse-tunnel riskleri (public-exposure RISK-TUNNEL-011, VPS-trust).
