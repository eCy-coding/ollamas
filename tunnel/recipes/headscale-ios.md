# Reçete — Headscale: egemen mesh (vT3, self-host control-plane)

> Çok-cihaz + remote tek overlay. Tailscale **SaaS YOK** — koordinasyon kendi Mac'inde, hesap yok
> (preauth key). iOS resmi Tailscale app'i bizim control URL'imize bakar. WireGuard data-plane (vT1) reuse.

## 0. Ön-koşul (bir kez)

```bash
brew install headscale          # BSD-3, binary-invoke (kaynak kopyalanmaz)
# iPhone: App Store → Tailscale (resmi client; egemenlik = control-plane self-host, client değil — RISK-TUNNEL-009)
```

## 1. Config üret (MacBook)

```bash
cd ~/Desktop/ollamas-tunnel-wt/tunnel
node src/cli.ts mesh
# → keys/headscale.yaml (gitignored), Coordination URL + sıradaki adımları yazdırır
```

## 2. Control-plane başlat + kullanıcı + preauth key (MacBook)

```bash
headscale serve --config keys/headscale.yaml &          # tek Go binary, gömülü DERP (NAT traversal)
headscale users create ollamas
headscale preauthkeys create --user ollamas --reusable --expiration 24h   # ← çıkan key'i kopyala (hesap YOK)
```

## 3. iPhone'u kat (no-MDM)

1. iPhone → **Ayarlar** → aşağı kaydır → **Tailscale** → **ALTERNATE COORDINATION SERVER URL** =
   `http://<Mac>.local:8080` (cmd çıktısındaki Coordination URL). *(Tailscale app v1.38.1+ gerekli.)*
2. Tailscale app → **Log in** → kendi sunucumuza yönlenir.
3. MacBook'ta onayla:
   ```bash
   headscale nodes register --user ollamas --key <iPhone'da görünen mkey>
   # veya app login akışında preauth key'i kullan
   ```

## 4. E2E kanıt (vT3 done-gate)

iPhone (mesh aktif, WiFi'de VEYA hücresel/remote):
```
http://100.64.0.1:3000/api/health  → 200
```
> 100.64.0.1 = headscale'in bu Mac'e atadığı mesh IP (`node src/cli.ts mesh` → "ollamas over mesh").

## 5. Zero-account doğrulama

- Tailscale hesabı **açılmadı** → `headscale preauthkeys`/`nodes register` ile kimlik.
- DERP gömülü (kendi STUN/relay) → NAT arkasında bile Tailscale SaaS relay'e gerek yok (RISK-TUNNEL-008).
- Tüm trafik kendi WireGuard data-plane'inde; control-plane kendi Mac'inde.

## Sorun giderme

- **Bağlanmıyor / NAT:** UDP delik açılamıyorsa gömülü DERP devrede mi (`derp.server.enabled: true`).
  Mac firewall `headscale`/3478 (STUN) izin versin.
- **iPhone login URL'i açmıyor:** alternate coordination URL `http(s)://` tam mi; Tailscale app güncel mi (≥1.38.1).
- **`headscale: command not found`:** `brew install headscale`.
- **preauth key sızıntısı:** key'i commit etme/loglama (keys/ 0600 gitignored, RISK-TUNNEL-010).
