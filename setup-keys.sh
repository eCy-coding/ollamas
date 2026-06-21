#!/bin/bash
# LLM Mission Control — interactive API key runner
# Calistir: ./setup-keys.sh
# Her key sorulur. Yapistir + Enter. Bos Enter = atla (mevcut deger korunur).
set -euo pipefail
DRY_RUN="${DRY_RUN:-0}"

cd "$(dirname "$0")"
ENV_FILE=".env"

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] would prompt for API keys, write $ENV_FILE, then docker compose up -d + health poll. Skipping (no side effects)."
  exit 0
fi

[ -f "$ENV_FILE" ] || touch "$ENV_FILE"

# .env'de bir anahtari guncelle/ekle (deger bos ise dokunma)
set_key() {
  local name="$1" val="$2"
  [ -z "$val" ] && return 0
  if grep -qE "^${name}=" "$ENV_FILE"; then
    # macOS + Linux uyumlu in-place: gecici dosya
    grep -vE "^${name}=" "$ENV_FILE" >"$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$name" "$val" >>"$ENV_FILE"
  echo "  [+] $name set"
}

prompt_key() {
  local label="$1" name="$2" val
  printf '  %s (%s): ' "$label" "$name"
  read -rs val
  echo
  set_key "$name" "$val"
}

echo "==================================================="
echo " API Key Runner — yapistir + Enter (bos = atla)"
echo "==================================================="
prompt_key "Gemini" GEMINI_API_KEY
prompt_key "Anthropic" ANTHROPIC_API_KEY
prompt_key "OpenAI" OPENAI_API_KEY
prompt_key "OpenRouter" OPENROUTER_API_KEY
prompt_key "Ollama Cloud" OLLAMA_CLOUD_KEY

echo "---------------------------------------------------"
echo "[*] Container guncelleniyor (docker compose up -d)..."
docker compose up -d

echo "[*] Health bekleniyor..."
for _ in $(seq 1 20); do
  curl -fs http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
  sleep 2
done

echo "[*] Yuklenen key maskeleri:"
curl -fs http://127.0.0.1:3000/api/keys 2>/dev/null || echo "  (health gelmedi, 'docker compose logs' ile bak)"
echo
echo "[+] Bitti. Panel: http://localhost:3000"
