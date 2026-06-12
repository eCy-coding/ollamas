#!/bin/bash
# LLM Mission Control setup assistant

set -e

# Error handler
failure_handler() {
    echo "==================================================="
    echo "[-] FAILED: An error occurred during setup execution."
    echo "    Check command output logs above for diagnostics."
    echo "==================================================="
    exit 1
}
trap 'failure_handler' ERR

echo "==================================================="
echo "Initializing LLM Mission Control Setup Assistant..."
echo "==================================================="

# 1. Check Docker state
if ! command -v docker &> /dev/null; then
    echo "[-] Warning: Docker engine is a missing dependency on the host platform."
    echo "[*] Fallback: Beginning direct local workspace booting instead..."
    trap - ERR # Disable handler for local fallback run
    npm install || { echo "[-] local npm install failed"; exit 1; }
    npm run dev || { echo "[-] local dev startup failed"; exit 1; }
    exit 0
fi

# 2. Compile Docker compose stack
echo "[+] Docker verified on system. Starting building processes..."
docker compose build

# 3. Mount and spin daemon container
echo "[+] Spin up container service..."
docker compose up -d

# 4. Verify container is active and responding
echo "[+] Verifying system health and container readiness..."
sleep 2

MAX_RETRIES=10
RETRY_DELAY=2
SERVER_READY=false

for ((i=1; i<=MAX_RETRIES; i++)); do
    if command -v curl &> /dev/null; then
        if curl -fs http://localhost:3000/api/health &> /dev/null; then
            SERVER_READY=true
            break
        fi
    else
        # If curl is missing on host, inspect docker ps status
        if [[ $(docker compose ps 2>/dev/null | grep -i "running") || $(docker compose ps 2>/dev/null | grep -i "up") ]]; then
            SERVER_READY=true
            break
        fi
    fi
    echo "    [*] System starting... (attempt $i/$MAX_RETRIES)"
    sleep $RETRY_DELAY
done

if [ "$SERVER_READY" = false ]; then
    echo "[-] Error: Connection checking failed. Container did not start up cleanly on port 3000."
    echo "    Run 'docker compose logs' to trace internal crashes."
    exit 1
fi

echo "==================================================="
echo "[+] SUCCESS: LLM Mission Control is now active!"
echo "    Web panel reachable at: http://localhost:3000"
echo "    Local DB mapped at: ~/.llm-mission-control/"
echo "==================================================="
