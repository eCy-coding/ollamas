# Reçete — WireGuard p2p: MacBook ↔ iPhone (vT1, zero-account)

> Adoption: iOS istemcisi **WireGuard/wireguard-apple** (MIT, App Store). MacBook tarafı
> **wireguard-tools** (`wg`,`wg-quick`, GPL-2.0) — yalnız binary çağrısı, kaynak kopya YOK.
> Hiçbir hesap, hiçbir VPS yok. Split-tunnel: telefonun normal internet/LAN trafiği etkilenmez.

## 0. Ön-koşul (MacBook, bir kez)

```bash
brew install wireguard-tools   # wg, wg-quick (GPL — binary kullanımı)
brew install qrencode          # opsiyonel, QR için (zero-dep değil ama opsiyonel)
```

## 1. Anahtar + config üret (MacBook)

```bash
cd ~/Desktop/ollamas-tunnel-wt/tunnel
node src/cli.ts config
```

Üretir (tümü `tunnel/keys/`, 0600, **gitignored**):
- `keys/wg0.conf` — MacBook arayüz config'i (server, `10.7.0.1/24`, ListenPort 51820)
- `keys/iphone.conf` — iPhone peer config'i (`10.7.0.2/32`, AllowedIPs = `10.7.0.1/32`)
- Terminale **QR** basar (qrencode varsa).

## 2. Tüneli MacBook'ta kaldır

```bash
sudo cp keys/wg0.conf /etc/wireguard/wg0.conf
node src/cli.ts up        # → wg-quick up wg0
wg show                   # peer + handshake doğrula
```

> macOS firewall WireGuard UDP 51820'e izin vermeli. Aynı WiFi'de endpointHost = MacBook LAN IP.

## 3. iPhone (WireGuard app)

1. App Store → **WireGuard** (WireGuard Development Team, MIT).
2. **Add a tunnel → Create from QR code** → MacBook terminalindeki QR'ı tara.
   (QR yoksa: `keys/iphone.conf`'u AirDrop/Files ile aktar → *Create from file*.)
3. Tüneli **aç** (toggle).

## 4. E2E kanıt (vT1 done-gate)

iPhone'da (Safari, Shortcuts HTTP, veya bir terminal app):

```
GET http://10.7.0.1:3000/healthz   →  200 OK
```

`tunnel select` MacBook'tan da doğrular:

```bash
node src/cli.ts select     # → {"url":"http://10.7.0.1:3000","transport":"wireguard","healthy":true}
```

## 5. Server-side env (integrations lane'e devir — bu lane EDIT ETMEZ)

ollamas `/mcp` origin allowlist'i WG IP'sini reddedebilir. Integrations lane şunu ayarlamalı:

```
ALLOWED_ORIGINS=http://10.7.0.1:3000
MCP_PUBLIC_URL=http://10.7.0.1:3000     # discovery WG adresini göstersin
```

> Bu, server.ts kod değişikliği değil — env/config. Scope Law §1 (RISK-TUNNEL-002).

## Sorun giderme

- `wg: command not found` → `brew install wireguard-tools`.
- handshake yok → MacBook firewall UDP 51820, aynı WiFi, endpointHost doğru mu (`node src/cli.ts config` LAN IP'yi yeniden algılar).
- 200 yerine 403 → server-side `ALLOWED_ORIGINS` (adım 5).
