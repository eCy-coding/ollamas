#!/usr/bin/env bash
# vO-AUTO autopilot launchd kurulumu — BİR KERELİK (0-manuel'i aktive eder).
# Kullanım: bash orchestration/bin/autopilot-install.sh [load|unload|status]
set -euo pipefail

PLIST_SRC="/Users/emrecnyngmail.com/Desktop/ollamas-orchestration-wt/orchestration/bin/autopilot.plist"
LABEL="com.ollamas.orchestration.autopilot"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ACTION="${1:-load}"

case "$ACTION" in
  load)
    plutil -lint "$PLIST_SRC"                         # sözdizimi doğrula
    cp "$PLIST_SRC" "$DEST"
    launchctl unload "$DEST" 2>/dev/null || true       # idempotent
    launchctl load "$DEST"
    echo "✓ autopilot agent yüklendi: $LABEL"
    echo "  Tetik: bench değişimi (WatchPaths) + 30dk (StartInterval) + RunAtLoad."
    echo "  Log: orchestration/autopilot.{out,err}.log · Durdur: bash $0 unload"
    ;;
  unload)
    launchctl unload "$DEST" 2>/dev/null || true
    rm -f "$DEST"
    echo "✓ autopilot agent kaldırıldı."
    ;;
  status)
    launchctl list | grep "$LABEL" || echo "yüklü değil"
    ;;
  *)
    echo "kullanım: $0 [load|unload|status]"; exit 1
    ;;
esac
