# Proxy Gateway — tek URL + tek key ile ollamas'a her cihazdan erişim (vT12)

Gateway, ollamas (:3000) ve ollama'nın OpenAI-uyumlu API'sini (:11434) TEK kapıdan sunar:

```
https://<Mac-host>:8443/v1/...        → ollama :11434  (OpenAI-compat: /v1/chat/completions, /v1/models)
https://<Mac-host>:8443/api/... /mcp  → ollamas :3000  (Host/Origin otomatik localhost'a yazılır)
```

Auth: her istekte `pxy_` key — `Authorization: Bearer pxy_…` **veya** `X-Proxy-Key: pxy_…`.
(`X-Proxy-Key` kullan, `Authorization`'ı ollamas'ın kendi `olm_` key'i için boş bırakabilirsin —
gateway Authorization'ı upstream'e DOKUNMADAN geçirir.)
Public istisna: yalnız `GET /api/health` (probe/doctor için). Diğer her yol key'siz → 401; liste-dışı yol → 404.

## Mac (bir kez)

```bash
cd ~/Desktop/ollamas/tunnel
node src/cli.ts tls                    # mkcert cert (yoksa) — LAN/mesh TLS için
node src/cli.ts proxy key add iphone   # pxy_ key — BİR KEZ gösterilir, iOS Notes/Keychain'e kaydet
node src/cli.ts proxy up               # :8443 https (mkcert) — ya da: proxy daemon install (login+crash-restart)
```

TLS'siz mod (yalnız cloudflared arkası / loopback): `proxy up --no-tls`.

## iPhone / diğer cihaz

1. Aynı WiFi (LAN-TLS) → base URL `https://<Mac>.local:8443`; mesh (WireGuard/Headscale) → `https://<mesh-ip>:8443`.
   (LAN-TLS için iOS profili: `recipes/caddy-mkcert-ios.md` — mkcert CA güveni.)
2. Herhangi bir OpenAI-uyumlu istemci app'te:
   - Base URL: `https://<host>:8443/v1`
   - API Key alanına: `pxy_…` key'in (app key'i `Authorization: Bearer` olarak yollar — gateway kabul eder)
3. Doğrulama:

```bash
curl https://<host>:8443/api/health                       # 200 (public)
curl https://<host>:8443/v1/models                        # 401 (key yok — DOĞRU davranış)
curl -H "X-Proxy-Key: pxy_…" https://<host>:8443/v1/models  # 200 model listesi
```

## Yönetim

```bash
node src/cli.ts proxy status          # çalışıyor mu + key listesi (prefix-only, sır yok)
node src/cli.ts proxy key list
node src/cli.ts proxy key revoke pxy_ab12   # cihaz kaybolursa ANINDA iptal
node src/cli.ts proxy down
node src/cli.ts doctor                # canlı: UP + "401 without key: OK" + keyed health
```

Rate-limit: key başına 60 burst, 10 istek/sn (429 üstünde). Access-log: `keys/proxy-access.jsonl`
(secret-free: keyPrefix/method/path/status/ms/bytes; boyut-rotasyonlu).

Güvenlik notları: RISK-TUNNEL-024 (auth'suz public exposure yasak — vT13 cloudflared bunu koda bağlar),
025 (raw key tek gösterim; loglar prefix-only), 026 (upstream hard-pin 127.0.0.1; open-relay yok).
