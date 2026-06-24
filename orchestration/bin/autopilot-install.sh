#!/usr/bin/env bash
# vO-AUTO autopilot launchd kurulumu — BİR KERELİK (0-manuel'i aktive eder).
# Kullanım: bash orchestration/bin/autopilot-install.sh [load|unload|status]
set -euo pipefail

# vO16: path script-konumundan DİNAMİK (entegre-tree veya worktree — portable; silinen-worktree-ref yok).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.ollamas.orchestration.autopilot"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ACTION="${1:-load}"

case "$ACTION" in
  load)
    # vO16: plist DİNAMİK üretilir (derived path — entegre-tree/worktree portable; statik-stale-plist yerine).
    ORCH_ROOT="$(dirname "$SCRIPT_DIR")"   # .../orchestration
    WT="$(dirname "$ORCH_ROOT")"           # entegre-tree kökü (= ANCHOR)
    # tsx shebang `env node` launchd'nin minimal PATH'inde çözülmez (mise/nvm/brew node) → exit 127.
    # node dizinini dinamik türet + plist EnvironmentVariables PATH'ine enjekte et (portable; sabit-path yok).
    NODE_DIR="$(dirname "$(command -v node)")"
    cat > "$DEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${WT}/node_modules/.bin/tsx</string>
    <string>${SCRIPT_DIR}/autopilot.ts</string>
    <string>--heal</string>
    <string>--quiet</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${NODE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>WorkingDirectory</key><string>${WT}</string>
  <key>WatchPaths</key><array><string>${HOME}/.llm-mission-control</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${ORCH_ROOT}/autopilot.out.log</string>
  <key>StandardErrorPath</key><string>${ORCH_ROOT}/autopilot.err.log</string>
</dict>
</plist>
PLIST
    plutil -lint "$DEST"                               # sözdizimi doğrula
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
