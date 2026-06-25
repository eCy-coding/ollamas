#!/usr/bin/env bash
# build-plugin.sh — assemble a portable plugin bundle FROM the authored .claude/ sources.
# Single-source: .claude/ is authored; dist-plugin/ is generated (gitignore it).
# Run: bash .claude/build-plugin.sh   then  /plugin marketplace add ./.claude-plugin
# then /plugin install ollamas-harness@ollamas-marketplace
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
OUT="dist-plugin/ollamas-harness"
echo "▶ building $OUT from .claude/ + project root"

rm -rf "$OUT"; mkdir -p "$OUT/.claude-plugin" "$OUT/hooks" "$OUT/agents" "$OUT/commands"

cp .claude-plugin/plugin.json "$OUT/.claude-plugin/plugin.json"
cp .claude/hooks/*.mjs "$OUT/hooks/" 2>/dev/null
cp .claude/hooks/pre-commit "$OUT/hooks/" 2>/dev/null
cp .claude/statusline.mjs "$OUT/" 2>/dev/null
cp .claude/agents/*.md "$OUT/agents/" 2>/dev/null
cp .claude/commands/*.md "$OUT/commands/" 2>/dev/null
[ -f .mcp.json ] && cp .mcp.json "$OUT/.mcp.json"
[ -f .lsp.json ] && cp .lsp.json "$OUT/.lsp.json"

# Generate plugin hooks.json (paths relative to ${CLAUDE_PLUGIN_ROOT}).
node .claude/merge-settings.mjs >/tmp/_merged.json 2>/dev/null
node -e '
  const fs=require("fs"); const m=JSON.parse(fs.readFileSync("/tmp/_merged.json","utf8"));
  const root="${CLAUDE_PLUGIN_ROOT}";
  const fix=(arr)=>JSON.parse(JSON.stringify(arr).replace(/node [^"]*\/\.claude\/hooks\//g, `node ${root}/hooks/`));
  const hooks={}; for(const k of ["PreToolUse","PostToolUse","PreCompact","Stop","PostToolUseFailure","SubagentStop","SessionEnd","Notification"]) if(m.hooks[k]) hooks[k]=fix(m.hooks[k]);
  fs.writeFileSync(process.argv[1], JSON.stringify({hooks},null,2)+"\n");
' "$OUT/hooks/hooks.json"

echo "  ✓ bundle ready: $OUT"
echo "  files: $(find "$OUT" -type f | wc -l | tr -d " ")"
echo "  validate: claude plugin validate $OUT --strict"
echo "  install:  /plugin marketplace add ./.claude-plugin  →  /plugin install ollamas-harness@ollamas-marketplace"
