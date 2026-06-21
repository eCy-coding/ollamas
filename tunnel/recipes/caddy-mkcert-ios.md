# Reçete — LAN-TLS: iPhone → https://<Mac>.local (vT2, zero-account)

> Aynı WiFi senaryosu. Adoption: **caddy** (Apache-2.0) reverse-proxy + TLS, **mkcert** (BSD-3) local CA.
> Her ikisi de yalnız binary çağrısı (kaynak kopya yok). iOS sertifika güveni manuel adım gerektirir.
> Hostname otomatik: macOS Bonjour `<LocalHostName>.local` yayınlar (dns-sd gerekmez).

## 0. Ön-koşul (MacBook, bir kez)

```bash
brew install caddy mkcert
```

## 1. CA + cert + Caddyfile + iOS profili üret

```bash
cd ~/Desktop/ollamas/tunnel
node src/cli.ts tls
```

Üretir (tümü `tunnel/keys/`, 0600, **gitignored**):
- `keys/cert.pem` + `keys/key.pem` — `<host>.local` için mkcert sertifikası
- `keys/Caddyfile` — `reverse_proxy localhost:3000` + `tls cert key`
- `keys/<host>.mobileconfig` — mkcert rootCA'yı gömen iOS güven profili

Host'u `scutil --get LocalHostName` ile otomatik algılar (örn. `emre-mbp.local`).

## 2. Caddy'yi başlat (MacBook)

```bash
caddy run --config keys/Caddyfile --adapter caddyfile
# başka sekmede ollamas: cd ~/Desktop/ollamas && npm run dev
```

## 3. iPhone — CA'ya güven (manuel, kritik)

1. `keys/<host>.mobileconfig`'i iPhone'a **AirDrop** et → *Profili İndir*.
2. **Ayarlar → Genel → VPN ve Cihaz Yönetimi** → profili **Yükle**.
3. **Ayarlar → Genel → Hakkında → Sertifika Güven Ayarları** → "mkcert ..." kök CA'sını **aç**.
   > Bu iki-adımlı güven, iOS güvenlik gereksinimidir; otomatikleştirilemez.

## 4. E2E kanıt (vT2 done-gate)

iPhone Safari/Shortcuts (aynı WiFi):

```
GET https://<host>.local/api/health   →  200 OK  (kilit ikonu, sertifika güvenilir)
```

MacBook'tan switch doğrula (LAN-TLS, WireGuard'a tercih edilir):

```bash
node src/cli.ts select
# → {"url":"https://<host>.local","transport":"caddy-tls","healthy":true}
```

## 5. Server-side env (integrations lane'e devir — bu lane EDIT ETMEZ)

```
ALLOWED_ORIGINS=https://<host>.local
MCP_PUBLIC_URL=https://<host>.local
```

> Kod değil env/config. Scope Law §1 (RISK-TUNNEL-002).

## Sorun giderme

- `mkcert not found` → `brew install mkcert`.
- `<host>.local` çözülmüyor → iPhone+Mac aynı WiFi mi; macOS Paylaşım'da bilgisayar adı ayarlı mı.
- Safari "güvenli değil" → adım 3.2/3.3 (profil yükleme + güven aç) eksik.
- 200 yerine 403 → server-side `ALLOWED_ORIGINS` (adım 5).
