#!/usr/bin/env bash
# provision-worker.sh — Windows+NVIDIA makinesini ollamas worker'ına çevirir.
#
#   bash provision-worker.sh <tailscale-ip> [--alias rtx] [--user ollamas]
#                            [--name rtx-worker] [--from <faz>] [--dry-run]
#
# SÖZLEŞMELER (WORKER-STANDARD.md §0):
#   · MISS ≠ PASS       — ölçülemeyen adım geçmiş sayılmaz; kapı kırmızıysa DURUR
#   · Kanıt = ham çıktı — "yazdım" yetmez, ölçülür (.wslconfig yazıldı ≠ uygulandı)
#   · Taşıma base64     — sohbet/kabuk katmanları `_` ve `*` yutar
#   · Tek kök klasör    — C:\ecy (Windows) · /opt/ecy (WSL)
#   · Sır hedefte kalır — worker'ın MASTER_KEY_B64'ü orada üretilir
#   · İdempotent        — ikinci koşu zarar vermez, yapılmışı atlar
#
# Bu script YAPMAZ (WORKER-STANDARD.md §B): winget kurulumu · npm ci ·
# sshd_config'e append · `-First 1` ile sensör okuma · SYSTEM olarak WSL · .env yazma
set -uo pipefail

WORKER_IP="${1:-}"; shift || true
ALIAS="rtx"; SSH_USER="ollamas"; NEW_NAME="rtx-worker"; FROM=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --alias) ALIAS="$2"; shift 2;;
    --user)  SSH_USER="$2"; shift 2;;
    --name)  NEW_NAME="$2"; shift 2;;
    --from)  FROM="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    *) echo "bilinmeyen argüman: $1" >&2; exit 2;;
  esac
done
[ -n "$WORKER_IP" ] || { echo "kullanım: provision-worker.sh <tailscale-ip> [--alias X] [--from N]" >&2; exit 2; }

STATE_DIR="$HOME/.ollamas/worker"
KEY="$HOME/.ssh/id_${ALIAS}"
mkdir -p "$STATE_DIR"
export WORKER_SSH_HOST="$ALIAS"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

say()  { printf '\n\033[1m══ %s\033[0m\n' "$*"; }
ok()   { printf '   ✅ %s\n' "$*"; }
bad()  { printf '   ⛔ %s\n' "$*" >&2; }
gate() { # gate <ad> <kosul-cikti> <beklenen-desen>
  if printf '%s' "$2" | grep -qE "$3"; then ok "KAPI $1: PASS ($2)"; return 0
  else bad "KAPI $1: FAIL — beklenen /$3/, ölçülen: ${2:-<bos>}"; return 1; fi
}
skip() { [ "$FROM" -gt "$1" ]; }

# ───────────────────────────────────────────────────────────────────────────────
# FAZ 0 — insan eli gereken TEK faz: tek base64 bloğu üretilir
# ───────────────────────────────────────────────────────────────────────────────
faz0_blok() {
  say "FAZ 0 — yönetim kanalı (tek yapıştırma gerekiyor)"
  [ -f "${KEY}.pub" ] || { ssh-keygen -t ed25519 -f "$KEY" -N "" -C "provision-${ALIAS}" -q; ok "anahtar üretildi: $KEY"; }
  local pub; pub="$(cat "${KEY}.pub")"
  # Sıra ÖNEMLİ: ASCII ad (Y-1) SSH'tan önce; profil (0.7) hesap açıldıktan sonra.
  # sshd_config'e DOKUNULMAZ (Y-2) — varsayılan config yeterli.
  local ps; ps=$(cat <<PSEOF
\$ErrorActionPreference = "Continue"
if (-not (Get-WindowsCapability -Online -Name OpenSSH.Server* | Where-Object State -eq Installed)) {
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
}
Set-Service sshd -StartupType Automatic; Start-Service sshd
\$pw = (-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]\$_})) + '!Aa9'
if (-not (Get-LocalUser $SSH_USER -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name $SSH_USER -Password (ConvertTo-SecureString \$pw -AsPlainText -Force) -FullName "ollamas worker" -PasswordNeverExpires -AccountNeverExpires | Out-Null
} else { Set-LocalUser -Name $SSH_USER -Password (ConvertTo-SecureString \$pw -AsPlainText -Force) }
Add-LocalGroupMember -Group Administrators -Member $SSH_USER -ErrorAction SilentlyContinue
# Windows profili SART (0.7): profil yoksa sshd oturum acamaz
schtasks /create /tn mkprofile /tr "cmd.exe /c echo ok" /sc once /st 23:59 /ru "$SSH_USER" /rp "\$pw" /f | Out-Null
schtasks /run /tn mkprofile | Out-Null
Start-Sleep -Seconds 12
schtasks /delete /tn mkprofile /f | Out-Null
# WSL keepalive gorevi ayni parolayla (Y-8: SYSTEM desteklenmez) — dagitim sonra kurulacak
schtasks /create /tn "ecy-wsl-keepalive" /tr "C:\\WINDOWS\\system32\\wsl.exe -d Ubuntu -u root --exec /usr/bin/sleep infinity" /sc onstart /ru "$SSH_USER" /rp "\$pw" /rl HIGHEST /f | Out-Null
\$f = "\$env:ProgramData\\ssh\\administrators_authorized_keys"
Set-Content -Path \$f -Value '$pub' -Encoding ascii
icacls \$f /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
Get-NetFirewallRule -Name ecy-worker -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name ecy-worker -DisplayName "ecy worker (tailnet+LAN)" -Direction Inbound -Protocol TCP -LocalPort 22,11434,8090 -RemoteAddress @('100.64.0.0/10','192.168.0.0/16') -Action Allow | Out-Null
# 0.10 GUC AYARLARI — Y-15: sona birakilirsa makine kurulumun ORTASINDA uyur (oldu).
# 7/24 bir hedef degil ONKOSUL: uyuyan makinede sonraki hicbir faz kosamaz.
powercfg /change standby-timeout-ac 0    | Out-Null
powercfg /change hibernate-timeout-ac 0  | Out-Null
powercfg /change monitor-timeout-ac 15   | Out-Null
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 | Out-Null
powercfg /setactive SCHEME_CURRENT       | Out-Null
\$sleep = ((powercfg /query SCHEME_CURRENT SUB_SLEEP) | Out-String)
Write-Host ("SLEEP_AC=" + \$(if (\$sleep -match "AC Power Setting Index: 0x00000000") { "0-kapali" } else { "AYARLANAMADI" }))
Restart-Service sshd
Write-Host ("PROFILE=" + (Test-Path "C:\\Users\\$SSH_USER"))
Write-Host ("SSHD=" + (Get-Service sshd).Status)
Write-Host ("ACCT=" + (Get-LocalUser $SSH_USER).Name)
if (\$env:COMPUTERNAME -cne "$NEW_NAME") {
  Rename-Computer -NewName "$NEW_NAME" -Force            # Y-1: ASCII ad SART
  Write-Host "RENAME=$NEW_NAME — 10 sn sonra yeniden baslatiliyor"
  Start-Sleep -Seconds 10
  Restart-Computer -Force
} else { Write-Host ("NAME_OK=" + \$env:COMPUTERNAME) }
PSEOF
)
  local b64; b64="$(printf '%s' "$ps" | python3 -c "import base64,sys;print(base64.b64encode(sys.stdin.read().encode('utf-16-le')).decode())")"
  echo
  echo "Hedef makinede YÖNETİCİ PowerShell'de şu tek satırı çalıştır:"
  echo
  echo "powershell -EncodedCommand $b64"
  echo
  echo "(makine adı ASCII değilse yeniden başlatır — normal; sonra bu script'i --from 1 ile tekrar çağır)"
}

faz0_kapi() {
  local h; h="$(ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
                  -i "$KEY" "${SSH_USER}@${WORKER_IP}" "hostname" 2>/dev/null | tr -d '\r')"
  [ -n "$h" ] || { bad "SSH kurulamadı — Faz 0 bloğu çalıştırıldı mı?"; return 1; }
  ok "SSH çalışıyor: hostname=$h"
  # ~/.ssh/config idempotent alias
  python3 - "$ALIAS" "$WORKER_IP" "$SSH_USER" "$KEY" <<'PY'
import re, sys, pathlib
alias, ip, user, key = sys.argv[1:5]
p = pathlib.Path.home()/".ssh"/"config"; t = p.read_text() if p.exists() else ""
out, skip = [], False
for l in t.split("\n"):
    if re.match(rf'^Host\s+{re.escape(alias)}\s*$', l): skip = True; continue
    if re.match(r'^Host\s', l): skip = False
    if not skip: out.append(l)
blk = f"\nHost {alias}\n    HostName {ip}\n    User {user}\n    IdentityFile {key}\n    IdentitiesOnly yes\n    StrictHostKeyChecking accept-new\n    ServerAliveInterval 30\n"
p.write_text("\n".join(out).rstrip()+"\n"+blk); p.chmod(0o600)
PY
  gate "0" "$(ssh -o BatchMode=yes "$ALIAS" "hostname" 2>/dev/null | tr -d '\r')" "." || return 1
}

# ───────────────────────────────────────────────────────────────────────────────
faz1_envanter() {
  say "FAZ 1 — envanter (salt-okunur)"
  local json; json="$(psjson <<'PSEOF'
$ErrorActionPreference = "SilentlyContinue"
$os=Get-CimInstance Win32_OperatingSystem; $cs=Get-CimInstance Win32_ComputerSystem
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$c=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$gpu=@{}
$smi=(& nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>$null)
if ($smi) { $p=$smi -split "," | ForEach-Object { $_.Trim() }; $gpu=@{name=$p[0];vram=$p[1];driver=$p[2]} }
# Y-3: yetenek OZELLIK durumundan okunur, `Get-Command wsl` YANILTICI
@{ hostname=$env:COMPUTERNAME; os_build=[int]$os.BuildNumber
   cpu=$cpu.Name; cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors
   ram_gb=[math]::Round($cs.TotalPhysicalMemory/1GB,1)
   disk_free_gb=[math]::Round($c.FreeSpace/1GB,1); gpu=$gpu
   wsl_feature=(Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux").State.ToString()
   vmp_feature=(Get-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform").State.ToString()
   mirrored_ok=([int]$os.BuildNumber -ge 22621)
} | ConvertTo-Json -Depth 3 -Compress
PSEOF
)"
  [ -n "$json" ] || { bad "envanter alınamadı"; return 1; }
  echo "$json" | python3 -m json.tool > "$STATE_DIR/worker-inventory.json"
  python3 - "$STATE_DIR/worker-inventory.json" <<'PY'
import json,sys,re
d=json.load(open(sys.argv[1])); g=d.get("gpu") or {}
print(f"   HOST {d['hostname']}  build {d['os_build']}")
print(f"   GPU  {g.get('name')}  VRAM {g.get('vram')}  driver {g.get('driver')}")
print(f"   CPU  {d['cpu']} ({d['cores']}c/{d['threads']}t)  RAM {d['ram_gb']} GB  DISK {d['disk_free_gb']} GB")
print(f"   WSL  feature={d['wsl_feature']}  vmp={d['vmp_feature']}  mirrored={d['mirrored_ok']}")
f=[]
if (d.get("disk_free_gb") or 0) < 80: f.append(f"disk {d.get('disk_free_gb')} GB < 80")
if not re.search(r'\d', str(g.get("vram",""))): f.append("VRAM OLCULEMEDI")
if (d.get("ram_gb") or 0) < 16: f.append(f"RAM {d.get('ram_gb')} GB < 16")
print("   KAPI 1: FAIL — " + "; ".join(f) if f else "   KAPI 1: PASS")
sys.exit(1 if f else 0)
PY
}

# ───────────────────────────────────────────────────────────────────────────────
faz2_kok() {
  say "FAZ 2 — tek kök klasör (C:\\ecy) + OLLAMA_MODELS (Ollama'dan ÖNCE)"
  local out; out="$(psrun <<'PSEOF'
foreach ($d in @("C:\ecy","C:\ecy\ollama\models","C:\ecy\wsl","C:\ecy\worker","C:\ecy\tmp")) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null }
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS","C:\ecy\ollama\models","Machine")
Write-Host ("KOK=" + (Test-Path "C:\ecy\ollama\models") + " MODELS=" + [Environment]::GetEnvironmentVariable("OLLAMA_MODELS","Machine"))
PSEOF
)"
  gate "2" "$out" "KOK=True MODELS=C:\\\\ecy"
}

# ───────────────────────────────────────────────────────────────────────────────
faz3_gpu() {
  say "FAZ 3 — Windows-native GPU katmanı (winget YOK — Y-5)"
  local cores; cores="$(python3 -c "import json;print(json.load(open('$STATE_DIR/worker-inventory.json'))['cores'])")"
  psrun <<PSEOF 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -3
\$ErrorActionPreference="Continue"
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
\$exe=(Get-ChildItem "C:\\Users\\$SSH_USER\\AppData\\Local\\Programs\\Ollama\\ollama.exe","C:\\Program Files\\Ollama\\ollama.exe" -EA SilentlyContinue | Select-Object -First 1)
if (-not \$exe) {
  \$t="C:\\ecy\\tmp\\OllamaSetup.exe"
  Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile \$t -UseBasicParsing
  Start-Process \$t -ArgumentList "/VERYSILENT","/NORESTART" -Wait
  Remove-Item \$t -Force -EA SilentlyContinue      # artik temizligi (6.4)
  \$exe=(Get-ChildItem "C:\\Users\\$SSH_USER\\AppData\\Local\\Programs\\Ollama\\ollama.exe","C:\\Program Files\\Ollama\\ollama.exe" -EA SilentlyContinue | Select-Object -First 1)
  Write-Host "OLLAMA_KURULDU"
} else { Write-Host "OLLAMA_ZATEN_KURULU" }
# 8 GB VRAM gercegi: tek model + tek paralel (2 model sessizce CPU'ya tasar)
[Environment]::SetEnvironmentVariable("OLLAMA_HOST","0.0.0.0:11434","Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE","30m","Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS","1","Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL","1","Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_THREAD","$cores","Machine")
\$a=New-ScheduledTaskAction -Execute \$exe.FullName -Argument "serve"
\$p=New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
\$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "ollama-serve" -Action \$a -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal \$p -Settings \$s -Force | Out-Null
Start-ScheduledTask -TaskName "ollama-serve"; Start-Sleep -Seconds 8
Write-Host ("TASK=" + (Get-ScheduledTask -TaskName "ollama-serve").State + " LISTEN=" + [bool](Get-NetTCPConnection -LocalPort 11434 -State Listen -EA SilentlyContinue))
PSEOF
  local code=""
  for _ in 1 2 3 4 5 6; do
    code="$(curl -s -o /dev/null -w "%{http_code}" -m 8 "http://$WORKER_IP:11434/api/tags" 2>/dev/null || true)"
    [ "$code" = "200" ] && break; sleep 5
  done
  gate "3" "http=$code" "http=200"
}

faz3b_modeller() {
  say "FAZ 3b — model seti (VRAM'den türetilir) + tok/s ölçümü"
  local vram; vram="$(python3 -c "
import json,re; d=json.load(open('$STATE_DIR/worker-inventory.json'))
m=re.search(r'(\d+)', str((d.get('gpu') or {}).get('vram','0'))); print(m.group(1) if m else 0)")"
  local models; if [ "$vram" -ge 11000 ]; then models="qwen3:8b qwen2.5vl:7b"; else models="qwen3:4b qwen3:8b"; fi
  echo "   VRAM=${vram} MiB → aday: $models"
  echo "[]" > "$STATE_DIR/bench.tmp"
  for m in $models; do
    curl -s -m 1800 "http://$WORKER_IP:11434/api/pull" -d "{\"model\":\"$m\",\"stream\":false}" >/dev/null 2>&1 || { bad "$m çekilemedi"; continue; }
    local r; r="$(curl -s -m 300 "http://$WORKER_IP:11434/api/generate" -d "{\"model\":\"$m\",\"prompt\":\"one sentence about GPUs\",\"stream\":false}" 2>/dev/null)"
    python3 - "$m" "$STATE_DIR/bench.tmp" "$r" <<'PY'
import json,sys
m,path,raw=sys.argv[1],sys.argv[2],sys.argv[3]
try:
    d=json.loads(raw); ec,ed=d.get("eval_count",0),d.get("eval_duration",0)
    tps=round(ec/(ed/1e9),1) if ec and ed else 0.0
except Exception: tps=0.0
a=json.load(open(path)); a.append({"model":m,"tokens_per_sec":tps}); json.dump(a,open(path,"w"),indent=2)
print(f"   {m:18} {tps:>7} tok/s" + ("  ⚠ 15 alti — dusuruldu" if 0<tps<15 else ""))
PY
  done
  mv "$STATE_DIR/bench.tmp" "$STATE_DIR/bench.json"
  gate "3b" "$(python3 -c "
import json; b=json.load(open('$STATE_DIR/bench.json'))
print('usable=%d' % len([e for e in b if e['tokens_per_sec']>=15]))")" "usable=[1-9]"
}

# ───────────────────────────────────────────────────────────────────────────────
faz4_wsl() {
  say "FAZ 4 — WSL2 (özellik → MSI → dağıtım → systemd → docker)"
  local st; st="$(python3 -c "
import json; d=json.load(open('$STATE_DIR/worker-inventory.json')); print(d['wsl_feature']+','+d['vmp_feature'])")"
  if [ "$st" != "Enabled,Enabled" ]; then
    echo "   özellikler kapalı ($st) → açılıyor + reboot"
    psrun <<'PSEOF' 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -3
Enable-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux" -All -NoRestart | Out-Null
Enable-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform" -All -NoRestart | Out-Null
Write-Host ("WSL=" + (Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux").State)
Start-Sleep -Seconds 5; Restart-Computer -Force
PSEOF
    echo "   reboot bekleniyor…"
    until ssh -o BatchMode=yes -o ConnectTimeout=6 "$ALIAS" "powershell -NoProfile -Command \"Write-Host R\"" 2>/dev/null | grep -q R; do sleep 10; done
    ok "makine döndü"
  else ok "WSL özellikleri zaten açık"; fi

  # Y-6: cekirdek GitHub MSI'dan (Store SSH baglaminda calismaz)
  psrun <<'PSEOF' 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -3
$ErrorActionPreference="Continue"
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
wsl --status *> $null
if ($LASTEXITCODE -eq 0) { Write-Host "WSL_CEKIRDEK_VAR" } else {
  $rel=Invoke-RestMethod "https://api.github.com/repos/microsoft/WSL/releases/latest" -UseBasicParsing
  $as=$rel.assets | Where-Object { $_.name -like "*x64.msi" } | Select-Object -First 1
  $msi="C:\ecy\tmp\wsl.msi"
  Invoke-WebRequest $as.browser_download_url -OutFile $msi -UseBasicParsing
  Start-Process msiexec.exe -ArgumentList "/i","`"$msi`"","/quiet","/norestart" -Wait | Out-Null
  Remove-Item $msi -Force -EA SilentlyContinue
  Start-Sleep -Seconds 10
}
$v=((wsl --version 2>&1)|Out-String) -replace "`0",""
Write-Host ("WSL_VERSION=" + (($v -replace "\s+"," ").Trim() -split " ")[2])
PSEOF

  # Y-7: rootfs tarball 404; cekirdek varken `wsl --install -d` kendi CDN'inden ceker
  psrun <<'PSEOF' 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -3
$ErrorActionPreference="Continue"
$l=((wsl --list --quiet 2>&1)|Out-String) -replace "`0",""
if ($l -notmatch "Ubuntu") { wsl --install -d Ubuntu --no-launch 2>&1 | Out-Null; Start-Sleep -Seconds 10 }
wsl --set-default Ubuntu 2>&1 | Out-Null
$l2=((wsl --list --quiet 2>&1)|Out-String) -replace "`0",""
Write-Host ("DISTRO=" + (($l2 -replace "\s+"," ").Trim()))
PSEOF

  # .wslconfig: Y-11 (yalniz dogrulanmis anahtar) + Y-13 (vmIdleTimeout=-1)
  local cores ramh; cores="$(python3 -c "import json;print(json.load(open('$STATE_DIR/worker-inventory.json'))['cores'])")"
  ramh="$(python3 -c "import json;print(int(json.load(open('$STATE_DIR/worker-inventory.json'))['ram_gb'])//2)")"
  psrun <<PSEOF 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -2
Set-Content -Path "C:\\Users\\$SSH_USER\\.wslconfig" -Encoding ascii -Value @(
  "[wsl2]","processors=$cores","memory=${ramh}GB","swap=4GB","networkingMode=mirrored","vmIdleTimeout=-1")
\$nl=[string][char]10
\$conf=@("[boot]","systemd=true","","[user]","default=root","") -join \$nl
\$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(\$conf))
wsl -d Ubuntu -u root -- bash -c "echo \$b | base64 -d > /etc/wsl.conf" 2>&1 | Out-Null
wsl --shutdown 2>&1 | Out-Null; Start-Sleep -Seconds 12
schtasks /run /tn "ecy-wsl-keepalive" 2>&1 | Out-Null    # Y-8: kullanici kimligi
Start-Sleep -Seconds 25
\$s=(((wsl -d Ubuntu -u root -- systemctl is-system-running 2>&1)|Out-String)).Replace([char]0,'')
Write-Host ("SYSTEMD=" + \$s.Trim())
PSEOF

  # Paketler + Y-4.7 docker DNS
  wslrun <<'BASHEOF' 2>&1 | tail -6
set -e; export DEBIAN_FRONTEND=noninteractive
mkdir -p /opt/ecy
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq curl git build-essential python3 python3-pip ca-certificates gnupg jq >/dev/null 2>&1
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs >/dev/null 2>&1; }
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release; CN=${UBUNTU_CODENAME:-$VERSION_CODENAME}
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CN stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io >/dev/null 2>&1
fi
# mirrored-mod DNS proxy'si daemon'dan cozulemez -> sabit resolver
mkdir -p /etc/docker
printf '{\n  "dns": ["1.1.1.1", "8.8.8.8"]\n}\n' > /etc/docker/daemon.json
systemctl enable --now docker >/dev/null 2>&1; systemctl restart docker; sleep 5
echo "NPROC=$(nproc) RAM_GB=$(free -g|awk 'NR==2{print $2}')"
echo "NODE=$(node -v)  DOCKER=$(docker --version|cut -d' ' -f3|tr -d ,)"
docker run --rm hello-world 2>&1 | grep -q "Hello from Docker" && echo "DOCKER_HELLO=OK" || echo "DOCKER_HELLO=FAIL"
BASHEOF
  gate "4" "$(wslrun <<<'echo "sysd=$(systemctl is-system-running 2>&1) node=$(command -v node >/dev/null && echo v) dck=$(systemctl is-active docker)"' 2>&1 | tail -1)" \
           "sysd=(running|degraded).*node=v.*dck=active"
}

# ───────────────────────────────────────────────────────────────────────────────
faz5_servis() {
  say "FAZ 5 — worker servisi (:8090)"
  local repo="${WORKER_REPO:-https://github.com/eCy-coding/ollamas.git}"
  local br="${WORKER_BRANCH:-feat/claudecode-vault}"
  local mm; mm="$(python3 -c "import json;print(int(json.load(open('$STATE_DIR/worker-inventory.json'))['ram_gb'])*6//10)")"
  wslrun <<BASHEOF 2>&1 | tail -8
set -e
mkdir -p /opt/ecy && cd /opt/ecy
if [ -d ollamas/.git ]; then echo "REPO_VAR"; else
  git clone --depth 1 --branch $br $repo ollamas >/dev/null 2>&1; fi
cd ollamas
# Y-9: npm ci lock drift'te calismaz; npm install kullanilir, lock commit EDILMEZ
[ -x node_modules/.bin/tsx ] || npm install --no-audit --no-fund >/dev/null 2>&1
echo "HEAD=\$(git log --oneline -1 | cut -c1-40)"
echo "TSX=\$(test -x node_modules/.bin/tsx && echo VAR || echo YOK)"
# Y-10: .env DOSYASI YOK — degiskenler unit icinde
cat > /etc/systemd/system/ollamas-worker.service <<'UNIT'
[Unit]
Description=ollamas worker API (:8090)
After=network-online.target docker.service
Wants=docker.service
[Service]
Type=simple
WorkingDirectory=/opt/ecy/ollamas
Environment=PORT=8090
Environment=HOST=0.0.0.0
Environment=OLLAMA_HOST=http://127.0.0.1:11434
Environment=NODE_ENV=production
ExecStart=/opt/ecy/ollamas/node_modules/.bin/tsx server.ts
Restart=always
RestartSec=10
StandardOutput=append:/opt/ecy/worker.log
StandardError=append:/opt/ecy/worker.log
CPUWeight=70
MemoryMax=${mm}G
[Install]
WantedBy=multi-user.target
UNIT
# MASTER_KEY_B64 HEDEFTE uretilir, drop-in chmod 600; kontrol makinesinin anahtari kopyalanmaz
if [ ! -f /etc/systemd/system/ollamas-worker.service.d/10-key.conf ]; then
  mkdir -p /etc/systemd/system/ollamas-worker.service.d
  umask 077
  printf '[Service]\nEnvironment=MASTER_KEY_B64=%s\n' "\$(head -c 32 /dev/urandom | base64 -w0)" \
    > /etc/systemd/system/ollamas-worker.service.d/10-key.conf
  chmod 600 /etc/systemd/system/ollamas-worker.service.d/10-key.conf
fi
systemctl daemon-reload; systemctl enable ollamas-worker >/dev/null 2>&1
systemctl restart ollamas-worker; sleep 22
echo "SERVIS=\$(systemctl is-active ollamas-worker)"
BASHEOF
  local code=""
  for _ in 1 2 3 4 5 6; do
    code="$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://$WORKER_IP:8090/api/health" 2>/dev/null || true)"
    [ "$code" = "200" ] && break; sleep 5
  done
  gate "5" "http=$code" "http=200"
}

# ───────────────────────────────────────────────────────────────────────────────
faz6_koruma() {
  say "FAZ 6 — donanım koruma + artık temizliği"
  local tw; tw="$(python3 -c "
import base64,pathlib
print(base64.b64encode(pathlib.Path('$(dirname "$0")/thermal-watch.ps1').read_bytes()).decode())")"
  psrun <<PSEOF 2>&1 | grep -viE "CLIXML|^<Objs|RefId=" | tail -5
[IO.File]::WriteAllBytes("C:\\ecy\\worker\\thermal-watch.ps1",[Convert]::FromBase64String("$tw"))
\$a=New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\\ecy\\worker\\thermal-watch.ps1"
\$t=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
\$p=New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "ecy-thermal-watch" -Action \$a -Trigger \$t -Principal \$p -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)) -Force | Out-Null
Start-ScheduledTask -TaskName "ecy-thermal-watch"; Start-Sleep -Seconds 12
# artik temizligi (6.4)
\$freed=0
Get-ChildItem "C:\\ecy\\tmp",\$env:TEMP -File -EA SilentlyContinue | Where-Object { \$_.Length -gt 50MB } | ForEach-Object { \$freed+=\$_.Length; Remove-Item \$_.FullName -Force -EA SilentlyContinue }
Write-Host ("SILINEN_MB=" + [math]::Round(\$freed/1MB,0))
Write-Host ("DISK_FREE_GB=" + [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace/1GB,1))
Get-Content "C:\\ecy\\worker\\thermal.log" -Tail 1 -EA SilentlyContinue | ForEach-Object { Write-Host ("THERMAL: " + \$_) }
PSEOF
  gate "6" "$(psrun <<<'Get-Content "C:\ecy\worker\thermal.log" -Tail 1 -EA SilentlyContinue' 2>&1 | grep -o "durum=[A-Z-]*" | tail -1)" "durum=(OK|UYARI)"
}

# ───────────────────────────────────────────────────────────────────────────────
main() {
  echo "provision-worker → ip=$WORKER_IP alias=$ALIAS user=$SSH_USER name=$NEW_NAME from=$FROM"
  [ "$DRY" = 1 ] && { faz0_blok; echo; echo "(--dry-run: yalnız Faz 0 bloğu üretildi)"; exit 0; }
  if ! skip 0; then
    if ! faz0_kapi 2>/dev/null; then faz0_blok; echo; bad "Faz 0 tamamlanmadı — blok çalıştırıldıktan sonra: --from 1"; exit 1; fi
    ok "Faz 0 zaten tamam"
  fi
  skip 1 || faz1_envanter || exit 1
  skip 2 || faz2_kok      || exit 1
  skip 3 || faz3_gpu      || exit 1
  skip 3 || faz3b_modeller|| exit 1
  skip 4 || faz4_wsl      || exit 1
  skip 5 || faz5_servis   || exit 1
  skip 6 || faz6_koruma   || exit 1
  say "TAMAM — tüm kapılar yeşil"
  echo "   ssh $ALIAS                      → yönetim"
  echo "   http://$WORKER_IP:11434         → Ollama (inference)"
  echo "   http://$WORKER_IP:8090          → ollamas worker (dispatch)"
  echo "   C:\\ecy  ·  /opt/ecy             → tek kök klasörler"
}
main
