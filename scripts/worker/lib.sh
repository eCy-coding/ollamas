#!/usr/bin/env bash
# lib.sh — worker script'lerinin ortak taşıyıcısı.
#
# K2 DERSİ (bu oturumda ölçülerek öğrenildi): PowerShell'i SSH üzerinden düz metin olarak
# geçirmek güvenilmez — tırnaklar, `$_`, `.*` ve Türkçe karakterler kabuk/aktarım katmanlarında
# bozulur. Tek güvenli taşıyıcı base64'tür (UTF-16LE, PowerShell -EncodedCommand biçimi).
# Alfabe yalnız A-Za-z0-9+/= içerir, hiçbir katman bozamaz.
set -uo pipefail

WORKER_SSH_HOST="${WORKER_SSH_HOST:-rtx}"

# psrun <<'EOF' ... EOF  → stdin'deki PowerShell'i base64'leyip uzakta çalıştırır, çıktıyı basar.
psrun() {
  local b64
  b64="$(python3 -c "import base64,sys; print(base64.b64encode(sys.stdin.read().encode('utf-16-le')).decode())")"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$WORKER_SSH_HOST" \
      "powershell -NoProfile -NonInteractive -EncodedCommand $b64"
}

# psjson — psrun gibi ama çıktıdaki son JSON nesnesini süzer (PowerShell uyarı satırlarını atar).
psjson() {
  psrun | grep -o '{.*}' | tail -1
}

# wslrun <<'EOF' ... EOF → WSL2 Ubuntu içinde bash çalıştırır (base64 ile, aynı gerekçe).
wslrun() {
  local b64
  b64="$(base64 | tr -d '\n')"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$WORKER_SSH_HOST" \
      "wsl -d Ubuntu -u root -- bash -c \"echo $b64 | base64 -d | bash\""
}
