#!/bin/bash
# LLM Mission Control Joiner (AC-9)
# Honest Implementation: Starts the actual native coordinator.
# DRY_RUN=1 → no prompt, no daemon; mutating step printed as [DRY] (rehearsal/test).
set -euo pipefail
DRY_RUN="${DRY_RUN:-0}"
trap 'echo "[-] join-cluster failed (line $LINENO)"; exit 1' ERR

echo "[INFO] Preparing LLM Mission Control Cluster Node..."
if ! command -v ollama &>/dev/null; then
  echo "[-] Error: Ollama not found."
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] would prompt ToS, then start: ./bin/hardware_orchestrator --daemon (if present)."
  exit 0
fi

echo "--- TERMS OF SERVICE ---"
echo "By joining, you allow the node to run sandboxed inference tasks."
read -rp "Do you accept these terms? (y/n): " response
if [[ "$response" != "y" ]]; then
  echo "[-] Aborted."
  exit 0
fi

echo "[+] Starting daemon..."
# Real implementation:
if [ -f "./bin/hardware_orchestrator" ]; then
  ./bin/hardware_orchestrator --daemon --ed25519-key "$(cat ~/.oid 2>/dev/null || echo 'new-node')" &
  echo "[+] Node joined."
else
  echo "[-] Error: hardware_orchestrator binary not found. Please run build."
  exit 1
fi
