#!/bin/bash
# Tek komut: LLM Mission Control'ü uçtan uca ayağa kaldırır (idempotent).
#   ./start.sh
# preflight -> .env -> host bridge -> container -> health -> verify -> open.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
PORT="${PORT:-3000}"
BRIDGE_PORT="${BRIDGE_PORT:-7345}"

log() { printf '\033[36m[up]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[up] uyarı:\033[0m %s\n' "$*"; }
die() { printf '\033[31m[up] HATA:\033[0m %s\n' "$*" >&2; exit 1; }

# 1) Preflight ------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker bulunamadı. Docker Desktop kur."
docker info >/dev/null 2>&1 || die "docker daemon kapalı. Docker Desktop'ı aç."
command -v node >/dev/null 2>&1 || die "node bulunamadı (host bridge için gerekli)."
if command -v ollama >/dev/null 2>&1 && curl -fs "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
  log "ollama çalışıyor (live mode)."
else
  warn "ollama erişilemez — sistem degraded/demo modda açılır. (live için: ollama serve)"
fi

# 2) .env -----------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env oluşturuldu (.env.example'dan). API key'leri doldurmak için: ./setup-keys.sh"
fi

# 3) Host bridge (idempotent — start-bridge.sh eski pid'i durdurur) -------
log "host terminal bridge başlatılıyor..."
bash bin/host-bridge/start-bridge.sh >/dev/null 2>&1 || true
if curl -fs "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  log "bridge ✓ (127.0.0.1:${BRIDGE_PORT})"
else
  warn "bridge başlamadı — ilk çalıştırmada macOS Automation izni gerekebilir (System Settings > Privacy > Automation). macos_terminal araçları olmadan devam ediliyor."
fi

# 4) Container ------------------------------------------------------------
log "container build + up (docker compose)..."
docker compose up -d --build >/dev/null 2>&1 || die "docker compose başarısız. 'docker compose logs' ile bak."

# 5) Health wait ----------------------------------------------------------
log "sağlık bekleniyor..."
ready=""
for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ -n "$ready" ] || { docker compose logs --tail=20 || true; die "health timeout (${PORT})."; }

# 6) Verify gates ---------------------------------------------------------
gates="$(curl -fs "http://127.0.0.1:${PORT}/api/selftest" 2>/dev/null | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  try { const o=JSON.parse(s); const v=Object.values(o);
    console.log(v.filter(x=>x.status==="PASS").length+"/"+v.length); }
  catch { console.log("?"); }
});' || echo "?")"
log "self-test gate: ${gates} PASS"

# 7) Open -----------------------------------------------------------------
command -v open >/dev/null 2>&1 && open "http://localhost:${PORT}" >/dev/null 2>&1 || true

# 8) Özet -----------------------------------------------------------------
printf '\033[32m[up] HAZIR\033[0m → http://localhost:%s  | bridge:%s | gate:%s\n' "$PORT" "$BRIDGE_PORT" "$gates"
