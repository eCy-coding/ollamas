# HEARTBEAT — Sürdürülebilir Zero-Touch Orkestrasyon (vO9)

Otonom heartbeat: conductor'ı (vO8) periyodik kendi koşar → collision-safe (claims.ts) tek-eylem
seçer → idle/stuck lane tespit → **yalnız değişince** bildirir (delta-notify). 0 manuel seçim/işlem.

## Çalıştırma (3 yol)

### 1. Manuel tek tick
```bash
tsx orchestration/bin/heartbeat.ts --once
```

### 2. In-process watch (sekme açıkken)
```bash
tsx orchestration/bin/heartbeat.ts --watch 600   # her 600s tick; Ctrl-C ile çık
```

### 3. macOS LaunchAgent (sürdürülebilir, sekme kapalıyken de) — **T0 KARARI, yüklenmez**
`heartbeat.plist` teslim edildi ama **yüklenmedi** (launchctl load = system değişiklik = senin kararın):
```bash
plutil -lint orchestration/heartbeat.plist                 # geçerlilik
cp orchestration/heartbeat.plist ~/Library/LaunchAgents/com.ollamas.orchestration.heartbeat.plist
launchctl load ~/Library/LaunchAgents/com.ollamas.orchestration.heartbeat.plist
# durdurma:
launchctl unload ~/Library/LaunchAgents/com.ollamas.orchestration.heartbeat.plist
```

### Alternatif (harness-level): `/loop`
```
/loop 10m tsx orchestration/bin/heartbeat.ts --once
```

## Davranış
- **Collision-safe:** conductor'un seçtiği eylemin lane'i başka sekmece aktif claim'liyse → sonraki claim'siz öncelikli eylemi seçer (claims.ts file-lease TTL+fence). İki sekme aynı işi yapmaz.
- **Delta-notify:** `stateHash` (djb2) değişince `signal.notify` (terminal-notifier/stdout). Aynıysa sessiz (alert-fatigue önle). Kanıt: 2. ardışık tick → "sessiz".
- **Stuck tespit:** idle lane `ageHours > ORCH_IDLE_HOURS` (default 6) → notify'a `stuck=[...]`.
- **Idempotent:** durum değişmedikçe yan-etki yok.
- **--nudge** (opt-in): stuck lane sekmesine §3.1 allowlist `git status` (dry-run default; gerçek gönderim `ORCH_NUDGE_LIVE=1`).

## Scope (§3)
Heartbeat **observe + decide + notify** yapar; lane feature kodu YAZMAZ/act ETMEZ. Eylem önerir,
lane sekmesi yürütür. notify/nudge = §3.1 koordinasyon istisnası (allowlist + dry-run).

## Privacy gotcha (RISK-SCR-006)
LaunchAgent PPID=1 → macOS Local Network Privacy outbound-LAN'ı sessizce bloklayabilir. heartbeat
yalnız localhost/terminal-notifier kullanır (LAN egress yok) → etkilenmez.

## Env
- `ORCH_IDLE_HOURS` (default 6) — stuck eşiği.
- `ORCH_NUDGE_LIVE=1` — `--nudge` gerçek gönderim (yoksa dry-run).
