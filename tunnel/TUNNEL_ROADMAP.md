# ollamas Tunnel Lane — ROADMAP (vT1 → vT10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla.
> Her versiyonun "done" tanımı sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Adopt | Durum |
|-----|------|----------|-------|-------|
| **vT1** | Foundation + iOS reach | governance 5-dosya + `Transport` iface + `switch.ts` skeleton + **WireGuard p2p** (QR, zero-acct) + iPhone→ollamas 200 e2e | wireguard-apple(MIT), wireguard-tools | ✅ DONE (97d65a1) |
| **vT2** | LAN-TLS | Caddy reverse-proxy + mkcert local CA + **iOS .mobileconfig render** + `<Mac>.local` auto-host → `https://<host>.local` | Caddy(Apache,73k), mkcert(BSD,59k) | ✅ DONE |
| vT3 | Sovereign mesh | Headscale self-host control-plane + WG client; çok-cihaz + remote tek overlay | Headscale(BSD,38k) | planned |
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

## vT3 — NEXT (önceden-hesaplanmış ilk todo'lar)

1. `transports/headscale.ts` — Headscale self-host control-plane (BSD-3) sarmalayıcı: `headscale` config + `headscale nodes register`, WG client config üret.
2. `recipes/headscale-ios.md` — Headscale self-host + iOS WireGuard/Tailscale-client (kendi control URL) reçetesi; çok-cihaz + remote tek overlay.
3. Mesh transport `priority=PRIORITY.MESH` (zaten WireGuard p2p ile aynı bant) — Headscale p2p-üstü koordinasyon; switch'e register.
4. Zero-account doğrula: Headscale tamamen self-host (Tailscale SaaS yok).
5. `TUNNEL_ADOPTION.md` Headscale ✅; errors_registry mesh/NAT-traversal riskleri.
