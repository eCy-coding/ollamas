# Reçete — Tek-Komut Onboarding (vT9): `tunnel setup`

> Sıfırdan otonom-tünele TEK komut. Kullanıcı hangi transport'u SEÇMEZ — sistem ne mümkünse
> (binary varsa) otomatik kurar, en iyiyi kaldırır, `--daemon` ile kalıcı yapar. 0 manuel seçim.

## Ön-koşul (binary'ler — ne kadarı varsa o kadar transport kurulur)

```bash
brew install wireguard-tools   # WireGuard p2p (vT1)
brew install caddy mkcert      # LAN-TLS (vT2)
brew install headscale         # Sovereign mesh (vT3)
```
> Hiçbiri yoksa `setup` zarifçe "no usable transport" + brew-hint verir (crash yok).

## Kur (tek komut)

```bash
cd ~/Desktop/ollamas-tunnel-wt/tunnel
node src/cli.ts setup --daemon
```

`setup` sırayla:
1. **capability-detect** — hangi binary'ler var (`wg-quick`/`caddy`/`mkcert`/`headscale`).
2. **planSetup** — her transport: configure / skip-exists (idempotent) / missing-binary.
3. **configure** — eksik config'leri üret (mevcut `config`/`tls`/`mesh` reuse).
4. **autopilot** — en iyi sağlıklı transport'u kaldır (vT4 autoUp).
5. **--daemon** — LaunchAgent kur (login-oto + crash-restart, vT7).

## Idempotent

`setup` tekrar çalıştırılabilir: var-olan config'ler skip-exists ile atlanır, yalnız eksikler üretilir.
Güvenli re-run (kısmi-başarı sonrası tamamlama, RISK-TUNNEL-023).

## Durum / kaldır

```bash
node src/cli.ts status      # aktif transport + connectivity
node src/cli.ts teardown    # wg down + daemon uninstall (config'ler keys/'de kalır)
```

## 0-manuel

- Tek komut; transport seçimi otomatik (capability-based) → **0 manuel seçim**.
- `--daemon` sonrası kalıcı otonom (login-oto + crash-restart) → **0 manuel işlem**.
- Tek manuel adım brew kurulumu (tek-seferlik, binary ön-koşulu) — kod değil ortam.
