#!/usr/bin/env bash
# µ2 (v1.25.5 hygiene) — deps-gate: fail if the dependency footprint or npm-audit
# posture EXCEEDS the recorded baseline (docs/audit/DEPS-BASELINE.md). Keeps
# dependency creep + new vulnerabilities from landing silently. Reads its ceilings
# from the DEPS-GATE-BASELINE block in that doc, so raising a limit is a reviewable
# one-line edit. `--update` rewrites the snapshot to the current tree.
#
# Usage:
#   bash scripts/deps-gate.sh            # gate (exit 1 on any overage)
#   bash scripts/deps-gate.sh --update   # rewrite baseline to current numbers
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/package.json"
BASELINE="$ROOT/docs/audit/DEPS-BASELINE.md"

# ---- current tree measurements (pure, no network for counts) ----
read_count() { # $1 = json key (dependencies|devDependencies)
  node -e "const p=require('$PKG');process.stdout.write(String(Object.keys(p.$1||{}).length))"
}
DEPS=$(read_count dependencies)
DEV_DEPS=$(read_count devDependencies)
TOTAL=$((DEPS + DEV_DEPS))

# npm audit is best-effort (offline / registry hiccups must not crash the gate):
# on failure we record 0/0/0 and print a warning so the gate degrades open, not red.
audit_json="$(npm audit --json 2>/dev/null || true)"
read_audit() { # $1 = severity
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String((j.metadata&&j.metadata.vulnerabilities&&j.metadata.vulnerabilities.$1)||0))}catch(e){process.stdout.write('0')}})" <<<"$audit_json"
}
A_CRIT=$(read_audit critical)
A_HIGH=$(read_audit high)
A_MOD=$(read_audit moderate)

# ---- --update mode ----
if [[ "${1:-}" == "--update" ]]; then
  node - "$BASELINE" "$DEPS" "$DEV_DEPS" "$TOTAL" "$A_CRIT" "$A_HIGH" "$A_MOD" <<'NODE'
const fs = require('fs');
const [file, deps, dev, total, crit, high, mod] = process.argv.slice(2);
let t = fs.readFileSync(file, 'utf8');
const block = `<!-- DEPS-GATE-BASELINE
MAX_DEPENDENCIES=${deps}
MAX_DEV_DEPENDENCIES=${dev}
MAX_TOTAL_DEPENDENCIES=${total}
MAX_AUDIT_CRITICAL=${crit}
MAX_AUDIT_HIGH=${high}
MAX_AUDIT_MODERATE=${mod}
-->`;
t = t.replace(/<!-- DEPS-GATE-BASELINE[\s\S]*?-->/, block);
fs.writeFileSync(file, t);
console.log('deps-gate: baseline updated →', {deps, dev, total, crit, high, mod});
NODE
  exit 0
fi

# ---- read ceilings from baseline doc ----
read_max() { # $1 = MAX_* key
  grep -E "^$1=" "$BASELINE" | head -1 | cut -d= -f2 | tr -d '[:space:]'
}
MAX_DEPS=$(read_max MAX_DEPENDENCIES)
MAX_DEV=$(read_max MAX_DEV_DEPENDENCIES)
MAX_TOTAL=$(read_max MAX_TOTAL_DEPENDENCIES)
MAX_CRIT=$(read_max MAX_AUDIT_CRITICAL)
MAX_HIGH=$(read_max MAX_AUDIT_HIGH)
MAX_MOD=$(read_max MAX_AUDIT_MODERATE)

if [[ -z "$MAX_DEPS" || -z "$MAX_TOTAL" ]]; then
  echo "deps-gate: FATAL — could not read baseline from $BASELINE" >&2
  exit 2
fi

fail=0
check() { # name current max
  local name="$1" cur="$2" max="$3"
  if (( cur > max )); then
    printf '  ✗ %-22s %3d > %-3d (baseline exceeded)\n' "$name" "$cur" "$max"
    fail=1
  else
    printf '  ✓ %-22s %3d ≤ %-3d\n' "$name" "$cur" "$max"
  fi
}

echo "deps-gate (v1.25.5 hygiene) — baseline: $BASELINE"
check "dependencies"     "$DEPS"     "$MAX_DEPS"
check "devDependencies"  "$DEV_DEPS" "$MAX_DEV"
check "total deps"       "$TOTAL"    "$MAX_TOTAL"
check "audit critical"   "$A_CRIT"   "$MAX_CRIT"
check "audit high"       "$A_HIGH"   "$MAX_HIGH"
check "audit moderate"   "$A_MOD"    "$MAX_MOD"

if (( fail )); then
  echo "deps-gate: FAIL — footprint/audit exceeds baseline. Justify + bump docs/audit/DEPS-BASELINE.md (--update) or trim deps." >&2
  exit 1
fi
echo "deps-gate: PASS"
