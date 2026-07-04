# Cloudflare Tunnel — ollamas'a HER YERDEN erişim (cellular, yabancı ağ) (vT13)

Public bir URL verir; router'da port açmadan, sabit IP olmadan. cloudflared public TLS'i sonlandırır
ve trafiği loopback'ten (`127.0.0.1:8443`) proxy gateway'ine iletir — auth/ratelimit/allowlist gateway'de.

**Güvenlik (RISK-TUNNEL-024):** cloudflared, gateway'de en az bir aktif `pxy_` key yoksa AÇILMAZ (kod throw eder).
Public URL + auth'suz gateway = tüm ollamas internete açık olurdu. Önce key üret.

## Tek komut — 0-manuel always-on (vT14, önerilen)

```bash
brew install cloudflared                       # Apache-2.0, binary-only
cd ~/Desktop/ollamas/tunnel
node src/cli.ts setup --daemon                  # vault+key üret + HER İKİ LaunchAgent kur (autopilot + gateway)
```

Bu tek komut: `pxy_` default key üretir (BİR KEZ basılır), gateway + autopilot LaunchAgent'larını login'de
oto-başlar + crash-restart eder, en iyi transport'u (mesh yoksa cloudflare public) getirir. Gerçekten always-on.

**Aktif public URL'i bul** (ephemeral, her restart değişir — gizli değil, yüzeyde):
```bash
node src/cli.ts status        # → gateway: UP  ·  public: https://<slug>.trycloudflare.com
```

## Manuel (adım adım, alternatif)

```bash
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

**✅ RISK-TUNNEL-027 ÇÖZÜLDÜ (vT14):** Mac DNS'i mesh MagicDNS'e (100.100.100.100) pinliyken
`*.trycloudflare.com` NXDOMAIN oluyordu. İki-katlı fix: (1) `renderHeadscaleConfig` artık
`dns.nameservers.global: [1.1.1.1, 1.0.0.1]` yazar → MagicDNS bilinmeyen domainleri forward eder;
(2) `doctor --full` + cloudflare probe artık node:dns Resolver ile 1.1.1.1'den çözer (belt) — mesh-dışı
Mac'te bile çalışır. Kanıt: `doctor --full` → `public /api/health: OK`.

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

---

# Named Tunnel — STABİL URL (ollamas.<domain>, restart'ta değişmez) (vT15)

Quick-tunnel URL her başlatmada değişir. **Named tunnel** kalıcı URL verir — ama Cloudflare'de bir **domain** ister.

## Adım 0 — Domain al (tek-seferlik, ~$2–9/yıl)

| Öneri | Registrar | 1.yıl / yenileme | Neden | Link |
|---|---|---|---|---|
| **`.dev` / `.app`** ⭐ | **Cloudflare Registrar** | ~$8.75 / ~$12.87 | At-cost (yenileme tuzağı yok), ücretsiz WHOIS privacy + 1-tık DNSSEC, **HSTS-preloaded → zorunlu HTTPS**, **zaten Cloudflare NS'de** → tünel anında çalışır (nameserver adımı yok) | https://domains.cloudflare.com/ |
| `.com` | Cloudflare Registrar | ~$10.44 sabit | En tanınır TLD, at-cost sabit | https://domains.cloudflare.com/ |
| **`.top` en ucuz** | **Porkbun** | **$1.63 / $4.63** | En düşük yenileme; sonra Cloudflare free plan'a ekle + nameserver değiştir | https://porkbun.com/products/domains |

**Öneri:** Cloudflare Registrar `.dev` (zaten CF NS → sıfır nameserver adımı, zorunlu-HTTPS). Salt-ucuz: Porkbun `.top`.
Başka yerden alındıysa: Cloudflare free plan'a site ekle → nameserver'ları Cloudflare'in verdiği 2 NS'e çevir → "Active" bekle.

## Adım 1 — İKİ yöntemden birini seç (CLI ikisini de destekler)

### Yöntem A — Dash token (en basit, cert.pem gerekmez)
1. Cloudflare dash → **Zero Trust → Networks → Tunnels → Create a tunnel** → "ollamas" → **Save**.
2. **Public Hostname** ekle: hostname `ollamas.<domain>`, Service **HTTP** = `127.0.0.1:8443`.
3. Kurulum ekranındaki **token**'ı kopyala (`cloudflared service install eyJ...` içindeki `eyJ...`).
4. Mac'te:
```bash
node src/cli.ts proxy cloudflare named token eyJ...TOKEN... --hostname ollamas.<domain>
```

### Yöntem B — CLI login (locally-managed)
```bash
! cloudflared tunnel login                                   # tarayıcı: domain'i seç → cert.pem yazar
node src/cli.ts proxy cloudflare named create ollamas --hostname ollamas.<domain>
# ↑ CLI otomatik: tunnel create + route dns (CNAME) + config.yml render + şifreli sakla
```

## Adım 2 — Always-on (0-manuel)
```bash
node src/cli.ts setup --daemon      # autopilot + gateway + named-tunnel = 3 LaunchAgent, login'de oto-başlar
# ya da yalnız named: node src/cli.ts proxy cloudflare named daemon install
```

## Doğrula
```bash
node src/cli.ts proxy cloudflare named status     # named: https://ollamas.<domain> · mode=... (token SIZMAZ)
node src/cli.ts status                            # named satırı + gateway
curl -H "X-Proxy-Key: pxy_..." https://ollamas.<domain>/api/health    # → 200, her ağdan, URL STABİL
```

iPhone/herhangi cihaz: OpenAI-uyumlu app → Base URL `https://ollamas.<domain>/v1`, API Key `pxy_...`.

**Güvenlik:** token keystore AES-256-GCM ile şifreli (RISK-TUNNEL-028), status/log'da asla görünmez; named tünel de
aktif `pxy_` key + canlı gateway olmadan açılmaz (RISK-TUNNEL-024 + dead-gateway guard). `.dev`/`.app` = zorunlu HTTPS.
