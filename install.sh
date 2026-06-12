#!/bin/bash
# LLM Mission Control setup assistant

echo "==================================================="
echo "Initializing LLM Mission Control Setup Assistant..."
echo "==================================================="

# 1. Check Docker state
if ! command -v docker &> /dev/null; then
    echo "[-] Error: Docker engine represents missing dependency on host platform."
    echo "[*] Fallback: Beginning direct npm workspace booting instead..."
    npm install
    npm run dev
    exit 0
fi

# 2. Compile Docker compose stack
echo "[+] Docker verified on system. Starting building processes..."
docker compose build

# 3. Mount and spin daemon container
echo "[+] Spin up container service..."
docker compose up -d

echo "==================================================="
echo "[+] SUCCESS: LLM Mission Control is now active!"
echo "    Web panel reachable at: http://localhost:3000"
echo "    Local DB mapped at: ~/.llm-mission-control/"
echo "==================================================="
