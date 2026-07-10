# ollamas — Quickstart (instant-on)

New session? Three lines to a working ollamas. Everything below reuses existing tooling — nothing here is new infrastructure, just the front door.

## 1. Get ready (detect + auto-fix prerequisites)
```bash
npm run ready
```
Idempotent. Checks Node, installs deps (`npm ci`) if missing, copies `.env` from `.env.example` if absent, verifies the ollama daemon, pulls the default model (`qwen3:8b`) if missing, then runs the deep audit (`doctor.mjs`). It prints a readiness table and the exact next command for anything still blocking. Run it again any time — a healthy setup is an all-green no-op.

- `npm run ready -- --no-pull` — skip the (large) model download, just report.
- Local-only use needs **no API keys**; providers fall back gracefully (ollama → … → demo).

## 2. Start serving
```bash
npm run dev        # tsx server.ts on :3000 (HMR)
# or full stack (ollama warmup + container + bridge + doctor gate):
make up
```

## 3. Work — discoverable verbs (npm + slash commands)
| Verb | npm | slash | What it does |
|------|-----|-------|--------------|
| ready | `npm run ready` | `/ready` | instant-on gate (above) |
| agent | `npm run agent -- "<task>"` | `/agent <task>` | dispatch a task to the local ollamas ReAct sub-agent (Tier-3, $0) |
| ops | `npm run ops` | `/ops` | health: deterministic monitor first, escalate to fleet only on fail |
| verify | `npm run lint && npm run test` | `/verify` | PBVC gate (typecheck + full suite) before any commit |
| ship | `make gate` | `/ship` | project ship gate (`gate.mjs`) |
| doctor | `npm run doctor` | — | deep readiness audit (node/ollama/bridge/app health) |
| monitor | `npm run monitor` | — | deterministic invariant ledger (ground truth) |

## 3-tier dispatch (how agent work flows)
```
Tier 1  Claude Code (you)        decides, cross-checks, reports
  └─ Tier 2  agent-fleet.mjs     fans out workers, aggregates, ground-truth-checks
       └─ Tier 3  agent-dispatch.mjs   one worker on real host tools (qwen3:8b)
```
Local LLM calls are single-GPU: **sequence them, don't parallelize** (parallel serializes ~3× slower). Pure drafting → hit `ollama /api/chat` directly (no ReAct loop).

## Where things live
- State / vault / logs / content-queue: `~/.llm-mission-control/`
- Full contract + 28-phase roadmap + lane laws: **`AGENTS.md`** (canonical)
- This tab's live identity (CLI lane): `CLAUDE.md` (auto-loaded; `npx tsx cli/lib/role.ts` for live status)
- Full docs index: **[README.md](README.md)** (Dokümantasyon table) · extension points: [docs/extension-guide.md](docs/extension-guide.md)
- Something broken? [docs/troubleshooting.md](docs/troubleshooting.md) · test/gate map: [docs/TESTING.md](docs/TESTING.md)

## Boundaries (carried)
Token NAMES ok to log, VALUES never · root cause before symptom · evidence over assertion (run it, show stdout) · no `--no-verify` · `npm run lint && npm run test` green before commit.
