#!/usr/bin/env bash
# orchestration/bin/install-ollamas-cmd.sh — register the global `ollamas` command (JUstdoit STEP 10).
#
# OUTWARD-FACING / SYSTEM MUTATION → operator (T0) decision. This installs the launcher onto PATH and adds a
# shell alias. It is idempotent and reversible (`--uninstall`). It is NOT run automatically by anything.
#
#   bash orchestration/bin/install-ollamas-cmd.sh            # symlink + ~/.zshrc alias
#   bash orchestration/bin/install-ollamas-cmd.sh --print    # show what it WOULD do, mutate nothing
#   bash orchestration/bin/install-ollamas-cmd.sh --uninstall # remove symlink + alias block
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

case "$MODE" in
  --print)
    echo "launcher : $LAUNCHER"
    echo "symlink  : $TARGET -> $LAUNCHER"
    echo "zshrc    : append idempotent alias block to $ZSHRC"
    alias_block
    ;;
  --uninstall)
    [ -L "$TARGET" ] && rm -f "$TARGET" && echo "removed symlink $TARGET" || true
    if [ -f "$ZSHRC" ]; then
      /usr/bin/sed -i '' "/$(printf '%s' "$MARK_BEGIN" | sed 's/[.[\*^$()+?{|]/\\&/g')/,/$(printf '%s' "$MARK_END" | sed 's/[.[\*^$()+?{|]/\\&/g')/d" "$ZSHRC" 2>/dev/null || true
      echo "removed alias block from $ZSHRC"
    fi
    ;;
  install|"")
    chmod +x "$LAUNCHER" "$HERE/ollamas-boot.sh"
    mkdir -p "$TARGET_DIR"
    ln -sf "$LAUNCHER" "$TARGET" && echo "✓ symlink $TARGET -> $LAUNCHER"
    if [ -f "$ZSHRC" ] && grep -qF "$MARK_BEGIN" "$ZSHRC"; then
      echo "✓ ~/.zshrc alias already present (idempotent)"
    else
      { echo ""; alias_block; } >> "$ZSHRC"
      echo "✓ appended alias block to $ZSHRC"
    fi
    echo "→ open a new terminal (or 'source $ZSHRC'), then type: ollamas"
    ;;
  *) echo "usage: $0 [--print|--uninstall]"; exit 2 ;;
esac
