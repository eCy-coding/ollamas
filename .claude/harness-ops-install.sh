#!/usr/bin/env bash
# Install/uninstall the autonomous harness-ops launchd agent (hourly READ-ONLY health).
# Run from a real Terminal.app (GUI session) so launchctl bootstrap works.
#   bash .claude/harness-ops-install.sh load | unload | status
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.ollamas.harness.ops"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || echo /usr/local/bin/node)"

case "${1:-load}" in
  load)
    mkdir -p "$HOME/Library/LaunchAgents"
    sed -e "s#/usr/local/bin/node#$NODE#" \
        -e "s#HARNESS_OPS_PATH#$ROOT/.claude/harness-ops.mjs#" \
        -e "s#HARNESS_ROOT#$ROOT#g" "$ROOT/.claude/harness-ops.plist" > "$PLIST"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && launchctl list | grep -q "$LABEL"; then
      echo "✓ harness-ops agent loaded (hourly READ-ONLY health → .claude/harness-ops-report.md)"
    else
      echo "⚠ bootstrap failed (run from real Terminal.app GUI session). plist written: $PLIST"
    fi ;;
  unload) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "✓ unloaded" || echo "not loaded" ;;
  status) launchctl list | grep "$LABEL" || echo "not loaded" ;;
  *) echo "usage: harness-ops-install.sh load|unload|status"; exit 1 ;;
esac
