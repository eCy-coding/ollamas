# Reçete — Always-On Daemon (vT7): login'de otomatik, çökerse restart

> "0 manuel işlem" capstone'u. **Tek-seferlik kurulum** (brew-benzeri); kurulumdan SONRA çalışma
> tamamen otonom — login'de otomatik başlar, çökerse `KeepAlive` ile yeniden kalkar. Recurring
> manuel işlem YOK.

## Kur (bir kez)

```bash
cd ~/Desktop/ollamas/tunnel
node src/cli.ts daemon install
# → ~/Library/LaunchAgents/com.ollamas.tunnel.autopilot.plist yazar + launchctl load
```

LaunchAgent şunu çalıştırır: `node src/cli.ts auto --watch` (otonom seçim + self-heal döngüsü, vT4).
`RunAtLoad`=her login'de başlat · `KeepAlive{SuccessfulExit:false}`=çökerse yeniden başlat ·
`ThrottleInterval=10`=restart fırtınası önle.

## Durum / log

```bash
node src/cli.ts daemon status          # installed/loaded/pid
tail -f ~/Desktop/ollamas/tunnel/keys/daemon.log
node src/cli.ts status                 # aktif transport + connectivity (online/lan-only/offline)
```

## Kaldır

```bash
node src/cli.ts daemon uninstall       # launchctl unload + plist sil
```

## Gotcha'lar

- **Güncellemeden önce kaldır (RISK-TUNNEL-019):** KeepAlive açık servis, kod güncellemesi/restart'ı
  bloklayabilir. Büyük güncelleme öncesi `daemon uninstall`, sonra tekrar `install`.
- **Log büyümesi (RISK-TUNNEL-020):** `keys/daemon.log` büyür; gerekirse elle döndür (tam log-rotation vT8).
- **launchctl yoksa:** plist yine yazılır; çıktı `launchctl load -w <yol>` elle komutunu verir (zarif).
- **0-manuel:** install tek komut (tek-seferlik kurulum, `brew install` gibi); sonrası otonom — bu lane'in
  "0 manuel işlem" hedefi kurulumdan sonra sağlanır.
- macOS 13+ `SMAppService` modern alternatif; bu reçete klasik plist (geniş uyum) kullanır.
