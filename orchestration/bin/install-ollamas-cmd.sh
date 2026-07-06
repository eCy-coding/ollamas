#!/usr/bin/env bash
# orchestration/bin/install-ollamas-cmd.sh — register the global `ollamas` command (JUstdoit STEP 10).
#
# OUTWARD-FACING / SYSTEM MUTATION → operator (T0) decision. This installs the launcher onto PATH and adds a
# shell alias. It is idempotent and reversible (`--uninstall`). It is NOT run automatically by anything.
#
#   bash orchestration/bin/install-ollamas-cmd.sh            # symlink + ~/.zshrc alias
#   bash orchestration/bin/install-ollamas-cmd.sh --print    # show what it WOULD do, mutate nothing
#   bash orchestration/bin/install-ollamas-cmd.sh --uninstall # remove symlink + alias block (+ daemon)
#   bash orchestration/bin/install-ollamas-cmd.sh --daemon     # load the persistent conductor LaunchAgent
#   bash orchestration/bin/install-ollamas-cmd.sh --daemon-off # unload it
#   bash orchestration/bin/install-ollamas-cmd.sh --full       # command + daemon in one shot (turnkey)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
CONDUCTOR="$HERE/orchestra.ts"
DAEMON_LABEL="com.ollamas.orchestra.conductor"
DAEMON_PLIST="$HOME/Library/LaunchAgents/$DAEMON_LABEL.plist"
LAUNCHER="$HERE/ollamas-launch.sh"
MARK_BEGIN="# >>> ollamas command (orchestra) >>>"
MARK_END="# <<< ollamas command (orchestra) <<<"
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
# Prefer a user-writable PATH dir; fall back to /usr/local/bin (may need sudo).
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then TARGET_DIR="$HOME/.local/bin"; else TARGET_DIR="/usr/local/bin"; fi
TARGET="$TARGET_DIR/ollamas"
MODE="${1:-install}"

alias_block() {
  printf '%s\n' "$MARK_BEGIN"
  printf 'alias ollamas="bash %q"\n' "$LAUNCHER"
  printf '%s\n' "$MARK_END"
}

# Generate the persistent conductor LaunchAgent (KeepAlive → survives crash/close/reboot). Mirrors
# orchestration/bin/autopilot.plist including the EnvironmentVariables/PATH — launchd runs with a minimal
# PATH that omits node (mise/nvm/homebrew), so `tsx`'s `#!/usr/bin/env node` shebang would exit 127 without it.
write_daemon_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.ollamas"
  local node_dir; node_dir="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)")"
  local daemon_path="$node_dir:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  cat > "$DAEMON_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$DAEMON_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TSX</string>
    <string>$CONDUCTOR</string>
    <string>--watch</string>
    <string>600</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$daemon_path</string>
    <!-- Pin the conductor to the warm champion (qwen3:8b, benchmarked cheapest-100%). A 30b evicts between
         600s ticks and cold-loads > probe budget → false-down failover thrash; the 8b stays warm → stable. -->
    <key>ORCHESTRA_CONDUCTOR</key><string>${ORCHESTRA_DAEMON_CONDUCTOR:-qwen3:8b}</string>
  </dict>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$HOME/.ollamas/conductor.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.ollamas/conductor.err.log</string>
</dict>
</plist>
PLIST
}
daemon_load() {
  write_daemon_plist
  plutil -lint "$DAEMON_PLIST" >/dev/null
  launchctl unload "$DAEMON_PLIST" 2>/dev/null || true
  launchctl load -w "$DAEMON_PLIST"
  echo "✓ conductor daemon loaded ($DAEMON_LABEL) — KeepAlive, survives reboot · logs ~/.ollamas/conductor.{out,err}.log"
}
daemon_off() {
  launchctl unload "$DAEMON_PLIST" 2>/dev/null || true
  [ -f "$DAEMON_PLIST" ] && rm -f "$DAEMON_PLIST" && echo "✓ conductor daemon unloaded + plist removed" || echo "conductor daemon not present"
}
install_cmd() {
  chmod +x "$LAUNCHER" "$HERE/ollamas-boot.sh"
  mkdir -p "$TARGET_DIR"
  ln -sf "$LAUNCHER" "$TARGET" && echo "✓ symlink $TARGET -> $LAUNCHER"
  if [ -f "$ZSHRC" ] && grep -qF "$MARK_BEGIN" "$ZSHRC"; then
    echo "✓ ~/.zshrc alias already present (idempotent)"
  else
    { echo ""; alias_block; } >> "$ZSHRC"
    echo "✓ appended alias block to $ZSHRC"
  fi
}

case "$MODE" in
  --print)
    echo "launcher : $LAUNCHER"
    echo "symlink  : $TARGET -> $LAUNCHER"
    echo "zshrc    : append idempotent alias block to $ZSHRC"
    echo "daemon   : $DAEMON_PLIST (--daemon to load: KeepAlive conductor --watch)"
    alias_block
    ;;
  --uninstall)
    daemon_off
    [ -L "$TARGET" ] && rm -f "$TARGET" && echo "removed symlink $TARGET" || true
    if [ -f "$ZSHRC" ]; then
      /usr/bin/sed -i '' "/$(printf '%s' "$MARK_BEGIN" | sed 's/[.[\*^$()+?{|]/\\&/g')/,/$(printf '%s' "$MARK_END" | sed 's/[.[\*^$()+?{|]/\\&/g')/d" "$ZSHRC" 2>/dev/null || true
      echo "removed alias block from $ZSHRC"
    fi
    ;;
  --daemon)     daemon_load ;;
  --daemon-off) daemon_off ;;
  --full)
    install_cmd
    daemon_load
    echo "→ turnkey done: yeni terminal (veya 'source $ZSHRC') → 'ollamas'. Şef daemon zaten canlı + kalıcı."
    ;;
  install|"")
    install_cmd
    echo "→ open a new terminal (or 'source $ZSHRC'), then type: ollamas   ·   kalıcı şef için: $0 --daemon"
    ;;
  *) echo "usage: $0 [--print|--uninstall|--daemon|--daemon-off|--full]"; exit 2 ;;
esac
