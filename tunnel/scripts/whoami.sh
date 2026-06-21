#!/usr/bin/env bash
# Read-only self-state collector for the tunnel lane. Zero-dep (git/grep/node only).
# Output is consumed by TUNNEL_IDENTITY.md's render template so the "görevin nedir?"
# answer is ALWAYS live, never stale. Changes nothing on disk (Scope/observe-only).
set -uo pipefail
TUNNEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TUNNEL_DIR" || exit 1

echo "=== TUNNEL LANE SELF-REPORT (live) ==="
echo "ts: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "dir: $TUNNEL_DIR"
echo

# --- git: branch + recent commits (truth source for shipped work) ---
BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
echo "branch: $BRANCH"
case "$BRANCH" in
  feat/tunnel-v1 | integration/*) ;; # lane branch VEYA konsolide integration (meşru)
  *) echo "  ⚠️  branch feat/tunnel-v1|integration/* DEĞİL → hijack riski RISK-TUNNEL-001, doğrula" ;;
esac
echo "recent commits:"
git log --oneline -3 2>/dev/null | sed 's/^/  /'
echo

# --- shipped versions: ROADMAP rows marked ✅ DONE ---
echo "shipped (TUNNEL_ROADMAP.md ✅ DONE):"
grep -E '✅ DONE' TUNNEL_ROADMAP.md 2>/dev/null \
  | sed -E 's/^\| \*\*(vT[0-9]+)\*\* \| ([^|]+).*/  \1 — \2/' | sed 's/\*\*//g; s/[[:space:]]*$//'
SHIPPED_LAST="$(grep -E '✅ DONE' TUNNEL_ROADMAP.md 2>/dev/null | grep -oE 'vT[0-9]+' | sort -V | tail -1)"
echo "  → last shipped: ${SHIPPED_LAST:-none}"
echo

# --- NEXT version (heading '## vTN — NEXT' + its 'planned' table theme) ---
echo "next:"
NEXT_VER="$(grep -E '^## vT[0-9]+ .*NEXT' TUNNEL_ROADMAP.md 2>/dev/null | grep -oE 'vT[0-9]+' | head -1)"
echo "  version: ${NEXT_VER:-?}"
if [ -n "${NEXT_VER:-}" ]; then
  grep -E "^\| ${NEXT_VER} \|" TUNNEL_ROADMAP.md 2>/dev/null \
    | sed -E 's/^\| (vT[0-9]+) \| ([^|]+)\| ([^|]+).*/  tema: \2·\3/' | sed 's/\*\*//g; s/[[:space:]]*$//'
fi
echo

# --- VERSION drift guard: compare VERSION major vs last-shipped vT number (no hardcode) ---
VERFILE="$(tr -d '[:space:]' < VERSION 2>/dev/null)"
echo "VERSION file: ${VERFILE:-?}"
VER_MAJOR="${VERFILE%%.*}"
SHIPPED_NUM="$(printf '%s' "${SHIPPED_LAST:-}" | grep -oE '[0-9]+')"
if [ -n "$SHIPPED_NUM" ] && [ "$VER_MAJOR" != "$SHIPPED_NUM" ]; then
  echo "  ⚠️  VERSION drift: dosya major=$VER_MAJOR ama ROADMAP son shipped=vT$SHIPPED_NUM → align et (doğruluk=git/ROADMAP)"
else
  echo "  ✓ VERSION aligned with last shipped (vT$SHIPPED_NUM)"
fi
echo

# --- test count (static approx over test files) ---
TESTS="$(grep -rE 'test\(' src --include='*.test.ts' 2>/dev/null | wc -l | tr -d ' ')"
echo "test count (src/**/*.test.ts, static approx): ${TESTS:-?}"
echo

# --- errors_registry size ---
if [ -f errors_registry.json ]; then
  RISKS="$(node --input-type=commonjs -e 'const j=require("./errors_registry.json");console.log((j.known_risks_preloaded?.length||0)+" preloaded-risk + "+(j.errors?.length||0)+" logged-err")' 2>/dev/null || echo '?')"
  echo "errors_registry: $RISKS"
  echo
fi

# --- ollamas project phase (graceful skip if core absent) ---
echo "ollamas project phase:"
OLLAMAS="$HOME/Desktop/ollamas"
if [ -f "$OLLAMAS/server.json" ]; then
  OV="$(node --input-type=commonjs -e 'console.log(require(process.argv[1]).version||"?")' "$OLLAMAS/server.json" 2>/dev/null || echo '?')"
  OB="$(git -C "$OLLAMAS" branch --show-current 2>/dev/null || echo '?')"
  echo "  core server.json: v${OV}  ·  active branch: ${OB}"
else
  echo "  (ollamas core ~/Desktop/ollamas bulunamadı — atlandı)"
fi
echo "=== END ==="
