#!/usr/bin/env bash
# apply-harness.sh — ONE operator command to finish harness activation.
# Run this YOURSELF (Claude cannot self-modify startup config or bootstrap launchd):
#     bash .claude/apply-harness.sh
# Idempotent: safe to re-run. Best run from Terminal.app so launchd bootstrap works.
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1   # repo root
CL=".claude"
echo "═══ ollamas harness apply ═══"

# 1) settings.json — additive merge (permissions + statusLine + PreToolUse hooks)
echo "▶ settings.json merge"
if node "$CL/merge-settings.mjs" --write 2>&1; then echo "  done"; else echo "  ✗ merge failed"; exit 1; fi
node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))' \
  && echo "  ✓ settings.json valid JSON" || { echo "  ✗ invalid JSON — restoring backup"; cp "$CL/settings.json.bak" "$CL/settings.json"; exit 1; }

# 2) git pre-commit gate (heavy typecheck+lint+test)
echo "▶ git pre-commit gate"
if [ -d .git ]; then
  cp "$CL/hooks/pre-commit" .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit \
    && echo "  ✓ installed .git/hooks/pre-commit"
else echo "  – no .git dir, skipped"; fi

# 3) launchd autopilot (best-effort; EIO ⇒ Terminal.app instruction)
echo "▶ launchd autopilot"
if [ -f orchestration/bin/autopilot-install.sh ]; then
  if bash orchestration/bin/autopilot-install.sh load >/tmp/ap-load.log 2>&1 \
     && launchctl list 2>/dev/null | grep -q ollamas.orchestration.autopilot; then
    echo "  ✓ launchd agent loaded"
  else
    echo "  ⚠ launchd load failed (EIO/GUI-session). Run this from a real Terminal.app:"
    echo "      cd $(pwd) && bash orchestration/bin/autopilot-install.sh load"
  fi
else echo "  – installer missing, skipped"; fi

# 4) LSP binary (inline TS diagnostics) — optional global install
echo "▶ LSP binary"
if command -v typescript-language-server >/dev/null 2>&1; then echo "  ✓ typescript-language-server present"; else
  echo "  ⚠ not installed — for inline TS diagnostics run: npm i -g typescript-language-server typescript"; fi

# 5) verify — settings schema + full golden hook suite + statusline
echo "▶ verify"
if node "$CL/validate-settings.mjs" 2>&1; then echo "  ✓ settings schema valid"; else echo "  ✗ settings schema INVALID (see above)"; fi
if bash "$CL/hooks/test-hooks.sh" >/tmp/hook-suite.log 2>&1; then
  echo "  ✓ hook suite: $(grep RESULT /tmp/hook-suite.log)"
else echo "  ✗ hook suite FAILED:"; tail -6 /tmp/hook-suite.log; fi
echo '{"model":{"display_name":"Opus 4.8"},"workspace":{"current_dir":"'"$(pwd)"'"}}' | node "$CL/statusline.mjs" >/dev/null 2>&1 \
  && echo "  ✓ statusline renders" || echo "  ✗ statusline error"

echo "═══ done — restart this Claude tab (or /clear) so new settings load ═══"
echo "   optional: bash .claude/build-plugin.sh  → portable plugin bundle"
