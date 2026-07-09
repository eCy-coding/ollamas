# DEPS-BASELINE (v1.25.5 hygiene)

Dependency-footprint + `npm audit` snapshot. `scripts/deps-gate.sh` reads the
machine-parsable block below and fails (exit 1) if the current tree **exceeds**
any ceiling. Bumping a ceiling is a deliberate, reviewable edit — new deps and
new vulnerabilities cannot slip in silently.

Regenerate the numbers with: `bash scripts/deps-gate.sh --update`

<!-- DEPS-GATE-BASELINE
MAX_DEPENDENCIES=35
MAX_DEV_DEPENDENCIES=32
MAX_TOTAL_DEPENDENCIES=67
MAX_AUDIT_CRITICAL=0
MAX_AUDIT_HIGH=0
MAX_AUDIT_MODERATE=3
-->

## Snapshot (captured 2026-07-09)

| Metric | Baseline ceiling |
| --- | --- |
| `dependencies` | 35 |
| `devDependencies` | 32 |
| total | 67 |
| audit critical | 0 |
| audit high | 0 |
| audit moderate | 3 |

Notes:
- Ceilings are upper bounds, not exact counts — removing a dep is always fine.
- `moderate=3` reflects known transitive advisories at capture time; drive it
  down when a non-breaking fix lands, then lower the ceiling here.
- v1.28.3: devDependencies 31→32 (+`@vitest/coverage-v8`, the v8 coverage
  provider backing the `lines:70` pure-core gate); total 66→67.
