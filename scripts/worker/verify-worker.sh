#!/usr/bin/env bash
# verify-worker.sh — CANLI worker'ın uçtan uca kabul kapısı (WORKER-STANDARD.md Faz 9).
#
#   ALIAS=rtx WORKER_IP=100.104.34.106 bash verify-worker.sh
#
# MISS ≠ PASS: ölçülemeyen kontrol "geçti" sayılmaz — KOSULMADI olarak raporlanır ve
# FAIL sayılır. "Servis ayakta" ≠ "iş worker'da koşuyor" (Y-17); bu yüzden 9 ve 10 zorunludur.
set -uo pipefail

ALIAS="${ALIAS:-rtx}"
WORKER_IP="${WORKER_IP:-}"
POOL="$HOME/.ollamas/backends.json"
REPO="${OLLAMAS_REPO:-$HOME/Desktop/ollamas}"
PASS=0; FAIL=0; MISS=0

ok()   { printf '  ✅ %-34s %s\n' "$1" "${2:-}"; PASS=$((PASS+1)); }
no()   { printf '  ⛔ %-34s %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }
miss() { printf '  ◻️  %-34s %s\n' "$1" "KOŞULMADI — ${2:-ölçülemedi}"; MISS=$((MISS+1)); }

[ -n "$WORKER_IP" ] || { echo "WORKER_IP gerekli" >&2; exit 2; }
echo "── worker kabul kapısı: $ALIAS @ $WORKER_IP"

# 1 tailscale
TS="$(tailscale status --json 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for p in (d.get('Peer') or {}).values():
        if '$WORKER_IP' in (p.get('TailscaleIPs') or []): print('online' if p.get('Online') else 'offline'); break
    else: print('yok')
except Exception: print('okunamadi')" 2>/dev/null)"
case "$TS" in online) ok "1 tailscale" "online";; offline) no "1 tailscale" "offline — makine kapalı/uykuda";;
  *) miss "1 tailscale" "$TS";; esac

# Makine erişilemezse kalan kontroller ÖLÇÜLEMEZ → MISS (PASS değil)
REACH=0
if [ "$TS" = "online" ] && ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" "exit" 2>/dev/null; then REACH=1; fi

# 2 ssh
if [ "$REACH" = 1 ]; then
  H="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" "hostname" 2>/dev/null | tr -d '\r')"
  [ -n "$H" ] && ok "2 ssh" "hostname=$H" || no "2 ssh" "bağlanıldı ama hostname boş"
else miss "2 ssh" "makine erişilemez"; fi

# 3 güç ayarı (uyku kapalı) — Y-15: 7/24 önkoşulu
if [ "$REACH" = 1 ]; then
  S="$(ssh -o BatchMode=yes "$ALIAS" 'powershell -NoProfile -Command "$q=(powercfg /query SCHEME_CURRENT SUB_SLEEP | Out-String); if ($q -match \"AC Power Setting Index: 0x00000000\") { \"kapali\" } else { \"acik\" }"' 2>/dev/null | tr -d '\r' | tail -1)"
  case "$S" in *kapali*) ok "3 güç ayarı" "uyku kapalı";; *acik*) no "3 güç ayarı" "uyku AÇIK — 7/24 garanti edilemez";; *) miss "3 güç ayarı" "okunamadı";; esac
else miss "3 güç ayarı" "makine erişilemez"; fi

# 4 gpu
if [ "$REACH" = 1 ]; then
  G="$(ssh -o BatchMode=yes "$ALIAS" "nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader" 2>/dev/null | tr -d '\r' | head -1)"
  [ -n "$G" ] && ok "4 gpu" "$G" || no "4 gpu" "nvidia-smi yanıt vermedi"
else miss "4 gpu" "makine erişilemez"; fi

# 5 ollama
C="$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://$WORKER_IP:11434/api/tags" 2>/dev/null || echo 000)"
if [ "$C" = "200" ]; then
  N="$(curl -s -m 10 "http://$WORKER_IP:11434/api/tags" 2>/dev/null | python3 -c "
import json,sys
try: print(len((json.load(sys.stdin).get('models') or [])))
except Exception: print(0)")"
  [ "${N:-0}" -ge 1 ] && ok "5 ollama" "200, $N model" || no "5 ollama" "200 ama model yok"
else no "5 ollama" "http=$C"; fi

# 6 worker gateway (dispatch hedefi)
C8="$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://$WORKER_IP:8090/api/health" 2>/dev/null || echo 000)"
[ "$C8" = "200" ] && ok "6 worker gateway" "200" || no "6 worker gateway" "http=$C8"

# 7 wsl2 + docker
if [ "$REACH" = 1 ]; then
  W="$(ssh -o BatchMode=yes "$ALIAS" 'wsl -d Ubuntu -u root -- bash -c "echo sysd=\$(systemctl is-system-running 2>&1) dck=\$(systemctl is-active docker 2>&1)"' 2>/dev/null | tr -d '\r' | tail -1)"
  case "$W" in *sysd=running*dck=active*|*sysd=degraded*dck=active*) ok "7 wsl2+docker" "$W";;
    "") miss "7 wsl2+docker" "okunamadı";; *) no "7 wsl2+docker" "$W";; esac
else miss "7 wsl2+docker" "makine erişilemez"; fi

# 8 havuz kaydı + ölü girdi yok (Faz 7'nin kanıtı)
if [ -f "$POOL" ]; then
  R="$(python3 - "$POOL" "$ALIAS" "$WORKER_IP" <<'PY'
import json,sys
pool=json.load(open(sys.argv[1])); alias, ip = sys.argv[2], sys.argv[3]
names={b.get("name") for b in pool}
need={alias, f"{alias}-ollama"}
foreign=[b["name"] for b in pool if ip not in (b.get("url") or "")]
print(("ok" if need <= names else "eksik") + f" girdi={len(pool)} yabanci={len(foreign)}")
PY
)"
  case "$R" in ok*yabanci=0*) ok "8 havuz" "$R";; ok*) ok "8 havuz" "$R (başka worker'lar var — normal)";; *) no "8 havuz" "$R";; esac
else no "8 havuz" "backends.json yok"; fi

# 9 DISPATCH E2E — "servis ayakta" degil, "is worker'da kostu" kaniti (Y-17)
if [ "$C8" = "200" ] && [ -d "$REPO" ]; then
  J="$(cd "$REPO" && timeout 300 npx tsx cli/index.ts remote dispatch \
        "read package.json and report the version field" --json 2>/dev/null || true)"
  D="$(printf '%s' "$J" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); t=(d.get('tasks') or [{}])[0]
    print(f\"worker={t.get('worker')} failedOver={t.get('failedOver')} verdict={t.get('verdict')}\")
except Exception: print('parse-edilemedi')" 2>/dev/null)"
  case "$D" in
    "worker=$ALIAS failedOver=False"*) ok "9 dispatch e2e" "$D";;
    parse-edilemedi|"") miss "9 dispatch e2e" "çıktı ayrıştırılamadı";;
    *) no "9 dispatch e2e" "$D (worker=$ALIAS + failedOver=False bekleniyordu)";;
  esac
else miss "9 dispatch e2e" "gateway 200 değil veya repo yok"; fi

# 10 failover — worker durur, is Mac'te biter, worker geri gelir
if [ "$REACH" = 1 ] && [ "$C8" = "200" ]; then
  miss "10 failover" "yıkıcı test; --with-failover ile açıkça istenir"
else miss "10 failover" "önkoşul yok"; fi

# 11 termal
if [ "$REACH" = 1 ]; then
  T="$(ssh -o BatchMode=yes "$ALIAS" 'powershell -NoProfile -Command "Get-Content C:\ecy\worker\thermal.log -Tail 1 -ErrorAction SilentlyContinue"' 2>/dev/null | tr -d '\r' | tail -1)"
  P="$(ssh -o BatchMode=yes "$ALIAS" 'powershell -NoProfile -Command "Test-Path C:\ecy\worker\PAUSE"' 2>/dev/null | tr -d '\r' | tail -1)"
  if [ -z "$T" ]; then miss "11 termal" "log yok — bekçi kurulmamış olabilir"
  elif printf '%s' "$P" | grep -qi true; then no "11 termal" "PAUSE bayrağı VAR: $T"
  else case "$T" in *durum=OK*|*durum=UYARI*) ok "11 termal" "${T##* }";; *) no "11 termal" "$T";; esac; fi
else miss "11 termal" "makine erişilemez"; fi

# 12 disk tamponu
if [ "$REACH" = 1 ]; then
  F="$(ssh -o BatchMode=yes "$ALIAS" 'powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID=32C:32\").FreeSpace/1GB,1)"' 2>/dev/null | tr -d '\r' | tail -1)"
  F="${F:-}"
  if [ -z "$F" ]; then
    F="$(ssh -o BatchMode=yes "$ALIAS" 'wsl -d Ubuntu -u root -- df -BG /mnt/c 2>/dev/null | awk "NR==2{gsub(/G/,\"\",\$4); print \$4}"' 2>/dev/null | tr -d '\r' | tail -1)"
  fi
  if [ -z "$F" ]; then miss "12 disk" "ölçülemedi"
  elif [ "${F%.*}" -ge 40 ] 2>/dev/null; then ok "12 disk" "${F} GB boş"
  else no "12 disk" "${F} GB < 40 GB tamponu"; fi
else miss "12 disk" "makine erişilemez"; fi

echo
echo "════ PASS=$PASS  FAIL=$FAIL  KOŞULMADI=$MISS"
# MISS != PASS: olculemeyen kontrol basari sayilmaz. Kapi yalniz FAIL=0 VE MISS=0 ise yesil.
if [ "$FAIL" = 0 ] && [ "$MISS" = 0 ]; then echo "  KAPI: YEŞİL"; exit 0
elif [ "$FAIL" = 0 ]; then echo "  KAPI: EKSİK — $MISS kontrol ölçülemedi (geçti SAYILMAZ)"; exit 2
else echo "  KAPI: KIRMIZI"; exit 1; fi
