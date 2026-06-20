# Tunnel Adoption Catalog — ollamas Tunnel Lane

> En çok yıldız alan, güvenilir, macOS'ta çalışan, projemizle eşleşen tamamlanmış açık-kaynak repo'lar.
> Kural (TUNNEL_AGENTS.md §11): **çalışan kodu/reçeteyi** adopte et. MIT/Apache/BSD → kopya + attribution;
> GPL → yalnız binary çağrısı (kaynak kopya YOK); lisanssız → yalnız fikir. Her giriş bir vT'ye bağlı.
> iOS uyumluluğu + macOS çalışırlığı her adoption'ın ön-koşuludur.

## Adopte edilenler / planlananlar

| Repo | ⭐ | Lisans | vT | Ne için | Durum |
|------|----|--------|----|---------|-------|
| `WireGuard/wireguard-apple` | ~1.3k | MIT | vT1 | iOS native WG client (QR import) | ✅ reçete `recipes/wireguard-ios.md` |
| wireguard-tools (`wg`,`wg-quick`) | — | GPL-2.0 | vT1 | keygen + arayüz; **binary-invoke only**, kaynak kopya YOK | ✅ `transports/wireguard.ts` (spawn) |
| `caddyserver/caddy` | 73k | Apache-2.0 | vT2 | reverse_proxy localhost:3000 + TLS serve | ✅ `transports/caddy-tls.ts` (spawn) |
| `FiloSottile/mkcert` | 59k | BSD-3 | vT2 | local CA + `<host>.local` cert | ✅ `cli.ts tls` (spawn) |
| `mullvad/encrypted-dns-profiles` | ~0.7k | (reference) | vT2 | `.mobileconfig` plist şekli — fikir, kod-kopya YOK | ✅ `mobileconfig.ts` (kendi render) |
| `juanfont/headscale` | 38k | BSD-3 | vT3 | sovereign mesh control-plane (self-host); **binary-invoke** | ✅ `transports/headscale.ts` + reçete `recipes/headscale-ios.md` |
| ~~`slackhq/nebula`~~ | 15k | MIT | vT3 | **ELENDİ**: kendi protokolü → vT1 WireGuard data-plane'den sapma (kod-bütünlüğü); en egemen (kendi Mobile Nebula app'i) ama tutarsız | reddedildi (karar-log) |
| ~~`netbirdio/netbird`~~ | ~13k | Apache-2.0 | vT3 | **ELENDİ**: ağır (mgmt+signal+dashboard) M4 tek-binary hedefine aykırı; WG-tabanlı ama fazla parça | reddedildi (karar-log) |
| hysteresis link-flap prevention (Google Patents US20230012193A1) | — | (reference) | vT4 | iki-eşik+hold-down anti-flap fikri → scoring.ts chooseWithHysteresis | ✅ fikir-port |
| TS circuit-breaker (dev.to/Resily + orchestration MCP_CB) | — | MIT/pattern | vT4 | 3-durum closed/open/half-open → breaker.ts | ✅ pattern-port |
| multipath lowest-latency scheduler (sigcomm20 mptp) | — | (reference) | vT4 | ölçülen-latency path seçimi → scoring | ✅ fikir-port |
| DNS-rebind guard (GitHub Blog/Palo Alto/pfSense) | — | (reference) | vT5 | private-host exactMatch allowlist → guard.ts isPrivateHost | ✅ fikir-port |
| AES-256-GCM gist (AndiDittrich/rjz) + Node crypto docs | — | MIT/pattern | vT5 | 12-byte IV + authTagLength:16 zarf → crypto.ts | ✅ pattern-port |
| WG key-rotation (Pro Custodibus/defguard/WireGuard paper) | — | (reference) | vT5 | yaş-tabanlı + AllowedIPs-çakışmasız → rotate.ts | ✅ fikir-port |
| `fatedier/frp` | 107k | Apache-2.0 | vT6 | reverse TCP tunnel (kendi VPS) — ⚠️ ertelendi (VPS/manuel) | deferred |
| `ekzhang/bore` | 11k | MIT | vT6 | minimal Rust tunnel (alt) | deferred |

## Notlar

- WireGuard QR çıktısı için: ham `.conf` metni üretilir; QR encode reçetede `qrencode -t ansiutf8` (paketsiz,
  opsiyonel) veya iOS app'in "add from file/scan" akışı. QR kütüphanesi npm'e eklenmez (zero-dep).
- `wireguard-tools` GPL: yalnız `spawn('wg', [...])` ile çağrılır; tek satır kaynak kopyalanmaz (RISK-TUNNEL-005).
- Tüm mesh/tunnel adayları öncesinde `awesome-tunneling` (anderspitman) listesi ile çapraz-doğrulandı.

## Kaynaklar (attribution)

- https://github.com/WireGuard/wireguard-apple (MIT)
- https://www.wireguard.com/ — wireguard-tools (GPL-2.0)
- https://github.com/FiloSottile/mkcert (MIT) · https://github.com/caddyserver/caddy (Apache-2.0)
- https://github.com/juanfont/headscale (BSD-3) · https://github.com/fatedier/frp (Apache-2.0) · https://github.com/ekzhang/bore (MIT)
- https://github.com/anderspitman/awesome-tunneling
