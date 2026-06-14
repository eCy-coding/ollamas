#!/bin/bash
# LLM Mission Control Joiner (AC-9)
echo "[INFO] Preparing LLM Mission Control Cluster Node..."
if ! command -v ollama &> /dev/null; then
    echo "[-] Error: Ollama not found. Install it first."
    exit 1
fi

echo "--- TERMS OF SERVICE ---"
echo "By joining, you allow the node to run sandboxed inference tasks."
echo "You can leave at any time with one click in the cockpit."
read -p "Do you accept these terms? (y/n): " response
if [[ "$response" != "y" ]]; then
    echo "[-] Aborted."
    exit 0
fi

echo "[+] Starting daemon..."
# Stub for the real binary:
# ./bin/hardware_orchestrator --daemon --ed25519-key $(cat ~/.oid)
echo "[+] Node joined."
