# Cloudflare Tunnel — ollamas'a HER YERDEN erişim (cellular, yabancı ağ) (vT13)

Public bir URL verir; router'da port açmadan, sabit IP olmadan. cloudflared public TLS'i sonlandırır
ve trafiği loopback'ten (`127.0.0.1:8443`) proxy gateway'ine iletir — auth/ratelimit/allowlist gateway'de.

**Güvenlik (RISK-TUNNEL-024):** cloudflared, gateway'de en az bir aktif `pxy_` key yoksa AÇILMAZ (kod throw eder).
Public URL + auth'suz gateway = tüm ollamas internete açık olurdu. Önce key üret.

## Bir kez

```bash
brew install cloudflared                       # Apache-2.0, binary-only
cd ~/Desktop/ollamas/tunnel
node src/cli.ts proxy key add remote            # pxy_ key — BİR KEZ gösterilir
node src/cli.ts proxy up --no-tls               # gateway :8443 (cloudflared kendi TLS'ini sonlandırır)
```

## Mod A — Quick tunnel (hesapsız, önerilen başlangıç)

Autopilot `auto` çalıştığında capable ise otomatik seçilir (REVERSE=30, mesh/LAN yoksa fallback).
Manuel doğrulama:

```bash
node src/cli.ts doctor --full
# → public URL (ephemeral): https://<slug>.trycloudflare.com
#   public /api/health: OK <ms>ms
```

- URL her başlatmada değişir (ephemeral). Aktif URL: `tunnel status` / autopilot decision-log.
- iPhone: OpenAI-uyumlu app'te Base URL = `https://<slug>.trycloudflare.com/v1`, API Key = `pxy_…`.

**⚠️ Bilinen ortam kısıtı (RISK-TUNNEL-027):** Mac'in DNS'i mesh MagicDNS'e (100.100.100.100) pinliyse
`*.trycloudflare.com` NXDOMAIN olur → quick-tunnel çözülemez. Çözüm: quick-tunnel kullanırken sistem
DNS'i geçici public resolver'a al (1.1.1.1), ya da Mod B (named tunnel, split-DNS).

## Mod B — Named tunnel (sabit hostname, opsiyonel)

Tek manuel adım `cloudflared login` (Cloudflare hesabı + kendi domain'in). Sonrası sıfır-manuel.

```bash
cloudflared login                               # TEK manuel adım (tarayıcı auth)
cloudflared tunnel create ollamas               # → tunnelId + ~/.cloudflared/<id>.json cred
# renderNamedConfig ile config.yml üret (tunnelId, credFile, hostname, localPort=8443):
node -e "import('./src/transports/cloudflare.ts').then(m=>console.log(m.renderNamedConfig({tunnelId:'<id>',credFile:'<cred>',hostname:'ollamas.<domain>',localPort:8443})))" > ~/.cloudflared/config.yml
cloudflared tunnel route dns ollamas ollamas.<domain>
cloudflared tunnel run ollamas
```

Sabit URL `https://ollamas.<domain>` — değişmez, split-DNS gerektirmez, MagicDNS'ten etkilenmez.

## Yönetim / güvenlik

- Cihaz kaybı → `tunnel proxy key revoke pxy_<prefix>` (anında iptal, tünel açık kalsa bile erişim ölür).
- Rate-limit key başına 60 burst / 10 rps; access-log secret-free (`keys/proxy-access.jsonl`).
- Public exposure yalnız path-allowlist (`/v1|/api|/mcp`); admin/SaaS yolları key'le bile 404 (gateway katmanı).
