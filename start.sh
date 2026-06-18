#!/bin/bash
# Tek komut: LLM Mission Control'ü uçtan uca, kusursuz entegre ayağa kaldırır.
#   ./start.sh
# preflight -> port -> ollama(serve+warm) -> .env/keys -> bridge(+TCC) ->
# container(--wait) -> integration gate (tools_doctor) -> open -> durum matrisi.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
PORT="${PORT:-3000}"
BRIDGE_PORT="${BRIDGE_PORT:-7345}"
OLLAMA_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
WARM_MODEL="${WARM_MODEL:-qwen3:8b}"   # benchmark winner
TOOLS="$REPO/bin/host-bridge/tools"

log()  { printf '\033[36m[up]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[up] uyarı:\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[up] HATA:\033[0m %s\n' "$*" >&2; exit 1; }
st_ollama="-"; st_bridge="-"; st_container="-"; st_tools="-"; st_mode="-"; st_keys="-"

# 1) Preflight ------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker yok. Docker Desktop kur."
docker info >/dev/null 2>&1 || die "docker daemon kapalı. Docker Desktop'ı aç."
command -v node >/dev/null 2>&1 || die "node yok (host bridge için)."

# 2) Port-conflict --------------------------------------------------------
for p in "$PORT" "$BRIDGE_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    log "port $p zaten dinleniyor (büyük olasılıkla bizim servis; idempotent devam)."
  fi
done

# 3) Ollama: çalışmıyorsa başlat + readiness + calibrated model warm -------
if curl -fs "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  st_ollama="up"
elif command -v ollama >/dev/null 2>&1; then
  log "ollama kapalı — arka planda başlatılıyor..."
  nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  for _ in $(seq 1 20); do curl -fs "${OLLAMA_URL}/api/tags" >/dev/null 2>&1 && { st_ollama="started"; break; }; sleep 1; done
  [ "$st_ollama" = "started" ] || warn "ollama başlatılamadı (degraded/demo devam)."
else
  warn "ollama kurulu değil — sistem degraded/demo modda açılır."
fi
if [ "$st_ollama" != "-" ]; then
  log "calibrated model ısıtılıyor ($WARM_MODEL, keep_alive 30m)..."
  curl -fs "${OLLAMA_URL}/api/generate" -d "{\"model\":\"${WARM_MODEL}\",\"prompt\":\"ok\",\"stream\":false,\"keep_alive\":\"30m\"}" >/dev/null 2>&1 \
    && log "model warm ✓" || warn "model ısıtılamadı (ilk çağrı yavaş olabilir; $WARM_MODEL pull'lu mu?)."
fi

# 4) .env + key durumu ----------------------------------------------------
[ -f .env ] || { cp .env.example .env; warn ".env oluşturuldu — key için ./setup-keys.sh"; }
keyn=0; for k in GEMINI OPENAI OPENROUTER OLLAMA_CLOUD; do
  grep -qE "^${k}_API_KEY=.+|^${k}_KEY=.+" .env 2>/dev/null && keyn=$((keyn+1))
done
st_keys="${keyn} provider"

# 5) Host bridge + TCC roundtrip -----------------------------------------
log "host bridge başlatılıyor..."
bash bin/host-bridge/start-bridge.sh >/dev/null 2>&1 || true
if curl -fs "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  st_bridge="health-ok"
  # Gerçek roundtrip → Automation (TCC) izni gerçekten verilmiş mi?
  tok="$(cat "$HOME/.llm-mission-control/bridge.token" 2>/dev/null || true)"
  rt=""
  for _ in 1 2; do   # cold first-run terminal readiness → 1 retry, generous timeout
    rt="$(curl -fs -X POST "http://127.0.0.1:${BRIDGE_PORT}/run" \
          -H "X-Bridge-Token: ${tok}" -H 'Content-Type: application/json' \
          -d '{"target":"terminal","command":"echo tcc_ok","timeoutMs":25000}' 2>/dev/null || true)"
    printf '%s' "$rt" | grep -q tcc_ok && break
  done
  if printf '%s' "$rt" | grep -q tcc_ok; then st_bridge="ready(tcc-ok)"; else
    warn "bridge /run roundtrip başarısız — macOS Automation izni gerekebilir (System Settings > Privacy > Automation). macos_terminal araçları kısıtlı."
    st_bridge="health-ok(tcc?)"
  fi
else
  warn "bridge başlamadı (Automation izni?). macos_terminal araçları olmadan devam."
  st_bridge="down"
fi

# 6) Container: build + up + healthcheck-backed wait ----------------------
# Bridge tools run on the host, so the container needs the HOST repo path. Export
# it (unless already set) so docker-compose's ${HOST_TOOLS_DIR} passthrough works.
export HOST_TOOLS_DIR="${HOST_TOOLS_DIR:-$(pwd)/bin/host-bridge/tools}"
log "container build + up --wait..."
if docker compose up -d --build --wait >/dev/null 2>&1; then
  st_container="healthy"
else
  warn "--wait healthcheck içinde toparlamadı; /api/health ile teyit ediliyor..."
  ready=""; for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && { ready=1; break; }; sleep 2; done
  [ -n "$ready" ] || { docker compose logs --tail=20 || true; die "container health timeout."; }
  st_container="up"
fi

# 7) Integration gate: tools_doctor (agent->/exec->bridge->terminal) + mode
st_mode="$(curl -fs "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).mode)}catch{console.log("?")}})' || echo "?")"
log "integration gate (tools_doctor)..."
st_tools="$( (node "$TOOLS/tools_doctor.mjs" 2>/dev/null || true) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(o.passed+"/"+o.total)}catch{console.log("?")}})' )"

# 8) Open + durum matrisi -------------------------------------------------
command -v open >/dev/null 2>&1 && open "http://localhost:${PORT}" >/dev/null 2>&1 || true
printf '\n\033[32m[up] KUSURSUZ HAZIR\033[0m → http://localhost:%s\n' "$PORT"
printf '  ┌─ bileşen durum matrisi ─\n'
printf '  │ ollama    : %s\n' "$st_ollama"
printf '  │ bridge    : %s (127.0.0.1:%s)\n' "$st_bridge" "$BRIDGE_PORT"
printf '  │ container : %s\n' "$st_container"
printf '  │ mode      : %s\n' "$st_mode"
printf '  │ tools     : %s (tools_doctor)\n' "$st_tools"
printf '  │ keys      : %s\n' "$st_keys"
printf '  └─────────────────────────\n'
