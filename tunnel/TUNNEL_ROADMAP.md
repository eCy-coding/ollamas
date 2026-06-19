# ollamas Tunnel Lane — ROADMAP (vT1 → vT10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla.
> Her versiyonun "done" tanımı sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Adopt | Durum |
|-----|------|----------|-------|-------|
| **vT1** | Foundation + iOS reach | governance 5-dosya + `Transport` iface + `switch.ts` skeleton + **WireGuard p2p** (QR, zero-acct) + iPhone→ollamas 200 e2e | wireguard-apple(MIT), wireguard-tools | ▶ **IN PROGRESS** |
| vT2 | LAN-TLS | Caddy reverse-proxy + mkcert local CA + iOS cert profile reçete → `https://ollamas.local` | Caddy(Apache,73k), mkcert(MIT) | planned |
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

## vT2 — NEXT (önceden-hesaplanmış ilk todo'lar)

1. `transports/caddy-tls.ts` — `Caddyfile` render (reverse_proxy localhost:3000 → `ollamas.local:443`), `caddy run` sarmalayıcı.
2. `recipes/mkcert-ios.md` — `mkcert -install` local CA + `ollamas.local` cert + iOS `.mobileconfig` trust profile reçetesi (adopt mkcert MIT).
3. mDNS/`.local` ad çözümü doğrulama (Bonjour, MacBook hostname).
4. `switch.ts` priority listesine LAN-TLS'i **mesh+reverse üstüne** ekle; probe `https://ollamas.local/healthz`.
5. iOS e2e: aynı WiFi'de iPhone Safari/Shortcut → `https://ollamas.local` → 200 (cert trust kurulu).
6. `TUNNEL_ADOPTION.md` Caddy+mkcert satırlarını ✅ işaretle; errors_registry'ye TLS/cert riskleri ekle.
