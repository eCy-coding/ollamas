# DOCS-GAPS — undocumented HTTP routes audit

> Generated 2026-07-09 by `scripts/gen-docs-gaps.ts` (v1.29.4 µ3). Source of truth:
> route registrations parsed from `server.ts` (via `scripts/route-usage.ts`) diffed against
> the served OpenAPI spec `server/openapi.ts` (`openApiSpec.paths`). Regenerate after route changes.

**Undocumented routes: 90** — concrete `server.ts` handlers absent from the OpenAPI spec.

Many are intentionally internal (health, telemetry, cockpit SSE, admin, host bridges) — this table
is an inventory of the doc surface gap, not a mandate to document every internal endpoint.

| # | Method | Route (as registered) | Normalized |
| --- | --- | --- | --- |
| 1 | GET | `/.well-known/oauth-authorization-server` | `/.well-known/oauth-authorization-server` |
| 2 | POST | `/api/agent/approve-write` | `/api/agent/approve-write` |
| 3 | POST | `/api/agent/chat` | `/api/agent/chat` |
| 4 | DELETE | `/api/agent/sessions/:id` | `/api/agent/sessions` |
| 5 | GET | `/api/agent/sessions` | `/api/agent/sessions` |
| 6 | POST | `/api/agent/sessions` | `/api/agent/sessions` |
| 7 | GET | `/api/agent/sessions/:id/events` | `/api/agent/sessions/*/events` |
| 8 | POST | `/api/ai/generate` | `/api/ai/generate` |
| 9 | GET | `/api/backup/config` | `/api/backup/config` |
| 10 | POST | `/api/backup/config` | `/api/backup/config` |
| 11 | GET | `/api/backup/download` | `/api/backup/download` |
| 12 | POST | `/api/backup/restore` | `/api/backup/restore` |
| 13 | POST | `/api/backup/trigger` | `/api/backup/trigger` |
| 14 | POST | `/api/billing/run` | `/api/billing/run` |
| 15 | GET | `/api/cluster/capabilities` | `/api/cluster/capabilities` |
| 16 | POST | `/api/cluster/config` | `/api/cluster/config` |
| 17 | POST | `/api/cluster/consent` | `/api/cluster/consent` |
| 18 | POST | `/api/cluster/execute` | `/api/cluster/execute` |
| 19 | POST | `/api/cluster/leave` | `/api/cluster/leave` |
| 20 | GET | `/api/cluster/status` | `/api/cluster/status` |
| 21 | GET | `/api/cockpit/stream` | `/api/cockpit/stream` |
| 22 | GET | `/api/council/calibrate` | `/api/council/calibrate` |
| 23 | POST | `/api/ecysearcher/down` | `/api/ecysearcher/down` |
| 24 | GET | `/api/ecysearcher/logs` | `/api/ecysearcher/logs` |
| 25 | GET | `/api/ecysearcher/status` | `/api/ecysearcher/status` |
| 26 | POST | `/api/ecysearcher/up` | `/api/ecysearcher/up` |
| 27 | POST | `/api/generate` | `/api/generate` |
| 28 | POST | `/api/github/actions/dispatch` | `/api/github/actions/dispatch` |
| 29 | GET | `/api/github/actions/jobs/:jobId/log` | `/api/github/actions/jobs/*/log` |
| 30 | GET | `/api/github/actions/repo-hint` | `/api/github/actions/repo-hint` |
| 31 | GET | `/api/github/actions/runs` | `/api/github/actions/runs` |
| 32 | POST | `/api/github/actions/runs/:id/cancel` | `/api/github/actions/runs/*/cancel` |
| 33 | GET | `/api/github/actions/runs/:id/jobs` | `/api/github/actions/runs/*/jobs` |
| 34 | POST | `/api/github/actions/runs/:id/rerun` | `/api/github/actions/runs/*/rerun` |
| 35 | GET | `/api/github/actions/workflows` | `/api/github/actions/workflows` |
| 36 | GET | `/api/github/search` | `/api/github/search` |
| 37 | GET | `/api/github/search/standard` | `/api/github/search/standard` |
| 38 | POST | `/api/github/webhook` | `/api/github/webhook` |
| 39 | GET | `/api/ingest/stage-events` | `/api/ingest/stage-events` |
| 40 | POST | `/api/ingest/stage-events` | `/api/ingest/stage-events` |
| 41 | POST | `/api/integrations/github/autoconnect` | `/api/integrations/github/autoconnect` |
| 42 | GET | `/api/integrations/health` | `/api/integrations/health` |
| 43 | POST | `/api/keys` | `/api/keys` |
| 44 | POST | `/api/keys/add` | `/api/keys/add` |
| 45 | POST | `/api/keys/doctor` | `/api/keys/doctor` |
| 46 | GET | `/api/keys/health` | `/api/keys/health` |
| 47 | GET | `/api/keys/mask` | `/api/keys/mask` |
| 48 | GET | `/api/keys/pool` | `/api/keys/pool` |
| 49 | POST | `/api/keys/test` | `/api/keys/test` |
| 50 | DELETE | `/api/logbook` | `/api/logbook` |
| 51 | GET | `/api/logbook` | `/api/logbook` |
| 52 | POST | `/api/logbook` | `/api/logbook` |
| 53 | POST | `/api/macos-terminal` | `/api/macos-terminal` |
| 54 | GET | `/api/models/:provider` | `/api/models` |
| 55 | GET | `/api/notify/config` | `/api/notify/config` |
| 56 | POST | `/api/notify/config` | `/api/notify/config` |
| 57 | POST | `/api/notify/test` | `/api/notify/test` |
| 58 | GET | `/api/orchestra` | `/api/orchestra` |
| 59 | POST | `/api/pipeline` | `/api/pipeline` |
| 60 | POST | `/api/revenue/audit` | `/api/revenue/audit` |
| 61 | POST | `/api/revenue/check` | `/api/revenue/check` |
| 62 | POST | `/api/revenue/checkout` | `/api/revenue/checkout` |
| 63 | GET | `/api/revenue/config` | `/api/revenue/config` |
| 64 | POST | `/api/revenue/config` | `/api/revenue/config` |
| 65 | POST | `/api/revenue/storefront` | `/api/revenue/storefront` |
| 66 | POST | `/api/revenue/testgen` | `/api/revenue/testgen` |
| 67 | GET | `/api/saas/catalog` | `/api/saas/catalog` |
| 68 | GET | `/api/saas/keys` | `/api/saas/keys` |
| 69 | POST | `/api/saas/keys/:id/revoke` | `/api/saas/keys/*/revoke` |
| 70 | DELETE | `/api/saas/upstreams/:id` | `/api/saas/upstreams` |
| 71 | GET | `/api/saas/usage` | `/api/saas/usage` |
| 72 | DELETE | `/api/saas/webhooks/:id` | `/api/saas/webhooks` |
| 73 | GET | `/api/saas/webhooks` | `/api/saas/webhooks` |
| 74 | POST | `/api/saas/webhooks` | `/api/saas/webhooks` |
| 75 | GET | `/api/security/log` | `/api/security/log` |
| 76 | POST | `/api/security/permissions` | `/api/security/permissions` |
| 77 | GET | `/api/selftest` | `/api/selftest` |
| 78 | GET | `/api/telemetry/recent` | `/api/telemetry/recent` |
| 79 | GET | `/api/telemetry/stream` | `/api/telemetry/stream` |
| 80 | POST | `/api/terminal` | `/api/terminal` |
| 81 | GET | `/api/threatfeed` | `/api/threatfeed` |
| 82 | GET | `/api/workspace/download` | `/api/workspace/download` |
| 83 | DELETE | `/api/workspace/file` | `/api/workspace/file` |
| 84 | GET | `/api/workspace/file` | `/api/workspace/file` |
| 85 | POST | `/api/workspace/file` | `/api/workspace/file` |
| 86 | POST | `/api/workspace/select` | `/api/workspace/select` |
| 87 | GET | `/api/workspace/tree` | `/api/workspace/tree` |
| 88 | POST | `/api/workspace/upload` | `/api/workspace/upload` |
| 89 | POST | `/register` | `/register` |
| 90 | POST | `/token` | `/token` |

Router mounts (`app.use(prefix, …)`) delegate to sub-routers documented under their own paths — informational, not counted above: `/api/ai/transcribe`, `/api/billing/webhook`, `/api/docs`, `/api/ecysearcher`, `/api/github/webhook`, `/api/ingest/stage-events`, `/api/workspace/upload`.
