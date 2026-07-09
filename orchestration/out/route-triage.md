# Dead-Route Triage — QA-3 (v1.27.3)

> ANALİZ/TRIAGE fazı. **Route SİLME YOK** — silme onayı v1.27.4 µ3 [T0] gate'ine bırakıldı.
> Kaynak: `npx tsx scripts/route-usage.ts` (v1.25.5 hygiene) + route-başı grep kanıtı (src/ cli/ web/ bin/ server/).
> Üretim: `scripts/route-usage.ts` pure-fn'leri (parseServerRoutes/computeRouteReports/normalizePath) yeniden kullanıldı.

## Özet (route-usage.ts)

| Metrik | Değer |
|---|---|
| Server route (registration) | 125 |
| used (caller referansı var) | 91 |
| allowlisted (privileged/infra) | 14 |
| script-dead (referans yok) | 21 |
| distinct caller path (src+cli) | 86 |

**Manuel triage sonucu:** script'in bulduğu 21 "dead" adayının **13'i false-positive** (dış-public-API / dolaylı-dinamik-caller / auth-korumalı), **8'i gerçek DEAD-CANDIDATE** (→ v1.27.4 µ3 [T0] silme-onayı bekler).

**Sınıf sözlüğü:** `PUBLIC-API` (dış/programatik tüketici; frontend-dışı) · `INTERNAL-USED` (src/cli caller var) · `PRIVILEGED` (auth/host-bridge/webhook — güvenlik-yüzeyi, ASLA dead-önerilmez) · `DEAD-aday` (caller yok, [T0] silme-incelemesi).
**Disposition:** KEEP-PUBLIC · KEEP-INTERNAL · PRIVILEGED-KEEP · DEAD-CANDIDATE.

## Tam route tablosu (125 satır)

| route | method | hit-count | sınıf |
|---|---|---|---|
| `/.well-known/mcp.json` | GET | 0 | PUBLIC-API |
| `/.well-known/oauth-authorization-server` | GET | 0 | PRIVILEGED |
| `/.well-known/oauth-protected-resource` | GET | 0 | PRIVILEGED |
| `/api/agent/approve-write` | POST | 3 | INTERNAL-USED |
| `/api/agent/chat` | POST | 9 | INTERNAL-USED |
| `/api/agent/sessions` | GET | 13 | INTERNAL-USED |
| `/api/agent/sessions` | POST | 13 | INTERNAL-USED |
| `/api/agent/sessions/:id` | DELETE | 13 | INTERNAL-USED |
| `/api/agent/sessions/:id` | GET | 13 | INTERNAL-USED |
| `/api/agent/sessions/:id/events` | GET | 1 | INTERNAL-USED |
| `/api/ai/generate` | POST | 1 | INTERNAL-USED |
| `/api/ai/models` | GET | 0 | PUBLIC-API |
| `/api/ai/transcribe` | POST | 0 | PUBLIC-API |
| `/api/ai/transcribe` | USE | 0 | INTERNAL-USED |
| `/api/backup/config` | GET | 4 | INTERNAL-USED |
| `/api/backup/config` | POST | 4 | INTERNAL-USED |
| `/api/backup/download` | GET | 3 | INTERNAL-USED |
| `/api/backup/restore` | POST | 2 | INTERNAL-USED |
| `/api/backup/trigger` | POST | 2 | INTERNAL-USED |
| `/api/billing/checkout` | POST | 1 | INTERNAL-USED |
| `/api/billing/portal` | POST | 2 | INTERNAL-USED |
| `/api/billing/preview` | GET | 2 | INTERNAL-USED |
| `/api/billing/run` | POST | 1 | INTERNAL-USED |
| `/api/billing/webhook` | POST | 0 | PRIVILEGED |
| `/api/billing/webhook` | USE | 0 | PRIVILEGED |
| `/api/cluster/capabilities` | GET | 1 | INTERNAL-USED |
| `/api/cluster/config` | POST | 0 | DEAD-aday |
| `/api/cluster/consent` | POST | 0 | DEAD-aday |
| `/api/cluster/execute` | POST | 1 | INTERNAL-USED |
| `/api/cluster/leave` | POST | 0 | DEAD-aday |
| `/api/cluster/status` | GET | 0 | DEAD-aday |
| `/api/cockpit/stream` | GET | 3 | INTERNAL-USED |
| `/api/council/calibrate` | GET | 2 | INTERNAL-USED |
| `/api/docs` | USE | 0 | PUBLIC-API |
| `/api/ecysearcher` | USE | 9 | INTERNAL-USED |
| `/api/ecysearcher/down` | POST | 1 | INTERNAL-USED |
| `/api/ecysearcher/logs` | GET | 1 | INTERNAL-USED |
| `/api/ecysearcher/status` | GET | 2 | INTERNAL-USED |
| `/api/ecysearcher/up` | POST | 1 | INTERNAL-USED |
| `/api/generate` | POST | 10 | INTERNAL-USED |
| `/api/github/actions/dispatch` | POST | 1 | INTERNAL-USED |
| `/api/github/actions/jobs/:jobId/log` | GET | 1 | INTERNAL-USED |
| `/api/github/actions/repo-hint` | GET | 1 | INTERNAL-USED |
| `/api/github/actions/runs` | GET | 3 | INTERNAL-USED |
| `/api/github/actions/runs/:id/cancel` | POST | 0 | INTERNAL-USED |
| `/api/github/actions/runs/:id/jobs` | GET | 1 | INTERNAL-USED |
| `/api/github/actions/runs/:id/rerun` | POST | 0 | INTERNAL-USED |
| `/api/github/actions/workflows` | GET | 1 | INTERNAL-USED |
| `/api/github/search` | GET | 2 | INTERNAL-USED |
| `/api/github/search/standard` | GET | 1 | INTERNAL-USED |
| `/api/github/webhook` | POST | 0 | PRIVILEGED |
| `/api/github/webhook` | USE | 0 | PRIVILEGED |
| `/api/health` | GET | 18 | INTERNAL-USED |
| `/api/ingest/stage-events` | GET | 0 | PRIVILEGED |
| `/api/ingest/stage-events` | POST | 0 | PRIVILEGED |
| `/api/ingest/stage-events` | USE | 0 | PRIVILEGED |
| `/api/integrations/github/autoconnect` | POST | 1 | INTERNAL-USED |
| `/api/integrations/health` | GET | 1 | INTERNAL-USED |
| `/api/keys` | POST | 25 | INTERNAL-USED |
| `/api/keys/add` | POST | 3 | INTERNAL-USED |
| `/api/keys/doctor` | POST | 3 | INTERNAL-USED |
| `/api/keys/health` | GET | 2 | INTERNAL-USED |
| `/api/keys/mask` | GET | 1 | INTERNAL-USED |
| `/api/keys/pool` | GET | 6 | INTERNAL-USED |
| `/api/keys/test` | POST | 1 | INTERNAL-USED |
| `/api/logbook` | DELETE | 10 | INTERNAL-USED |
| `/api/logbook` | GET | 10 | INTERNAL-USED |
| `/api/logbook` | POST | 10 | INTERNAL-USED |
| `/api/macos-terminal` | POST | 0 | PRIVILEGED |
| `/api/mcp/upstreams` | GET | 2 | INTERNAL-USED |
| `/api/models/:provider` | GET | 8 | INTERNAL-USED |
| `/api/notify/config` | GET | 0 | DEAD-aday |
| `/api/notify/config` | POST | 0 | DEAD-aday |
| `/api/notify/test` | POST | 0 | DEAD-aday |
| `/api/openapi.json` | GET | 0 | PUBLIC-API |
| `/api/orchestra` | GET | 3 | INTERNAL-USED |
| `/api/pipeline` | POST | 1 | INTERNAL-USED |
| `/api/ready` | GET | 1 | INTERNAL-USED |
| `/api/revenue/audit` | POST | 1 | INTERNAL-USED |
| `/api/revenue/check` | POST | 0 | DEAD-aday |
| `/api/revenue/checkout` | POST | 1 | INTERNAL-USED |
| `/api/revenue/config` | GET | 2 | INTERNAL-USED |
| `/api/revenue/config` | POST | 2 | INTERNAL-USED |
| `/api/revenue/storefront` | POST | 1 | INTERNAL-USED |
| `/api/revenue/testgen` | POST | 1 | INTERNAL-USED |
| `/api/saas/audit` | GET | 3 | INTERNAL-USED |
| `/api/saas/catalog` | GET | 1 | INTERNAL-USED |
| `/api/saas/keys` | GET | 7 | INTERNAL-USED |
| `/api/saas/keys` | POST | 7 | INTERNAL-USED |
| `/api/saas/keys/:id/revoke` | POST | 1 | INTERNAL-USED |
| `/api/saas/plans` | GET | 2 | INTERNAL-USED |
| `/api/saas/self/keys` | GET | 0 | PRIVILEGED |
| `/api/saas/self/keys` | POST | 0 | PRIVILEGED |
| `/api/saas/self/keys/:id/revoke` | POST | 0 | PRIVILEGED |
| `/api/saas/self/usage` | GET | 2 | INTERNAL-USED |
| `/api/saas/tenants` | GET | 5 | INTERNAL-USED |
| `/api/saas/tenants` | POST | 5 | INTERNAL-USED |
| `/api/saas/upstreams` | GET | 5 | INTERNAL-USED |
| `/api/saas/upstreams` | POST | 5 | INTERNAL-USED |
| `/api/saas/upstreams/:id` | DELETE | 5 | INTERNAL-USED |
| `/api/saas/upstreams/status` | GET | 0 | PRIVILEGED |
| `/api/saas/usage` | GET | 5 | INTERNAL-USED |
| `/api/saas/usage/timeseries` | GET | 5 | INTERNAL-USED |
| `/api/saas/webhooks` | GET | 3 | INTERNAL-USED |
| `/api/saas/webhooks` | POST | 3 | INTERNAL-USED |
| `/api/saas/webhooks/:id` | DELETE | 3 | INTERNAL-USED |
| `/api/saas/webhooks/deliveries` | GET | 0 | PRIVILEGED |
| `/api/security/log` | GET | 1 | INTERNAL-USED |
| `/api/security/permissions` | POST | 1 | INTERNAL-USED |
| `/api/selftest` | GET | 1 | INTERNAL-USED |
| `/api/telemetry/recent` | GET | 3 | INTERNAL-USED |
| `/api/telemetry/stream` | GET | 2 | INTERNAL-USED |
| `/api/terminal` | POST | 1 | PRIVILEGED |
| `/api/threatfeed` | GET | 1 | INTERNAL-USED |
| `/api/workspace/download` | GET | 1 | INTERNAL-USED |
| `/api/workspace/file` | DELETE | 5 | INTERNAL-USED |
| `/api/workspace/file` | GET | 5 | INTERNAL-USED |
| `/api/workspace/file` | POST | 5 | INTERNAL-USED |
| `/api/workspace/select` | POST | 1 | INTERNAL-USED |
| `/api/workspace/tree` | GET | 1 | INTERNAL-USED |
| `/api/workspace/upload` | POST | 2 | INTERNAL-USED |
| `/api/workspace/upload` | USE | 2 | INTERNAL-USED |
| `/metrics` | GET | 0 | PRIVILEGED |
| `/register` | POST | 0 | PRIVILEGED |
| `/token` | POST | 0 | PRIVILEGED |

> `hit-count` = src/+cli/ içindeki caller string-literal geçiş sayısı (normalize edilmiş path; exact + nested-deeper). `0` = script caller bulamadı (dış/dolaylı olabilir — aşağıda tek-tek incelendi).

## µ1 — 21 DEAD-adayının tek-tek incelemesi (kanıt-satırı ile)

Her satır: script-flag → gerçek sınıf → disposition → **kanıt**.

| # | route | method | final sınıf | disposition | kanıt |
|---|---|---|---|---|---|
| 1 | `/.well-known/mcp.json` | GET | PUBLIC-API | KEEP-PUBLIC | External MCP client discovery manifest. Allowlist has `/.well-known/mcp` but not the `.json` variant → false-positive. No frontend caller by design (fetched by 3rd-party MCP clients). |
| 2 | `/api/ai/models` | GET | PUBLIC-API | KEEP-PUBLIC | google.colab.ai facade (server.ts:1291 comment "Mirrors google.colab.ai: GET /api/ai/models"). External/programmatic consumer; server/ai.ts:51 relies on it in docker+local. |
| 3 | `/api/ai/transcribe` | POST | PUBLIC-API | KEEP-PUBLIC | Colab-mirror STT public API (server.ts:1307). External/programmatic consumer, no browser caller by design. |
| 4 | `/api/ai/transcribe` | USE | INTERNAL-USED | KEEP-INTERNAL | express.raw body-parser mount (server.ts:197) that pairs with POST /api/ai/transcribe — a middleware mount, not an endpoint. |
| 5 | `/api/cluster/config` | POST | DEAD-aday | DEAD-CANDIDATE | Federation node config (server.ts:2777). NO caller in src/cli/web. ClusterManager.tsx only hits /capabilities, VirtualController /execute. Confirm no mobile/peer consumer before [T0] removal. |
| 6 | `/api/cluster/consent` | POST | DEAD-aday | DEAD-CANDIDATE | EULA consent lifecycle (server.ts:2793). NO caller found. types.ts:142 defines ClusterConsent interface but no fetch. Federation-lifecycle — confirm no peer/mobile caller before [T0]. |
| 7 | `/api/cluster/leave` | POST | DEAD-aday | DEAD-CANDIDATE | Mesh opt-out (server.ts:2805). NO caller found. Federation-lifecycle — confirm no peer/mobile caller before [T0]. |
| 8 | `/api/cluster/status` | GET | DEAD-aday | DEAD-CANDIDATE | Cluster status (server.ts:2334). NO caller in src/cli/web. Federation-lifecycle — confirm no peer/mobile caller before [T0]. |
| 9 | `/api/docs` | USE | PUBLIC-API | KEEP-PUBLIC | Swagger UI mount. Linked from web/index.html:23,62 + web/embed-demo.html:17 (`<a href="/api/docs">`). Script scans only src/+cli/, not web/*.html → false-positive. |
| 10 | `/api/github/actions/runs/:id/cancel` | POST | INTERNAL-USED | KEEP-INTERNAL | Called via dynamic segment: GitHubActionsPanel.tsx:100 `api.post(`/api/github/actions/runs/${runId}/${kind}`)` where kind∈{rerun,cancel}. route-usage.ts cannot resolve the `${kind}` tail → false-positive. |
| 11 | `/api/github/actions/runs/:id/rerun` | POST | INTERNAL-USED | KEEP-INTERNAL | Same dynamic `${kind}` caller (GitHubActionsPanel.tsx:100). route-usage.ts miss on dynamic path segment → false-positive. |
| 12 | `/api/notify/config` | GET | DEAD-aday | DEAD-CANDIDATE | server.ts:439. NO caller in src/cli/web/docs, not in openapi.ts. Genuinely orphaned notification-config getter. |
| 13 | `/api/notify/config` | POST | DEAD-aday | DEAD-CANDIDATE | server.ts:440. NO caller anywhere. Genuinely orphaned. |
| 14 | `/api/notify/test` | POST | DEAD-aday | DEAD-CANDIDATE | server.ts:446. NO caller anywhere. Genuinely orphaned. |
| 15 | `/api/openapi.json` | GET | PUBLIC-API | KEEP-PUBLIC | OpenAPI spec served for the /api/docs swagger UI + external tooling. Fetched by the doc UI, not a src/ literal → false-positive. |
| 16 | `/api/revenue/check` | POST | DEAD-aday | DEAD-CANDIDATE | GitHub Check-run poster (server.ts:385, needs githubRepo+headSha). RevenueOps.tsx uses config/testgen/audit/checkout/storefront but NOT /check. No internal caller; GitHub-App integration surface (external/CI programmatic possible) — verify before [T0]. |
| 17 | `/api/saas/self/keys` | GET | PRIVILEGED | PRIVILEGED-KEEP | authMiddleware(true)+requireScope("keys:read") (server.ts:2666); documented in server/openapi.ts:49. SaaS-tenant self-service API, external ApiKey consumer. NEVER propose dead. |
| 18 | `/api/saas/self/keys` | POST | PRIVILEGED | PRIVILEGED-KEEP | authMiddleware(true)+requireScope("keys:write") (server.ts:2669); openapi.ts:49. External tenant API. NEVER dead. |
| 19 | `/api/saas/self/keys/:id/revoke` | POST | PRIVILEGED | PRIVILEGED-KEEP | authMiddleware(true)+requireScope("keys:write") (server.ts:2673). External tenant API. NEVER dead. |
| 20 | `/api/saas/upstreams/status` | GET | PRIVILEGED | PRIVILEGED-KEEP | authMiddleware(true) (server.ts:2648). Protected SaaS admin route; callers hit /api/saas/upstreams (+/:id) but not /status. Auth-protected surface — NEVER propose dead. |
| 21 | `/api/saas/webhooks/deliveries` | GET | PRIVILEGED | PRIVILEGED-KEEP | authMiddleware(true), tenant-scoped listDeliveries (server.ts:2690). Protected SaaS admin surface — NEVER propose dead. |

### µ1 sınıflama dağılımı (21 aday)
- **KEEP-PUBLIC** (false-positive, dış API/doc — script src/cli-only tarar): 5 → `/.well-known/mcp.json`, `/api/ai/models`, `POST /api/ai/transcribe`, `/api/docs`, `/api/openapi.json`
- **KEEP-INTERNAL** (false-positive, dolaylı/dinamik caller): 3 → `USE /api/ai/transcribe` (middleware mount), `runs/:id/cancel`, `runs/:id/rerun` (dinamik `${kind}`)
- **PRIVILEGED-KEEP** (auth-korumalı — güvenlik-yüzeyi, ASLA dead): 5 → `saas/self/keys` GET+POST, `self/keys/:id/revoke`, `saas/upstreams/status`, `saas/webhooks/deliveries`
- **DEAD-CANDIDATE** (gerçek-dead, [T0] silme-onayı bekler): 8 → `cluster/config`, `cluster/consent`, `cluster/leave`, `cluster/status`, `notify/config` GET+POST, `notify/test`, `revenue/check`

## µ2 — PRIVILEGED route caller-enumeration (≥1 caller VEYA external-only işareti)

Privileged route ASLA DEAD-önerilmez (güvenlik-yüzeyi). Her biri için caller kanıtı:

| privileged route | koruma | caller(lar) / işaret |
|---|---|---|
| `POST /api/generate` | gateway choke-point | **4+ caller**: cli/lib/client.ts:100, cli/lib/shortcuts.ts:160,195, cli/commands/bench.ts, cli/commands/remote.ts:99 |
| `POST /api/macos-terminal` | privileged host bridge (allowlist) | **1 host-caller**: bin/host-bridge/benchmark.mjs:62 (script bin/ taramaz → allowlist ile korunur; server.ts:2009) |
| `POST /api/terminal` | privileged host bridge (allowlist) | 1 caller (hit=1); server.ts:219 privileged grubu |
| `GET /metrics` | observability scraper (allowlist) | 0-internal (external Prometheus scraper — privileged-only) |
| `POST /token` , `POST /register` | OAuth/DCR (allowlist) | 0-internal (external OAuth/dynamic-client-registration — privileged-only) |
| `GET /.well-known/oauth-*` | OAuth discovery (allowlist) | 0-internal (external OAuth client discovery — privileged-only) |
| `POST /api/github/webhook` , `POST /api/billing/webhook` | HMAC webhook (allowlist) | 0-internal (inbound 3rd-party webhook — privileged-only) |
| `* /api/ingest/stage-events` | ingest (allowlist) | 0-internal (external ingest producer — privileged-only) |
| `GET /api/saas/self/keys` (+POST, revoke) | authMiddleware(true)+scope | 0-internal, **external SaaS-tenant ApiKey** (openapi.ts:49 documented) — PRIVILEGED-KEEP |
| `GET /api/saas/upstreams/status` | authMiddleware(true) | 0-internal, external admin-token — PRIVILEGED-KEEP |
| `GET /api/saas/webhooks/deliveries` | authMiddleware(true) | 0-internal, external admin-token — PRIVILEGED-KEEP |

Kural doğrulandı: privileged/auth-korumalı route'ların HİÇBİRİ DEAD-CANDIDATE'e düşmedi.

## Final disposition — [T0] silme-bekleyen (v1.27.4 µ3)

**DEAD-CANDIDATE (8):** yalnız bu 8 route [T0] onayı ile silinebilir. Diğer 13 script-dead false-positive'tir (silme YASAK):

1. `GET  /api/cluster/status` — federation-lifecycle (peer/mobile caller teyidi şart)
2. `POST /api/cluster/config` — federation-lifecycle (peer/mobile caller teyidi şart)
3. `POST /api/cluster/consent` — federation-lifecycle (peer/mobile caller teyidi şart)
4. `POST /api/cluster/leave` — federation-lifecycle (peer/mobile caller teyidi şart)
5. `GET  /api/notify/config` — orphaned (kesin dead)
6. `POST /api/notify/config` — orphaned (kesin dead)
7. `POST /api/notify/test` — orphaned (kesin dead)
8. `POST /api/revenue/check` — GitHub-App Check poster (external/CI programatik teyidi şart)

**Kesin-dead (yüksek güven, 3):** notify/config GET+POST, notify/test — hiçbir yerde (src/cli/web/docs/openapi) referans yok.
**Şartlı-dead (teyit gerektirir, 5):** cluster/* (4) + revenue/check — dış-peer/webhook/CI tüketicisi olabilir; [T0] silme öncesi canlı-teyit önerilir.

---
*Üretim: v1.27.3 QA-3 · kod-değişiklik-yok (yalnız bu .md) · route-usage.ts exit0/125-route.*

