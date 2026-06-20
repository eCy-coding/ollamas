#!/bin/bash
# LLM Mission Control teardown assistant

set -euo pipefail
# DRY_RUN=1 → no side effects; destructive ops (docker down -v, rm -rf, purge
# prompt) are echoed as [DRY] instead of executed (prova/test).
DRY_RUN="${DRY_RUN:-0}"

failure_handler() {
  echo "==============================================="
  echo "[-] FAILED: Teardown encountered unexpected errors (line $LINENO)."
  echo "==============================================="
  exit 1
}
trap 'failure_handler' ERR

echo "==============================================="
echo "LLM Mission Control Uninstallation Assistant..."
echo "==============================================="

run() { if [ "$DRY_RUN" = "1" ]; then printf '[DRY] would run: %s\n' "$*"; else "$@"; fi; }

# Remove the host terminal-bridge LaunchAgent (v16) before any data purge.
if command -v launchctl &>/dev/null; then
  LABEL="com.missioncontrol.terminalbridge"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  echo "[+] Removing host bridge LaunchAgent..."
  run launchctl bootout "gui/$(id -u)/$LABEL" || true
  run rm -f "$PLIST"
fi

if command -v docker &>/dev/null; then
  echo "[+] Stopping containers and tearing down network stacks..."
  if [ "$DRY_RUN" = "1" ]; then echo "[DRY] would run: docker compose down -v"; else docker compose down -v; fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] would prompt to purge ~/.llm-mission-control (skipped in dry-run)"
else
  # Disable exit on error for reading input confirmation comfortably
  set +e
  read -rp "[?] Do you want to purge local key databases at ~/.llm-mission-control (y/N)? " answer
  set -e
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    echo "[+] Purging local data paths completely..."
    rm -rf ~/.llm-mission-control
    echo "[+] Local databases deleted."
  else
    echo "[*] Statically preserving ~/.llm-mission-control configuration caches (safe)."
  fi
fi

echo "==============================================="
echo "[+] SUCCESS: LLM Mission Control uninstalled."
echo "==============================================="
