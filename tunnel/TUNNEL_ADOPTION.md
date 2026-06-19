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
| `FiloSottile/mkcert` | — | MIT | vT2 | local CA, iOS trust profile | planned |
| `caddyserver/caddy` | 73k | Apache-2.0 | vT2 | reverse-proxy + auto-TLS | planned |
| `juanfont/headscale` | 38k | BSD-3 | vT3 | sovereign mesh control-plane | planned |
| `fatedier/frp` | 107k | Apache-2.0 | vT4 | reverse TCP tunnel (kendi VPS) | planned |
| `ekzhang/bore` | 11k | MIT | vT4 | minimal Rust tunnel (alt) | planned |

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
