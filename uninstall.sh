#!/bin/bash
# LLM Mission Control teardown assistant

echo "==============================================="
echo "LLM Mission Control Uninstallation Assistant..."
echo "==============================================="

if command -v docker &> /dev/null; then
    echo "[+] Stopping containers and tearing down network stacks..."
    docker compose down -v
fi

read -p "[?] Do you want to purge local key databases at ~/.llm-mission-control (y/N)? " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
    echo "[+] Purging local data paths completely..."
    rm -rf ~/.llm-mission-control
    echo "[+] Local databases deleted."
else
    echo "[*] Statically preserving ~/.llm-mission-control configuration caches (safe)."
fi

echo "==============================================="
echo "[+] SUCCESS: LLM Mission Control uninstalled."
echo "==============================================="
