# Naming conventions (dc-1.5)

> Describes the conventions the tree already follows — source-true, not aspirational. New files must match.

## Prefixes (by system)
| Prefix | Where | Meaning | Example |
|---|---|---|---|
| `help-*` | `pipeline/bin/` | help-site build/export tooling | `help-build.ts`, `help-site.ts`, `help-export.ts` |
| `cc-*` | vault `_bin/` | Claude-KB (cckb) tools | `cc-health.py`, `cc-graph.py`, `cc-verify.sh` |
| `ecy-*` / `ecym*` | `~/.local/bin/` | eCym commands | `ecy-cmd`, `ecy-brain`, `ecym` |
| `dc-*` | vault `orchestra/dev-council/TASK-POOL/` | dev-council task cards | `dc-1.5.md` (= backlog phase 1.5) |

## Directory tiers
| Path | Rule |
|---|---|
| `pipeline/lib/` | **PURE** modules (no fs/clock/random) — unit-tested, ≥90% coverage gate |
| `pipeline/bin/` | thin **IO** orchestrators (`#!/usr/bin/env -S npx tsx`), a `--verify` mode where sensible |
| `pipeline/tests/` | `*.test.ts`, one per lib module |
| `web/help/` | committed coded site (repo target) |
| vault `_help/` `_bin/` `_index/` | vault tiers: help mirror · tools · indexes/MOCs |
| `_sandbox/` | the **only** place deletion is allowed |

## File-content rules
- Every `pipeline/lib/**` module: pure, has a header comment explaining WHY, no `Date.now()`/`Math.random()` in output paths.
- Every `pipeline/bin/**` command: header comment `// <name> — <one line>` (read by `bin/commands.ts` for the CLI table).
- Docs that are generated (`COMMANDS.md`, `CHANGELOG.md`) carry a "regenerate:" line and are never hand-edited.
- Commit subjects: conventional (`feat|fix|docs|refactor(pipeline): …`) + the `Co-Authored-By` trailer.
- Prompts name only **real paths** (enforced by `promptlint`, verify.sh block 24).

## IDs
- Backlog: `N.N` (phase.subtask) in `ECYE2EMASTERPLAN.en.md`; the dev-council card id is `dc-N.N`.
- Findings `F-<n>`, suggestions `S-<n>`, seyir-defteri `E-<n>`/`N-<n>`, decisions `SD<n>`, gates `S<n>`, blind spots `SB<n>`.
