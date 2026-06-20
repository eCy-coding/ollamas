# Seyir Defteri — LLM Mission Control

Bu projenin klonlanıp kurulmasından, gerçek-zamanlı macOS terminal coding
sistemine ve 22-araçlı agentic toolkit'e dönüşmesine kadar **adım adım** kayıt.
Her faz: **ne** yapıldı, **nasıl**, **niçin**, kanıt (commit). Canlı agent
eylemleri ayrıca `~/.llm-mission-control/seyir-defteri.jsonl`'e otomatik düşer
(`logbook` aracı / `GET /api/logbook` ile okunur).

---

## Faz 0 — Klonlama + E2E kurulum
- **Ne:** `adobemre1/ollamas` klonlandı, Docker detached + localhost-only çalıştırıldı.
- **Nasıl:** `docker-compose.yml` portu `127.0.0.1:3000` + `restart: unless-stopped`; Dockerfile fix (puppeteer chromium, `tools.json` kopyala).
- **Niçin:** kesintisiz + LAN'a kapalı (unauth shell-exec yüzeyini izole et).
- **Kanıt:** 9/9 self-test gate yeşil, ollama 0.30.7 live.

## Faz 1 — Vault durability bug fix
- **Ne:** API key'leri restart'ta kaybolmuyor artık.
- **Nasıl:** `db.ts` `os.platform()!=="darwin"` → container'ı ephemeral sayıp `/app/.ephemeral-data`'ya yazıyordu. `MISSION_CONTROL_DATA_DIR` env override → mounted volume.
- **Niçin:** Docker'da kalıcı vault + master key.

## Faz 2 — Gerçek-zamanlı macOS Terminal Bridge (commit 5ace9d6)
- **Ne:** Linux container'daki agent, gerçek **iTerm2/Terminal.app**'i sürüyor.
- **Nasıl:** host-side `terminal-bridge.mjs` (osascript) + `/run /exec /write /read /health`. macos_terminal agent tool → `host.docker.internal:7345`. Komut script-file ile çalıştırılır; **watchdog** hung komutu kesip session'ı kurtarır; timeout'ta dedicated pencere reset (self-heal).
- **Niçin:** container GUI süremez → host bridge şart.
- **Kanıt:** bridge test 10/10.

## Faz 3 — Benchmark + Warm-model kalibrasyon (commit 65a38ca)
- **Ne:** En verimli config bulundu + kalıcı yapıldı.
- **Nasıl:** 5 model e2e benchmark → **qwen3:8b** en hızlı doğru. `providers.ts`'e `keep_alive=30m` + `num_thread=12` (M4 Max P-core) + `num_gpu=999` plumb. Terminal.app stabil seçildi.
- **Niçin:** warm model = reload latency yok, stabil ~215ms/92 tok/s.

## Faz 4 — Sistemin kendi araçlarını kodlaması (dogfooding) + 21 araç
- **Ne:** Agent (qwen3-coder:30b) kendi bridge-tool'larını yazdı, 3 batch'te.
  - Batch 1 (5ace9d6/1a30e6c): run_tests, git_ops, process_port, health_probe + `write_host_file` + `/exec` (nested-bridge deadlock çözümü).
  - Batch 2 (0bacc33): lint_format, git_commit, build_app, kill_process.
  - Batch 3 (d764b60): log_stream, pkg_install, web_search, apply_patch.
- **Nasıl:** her tool agent `write_host_file` ile yazıldı, ReAct adımları izlendi; agent bug'ları (node-fetch/undici/Deno, token-path, heredoc) kök-nedenden düzeltildi.
- **Niçin:** sistem kendi araçlarını üretebilen agentic coding platformu.

## Faz 5 — Toolkit hardening (commit 39b2dcf)
- **Ne:** kalite + verim + kapasite.
- **Nasıl:** ortak `lib/bridge-client.mjs` (DRY, JSON+exit, retry+timeout); lint_format image cache; git_ops subcommand, git_commit --push, kill_process --sig, web_search --fetch; yeni `tools_doctor` (self-test).
- **Niçin:** ~80 satır tekrar gitti, tutarlı output, observability.

## Faz 6 — Bash/macOS uzmanlığı (commit 2872992)
- **Ne:** agent macOS/BSD shell'de uzmanlaştı, hata payı düştü.
- **Nasıl:** `MACOS_BASH_GUIDE.md` + system-prompt'a BSD kuralları; `shell_check` aracı (shellcheck + macOS heuristik) → komut çalıştırmadan lint; in-container allowlist +20 bin.
- **Niçin:** tekrarlayan base64 -d / sed -i / heredoc hatalarını önle.

## Faz 7 — Seyir Defteri + Otonomi testi (bu faz)
- **Ne:** logbook sistemi + müdahalesiz otonomi ölçümü.
- **Nasıl:** `server.ts` her agent step'i `seyir-defteri.jsonl`'e otomatik yazar; `logbook` aracı + `/api/logbook`. Gerçek kullanıcı istekleri agent'a verilip ne/nasıl/niçin sorgulandı.

## Faz 8 — MCP Gateway + tools-as-SaaS (devam ediyor)
- **Ne:** ollamas'ı MCP gateway + SaaS broker'a dönüştürme. Önce master prompt + tek choke-point.
- **Master prompt:** `AGENTS.md` (roller + değişmez prensipler + kalite kapısı + güvenlik tier'leri); `server.ts` runtime system prompt'a operating-contract enjekte (commit bb05060).
- **Faz 0 (tek choke-point):** `server/tool-registry.ts` — 22 workspace tool tek `ToolRegistry.execute(name,args,ctx)`'ten geçer; schema/diff/halt/metering-hook/allowlist tek nokta. `server.ts` ReAct dispatch switch'i (~100 satır) registry çağrısına indi; `AGENT_TOOLS` literal → `ToolRegistry.schemas()`. tsc temiz, 6/7 test (1 pre-existing consent-401 fail).
- **Niçin:** MCP-expose, MCP-consume, auth, rate-limit, billing — hepsi tek noktaya takılacak; ikinci dispatch yolu yasak (AGENTS.md §4).
- **Faz 1 (MCP gateway):** `@modelcontextprotocol/sdk` 1.29. EXPOSE: `server/mcp/server.ts` low-level Server + stateless Streamable HTTP → `app.all("/mcp")`; registry JSON-Schema'ları doğrudan MCP `inputSchema`. CONSUME: `server/mcp/client.ts` stdio/http upstream → tool'lar `mcp__<server>__<tool>` olarak registry'ye merge → ReAct + /mcp ikisi de çağırır. tools.json `mcpServers` config. Kanıt: MCP client listTools = 22 tool (LIVE :3939); yerel stdio mini-MCP consume → `mcp__local__ping` → "pong" choke-point'ten. tier-filter `MCP_EXPOSE_TIERS` (§5 güvenlik).
- **Faz 2 (multi-tenant store):** `server/store/index.ts` — Node 24 built-in `node:sqlite` (ZERO dep, docker native-rebuild yok). Tablolar: plans (free/pro/enterprise seed, tier escalation), tenants, api_keys (SHA-256 hash, plaintext ONCE), usage_events (ay-bazlı index), invoices. `~/.llm-mission-control/saas.db`.
- **Faz 3 (auth + rate-limit):** `server/middleware/auth.ts` Bearer/X-API-Key → resolveKey → `req.tenant`; `rate-limit.ts` plan-bazlı token-bucket + aylık kota. `/mcp` = auth→rate-limit→handler. `SAAS_ENFORCE=1` key zorunlu (default off = tek-kullanıcı geriye-uyum). ctxFactory tenant ise plan.allowed_tiers + metering. Admin: `/api/saas/{plans,tenants,keys,keys/:id/revoke}` (`SAAS_ADMIN_TOKEN` guard). **Metering hook canlı** (`onUsage`→`recordUsage`). Kanıt (:3940 SAAS_ENFORCE): keysiz `/mcp`=401; free-key listTools=15 safe tool (host/privileged filtre); `git_commit` (host) "not permitted"; usage_events satırı yazıldı.
- **Faz 4 (billing):** `server/billing/stripe.ts` — `aggregateUsage` ay-bazlı tenant rollup → `computeRun`/`runBilling` Stripe metered events + invoice satırı; Stripe LAZY + `STRIPE_API_KEY` yoksa **dry-run** (sıfır billing config ile çalışır). `handleWebhook` imza-doğrulamalı (raw-body mount, plan değişimi→`setTenantPlan`). Endpoint: `/api/billing/{preview,run,webhook}` + tenant `/api/saas/usage`. stripe@22.2.1. Kanıt (:3941 pro-key): 3× read_file → usage `used:3`; preview `dryRun:true total:3`; run invoice yazdı. **Tüm 5 faz E2E doğrulandı; ollamas artık MCP gateway + tools-as-SaaS.**

## Faz 9 — E2E sertleştirme (Faz 5: fix + test + UI + docs)
- **Ne:** 3-ajan audit'in flag'lerini düzelt, ilk commit'li otomatik test suite, SaaS admin UI, portability/docs.
- **5A fix (tüm flag'ler):** HOST_TOOLS_DIR env-override (hardcoded abs yol → portability); rate-limit Map bounded + idle-TTL eviction (DoS); adminGuard SAAS_ENFORCE=1 iken token ZORUNLU + timing-safe compare; Stripe gerçek `stripe_customer_id` (kolon+idempotent migration); invoice idempotency; agent-loop metering ("local" tenant); consume `isError` → ok=false; sqlite ek index; orchestrator dürüst "legacy-cluster-stub"; `MCP_AUTO_APPLY` env.
- **5B test (hermetik, vitest):** tool-registry (tier gating/halt/onUsage/register), saas-store (tenant/key/resolve/revoke/usage/aggregate/invoice-idempotency/auth/rate-limit), mcp-gateway.e2e (**self-boot** server: keysiz 401, free=15 tier filtre, bad-admin 401, stdio consume ping→pong); ClusterE2ELive `RUN_LIVE_E2E` gate. **31 passed / 1 skipped.**
- **5C UI:** `src/components/SaaSAdmin.tsx` — admin-token, plan/tenant/key/usage/billing/gateway paneli; App tab "SaaS Gateway". vite build yeşil; canlı endpoint doğrulandı (key metadata-only).
- **5D docs:** `.env.example` 9 SaaS var; README "MCP Gateway + tools-as-SaaS" bölümü (claude mcp add, plan tier'leri, billing); docker-compose HOST_TOOLS_DIR + SaaS env + saas.db volume notu; start.sh HOST_TOOLS_DIR export; AGENTS.md §7 roadmap ✅.
- **Niçin:** "interaktif en verimli yöntem" = otomatik E2E ile flag tespit→fix→kanıt; ollamas artık test-korumalı + UI'lı + dökümante MCP-gateway/SaaS.

## Faz 10 — Araştırma-temelli spec-uyum + güvenlik (Faz 6)
- **Ne:** 3-ajan WEB araştırması (MCP spec 2025-06/11, RFC 9728/8707, MCP güvenlik best-practice, Stripe meter) → somut gap'ler → fix + E2E test + gerçek-zamanlı kanıt.
- **6A spec-uyum:** RFC 9728 `/.well-known/oauth-protected-resource` (`server/mcp/oauth-metadata.ts`); 401'de `WWW-Authenticate` resource_metadata; `/mcp` Origin allowlist (DNS-rebinding); tool annotations (readOnly/destructiveHint tier'den).
- **6B consume güvenlik:** `host_upstream` untrusted tier (default expose DIŞI = tenant'a default-deny); per-upstream `allowedTools` + isim-çakışma blok; output sanitization (prompt-injection); manifest SHA-256 (rug-pull tespiti).
- **6C audit:** `audit_events` tablosu + choke-point onUsage host/privileged/upstream kaydı + `GET /api/saas/audit` (admin).
- **6D token metering:** `providers.ts` GenerateResult.tokens (ollama eval_count); ReAct loop `usage_events tool=__llm__`; aggregate token toplar.
- **Kanıt:** tsc temiz; **41 passed / 1 skipped** (yeni: mcp-compliance e2e, consume-security, audit, token-aggregate). Canlı: metadata JSON, 401+WWW-Authenticate header, bad-Origin 403. Commit f26fdb0.
- **Backlog (dürüstçe ertelendi):** tam OAuth 2.1 server + RFC 8707 audience · Redis dağıtık rate-limit · host-bridge HMAC/TLS · per-call Stripe meter. (AGENTS.md Backlog.)

## Faz 11 — main'e merge (PR)
- **Ne:** `feat/mcp-gateway-saas` (10 commit, Faz 0-6) main'e merge.
- **Ship kapısı:** tsc temiz · vitest 41 pass/1 skip · vite build yeşil.
- **eCy-coding/ollamas:** PR #1 → MERGED (merge commit `2406767`); local+remote main senkron. (https://github.com/eCy-coding/ollamas/pull/1)
- **adobemre1/ollamas:** BLOK — repo'lar GitHub'da fork-linked değil (bağımsız) → cross-repo PR reddedildi; ayrıca yazma yetkisi yok (pull-only). Merge/PR mevcut yetkiyle MÜMKÜN DEĞİL. Çözüm: adobemre1 yazma izni ver VEYA fork-network kur.
- **Niçin:** Faz 0-6 canonical repo'ya (eCy-coding) indi; ollamas artık main'de MCP-gateway + tools-as-SaaS.

## Faz 12 — v1.0 Production-Ready GA (Faz 9, fallback-first)
- **Ne:** prototipten dağıtılabilir ürüne. 3-ajan WEB araştırması (MCP/OAuth spec, Stripe prod, deploy/CI/sec — cited) → prod-gap'ler → fix. Branch `feat/v1.0-ga`. Karar: tüm alt-faz + fallback-first (dış secret yok, secret girilince auto-live).
- **9A güvenlik** (`5baf828`): GCM authTagLength=16 pin + short-tag reddi (db/backup), path-traversal guard (commander), Dockerfile non-root nodeapp, helmet, justified nosemgrep.
- **9B auth** (`9d820ff`): api_keys expires_at/last_used + ttl/scopes; dual-path auth (opaque `olm_` + OAuth JWT/JWKS jose, audience RFC 8707); `tools:<tier>` scope enforcement.
- **9C rate-limit+billing** (`d43d623`): ioredis Lua token-bucket + in-memory fallback; Stripe Meter/Price/Customer otomasyon + portal/checkout + webhook event.id dedup + invoice/subscription handler.
- **9D observability** (`7a84195`): prom-client `/metrics` (http latency + `mcp_tool_calls_total`), pino + pino-http, `/api/ready`.
- **9E per-tenant upstream** (`7fb3ab4`): `upstream_servers` tablo + CRUD `/api/saas/upstreams` + namespaced host_upstream merge + boot reconnect.
- **9F CI+UI+docs:** GitHub Actions CI (tsc+vitest+build, Node 22/24); SaaS UI audit viewer + mount-nit fix; README v1.0 + AGENTS roadmap + .env.example.
- **Kanıt:** tsc temiz; **52 passed/1 skipped** (registry/store/auth/rate-limit/billing/audit/upstream/observability); vite build yeşil. 6 yeni dep (jose/ioredis/prom-client/pino/pino-http/helmet) runtime-opsiyonel.

## Faz 13 — v1.1 (gateway ürününü tamamla, branch feat/v1.1)
- **Ne:** v1.0 prod-hazır üzerine tam ürün yüzeyi. 3-ajan WEB araştırması (MCP resources/prompts/pagination/progress, Stripe realtime + OpenAPI, K8s/GHCR/HMAC — cited). v1.0 PR #2 main'e merge (`183860a`), v1.1 main'den.
- **10A tam MCP** (`58c2ffe`): per-tenant tool görünürlük izolasyonu (`list(tiers,tenantId)`), ListTools cursor pagination, `resources/list`+`read` (workspace file://), progress notifications (`_meta.progressToken`).
- **10B self-serve + realtime billing** (`fb78ec5`): `/api/saas/self/{usage,keys}` + `/api/saas/usage/timeseries` (scope-gated), per-call async `sendMeterEventAsync` (best-effort, no-op'suz key).
- **10C OpenAPI** (`b6fe381`): `server/openapi.ts` 3.1 spec + `/api/openapi.json` + `/api/docs` Swagger UI.
- **10D deploy** (`1a6846c`): `.github/workflows/publish.yml` GHCR (tag v*) + `deploy/k8s/` (Deployment/Service/CM/Secret/HPA/PDB) + README (host-bridge K8s-çalışmaz caveat).
- **10E bridge HMAC**: `server/bridge-hmac.ts` (canonical) + `terminal-bridge.mjs` verify (±5dk freshness + nonce dedup + timingSafeEqual); `HOST_BRIDGE_HMAC_SECRET` yoksa token geriye-uyum.
- **Kanıt:** tsc temiz; **63 passed/1 skipped** (yeni: tenant-isolation, resources e2e, self-serve scope, timeseries, openapi e2e, HMAC roundtrip+stale+replay). 3 yeni dep swagger-jsdoc/swagger-ui-express.

## Faz 14 — v1.2 (protokol + ekosistem, branch feat/v1.2, zero-dep)
- **Ne:** v1.1 üzerine düşük-risk completer'lar. 3-ajan WEB araştırması (MCP prompts/completion, Svix/Stripe webhook, recharts-vs-SVG+Helm+release-please — cited). v1.1 PR #3 main'e merge (`488b323`). Postgres v1.3'e ertelendi (sync→async store refactor riski).
- **11A MCP prompts** (`fd049ce`): `server/mcp/prompts.ts` architect/coder/reviewer → prompts/list+get + completion/complete (language/focus enum). Capabilities {tools,resources,prompts,completions}.
- **11B webhooks** (`b603efe`): `webhooks`+`webhook_deliveries` tablo + `server/webhooks/outbound.ts` (Stripe-uyumlu `t=,v1=` imza + retry 0/1m/10m/1h/12h + dead-letter + worker); fire: key.created/revoked/quota_exceeded/subscription.updated; CRUD `/api/saas/webhooks`.
- **11C dashboard** (`77fdf88`): SaaSAdmin self-service paneli — pure-SVG usage sparkline + webhooks CRUD + upstreams + billing portal butonu (tenant-key ile).
- **11D Helm + release-please:** `deploy/helm/ollamas/` (helm template → 6 kaynak OK) + `.github/workflows/release-please.yml` (conventional commit→semver→tag→GHCR).
- **Kanıt:** tsc temiz; **67 passed/1 skipped** (yeni: mcp-prompts e2e, webhook sign/verify+canlı-deliver+fan-out); vite build yeşil; helm render OK. **SIFIR yeni npm dep.**

## Faz 15 — v1.3 (Postgres + async-store, multi-replica scale, branch feat/v1.3)
- **Ne:** v1.2'de bilinçli ertelenen TEK büyük mimari iş. node:sqlite (sync, tek-dosya) çok-replica K8s'i bloklar. Birleşik async store (sqlite default + Postgres opt-in) → yatay ölçek. Araştırma (cited): node-postgres pool/param, `FOR UPDATE SKIP LOCKED` job-queue, sqlite WAL+RETURNING, GitHub Actions pg service. v1.2 PR #4 main'e merge → `feat/v1.3`. `npm i pg @types/pg`.
- **12A adapter:** `server/store/db-adapter.ts` — `DbClient {query,run,exec}`; `SqliteAdapter` (DatabaseSync sync→`Promise.resolve`) / `PostgresAdapter` (pg Pool, `?`→`$n` rewrite); `createAdapter()` `DATABASE_URL` → pg, yoksa sqlite. Dialect-aware DDL: `AUTOINCREMENT`↔`GENERATED ALWAYS AS IDENTITY`, PRAGMA yalnız sqlite.
- **12B async dönüşüm:** 36 store export → `async`/`await d().query/run`; 5 caller (auth/rate-limit/billing/server.ts ~24 site/webhooks) + test suite `await`. tsc-rehberli (await eksiği = derleme hatası). pg coercion: COUNT/SUM string→`Number()`, mixed-case alias çift-tırnak (pg lowercase-folding gotcha).
- **12C multi-replica worker:** `claimDeliveries(limit)` — pg `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`; sqlite per-call unique claim-token (`claimed_<rand>`) → iki paralel worker disjoint satır seçer, çift-teslimat YOK. Test: 2 paralel `processDeliveries` × 3 event → receiver tam 3.
- **12D CI+docker+docs:** ci.yml matrix `db:[sqlite,postgres]` × Node 22/24 + `postgres:17` service; docker-compose `postgres` profili + pgdata volume; `.env.example` DATABASE_URL/DB_POOL_SIZE; README "v1.3" + AGENTS Faz 12 ✅.
- **Kanıt:** tsc temiz; **sqlite 68 passed/1 skipped** + **Postgres (yerel pg:17, DATABASE_URL set) 68 passed/1 skipped** — aynı suite iki dialect'te yeşil, e2e self-boot pg üzerinde dahil. **Yeni dep: `pg` (yalnız DATABASE_URL set ise Pool açar).**

## Faz 16 — v1.4 (Production Operations Hardening, branch feat/v1.4, zero-dep)
- **Ne:** v1.3 pg async store'u ekledi ama işletilebilirlik katmanı eksikti. İki Explore audit (bayraklı, kanıtlı) somut prod-bloklayıcı buldu: graceful shutdown YOK, versiyonlu migration YOK (sadece sqlite ALTER), readiness pg-ping etmiyor, K8s DATABASE_URL Secret + migration hook YOK. v1.4 = bu 4 boşluğu kapat → v1.3'ün multi-replica vaadi gerçekten dağıtılabilir. v1.3 PR #5 main'e merge (`c19a0b6`) → `feat/v1.4`. **SIFIR yeni dep** (node builtin + mevcut `pg`).
- **13A graceful shutdown:** `DbClient.close()` (sqlite `raw.close` / pg `pool.end`) + `closeStore()` + `outbound.stopWebhookWorker()`; `server.ts` `app.listen`→handle + `SIGTERM`/`SIGINT` → server.close + worker stop + `SHUTDOWN_GRACE_MS` (10s) drain + closeStore + exit 0; çift-sinyal guard + force-timeout exit(1).
- **13B versiyonlu migrations:** `server/store/migrations.ts` — append-only `MIGRATIONS[]` + `schema_migrations` tablo; `runMigrations(db)` advisory-lock'lu (`db.withLock` → pg `pg_advisory_lock` dedicated client / sqlite no-op) runner, `initStore` sonunda; baseline DDL = v0, sonraki evrim migration kaydından (initStore DDL düzenlenmez). `--migrate-only` boot mode (K8s Job/Helm hook). v1 örnek: `idx_usage_events_ts`.
- **13C gerçek readiness:** `pingStore()` (`SELECT 1`, throw-yutar); `/api/ready` workspace + DB ping → 503 pg-down; `/api/health` `db:up/down` report-only (liveness'a bağlı değil); boot log dialect+poolSize.
- **13D ops:** K8s `migration-job.yaml` (`command: tsx server.ts --migrate-only`, restartPolicy Never) + `terminationGracePeriodSeconds:30` + `DATABASE_URL`/`DB_POOL_SIZE`/`SHUTDOWN_GRACE_MS` Secret/ConfigMap; Helm `templates/migration-job.yaml` (pre-install/pre-upgrade hook + hook-delete-policy) + values (DATABASE_URL/migration.enabled/terminationGrace) + Chart appVersion 1.4.0/version 0.2.0; compose `stop_grace_period:30s`. Migration app içinden koşar → image'da psql gerekmez. helm template + k8s YAML valid.
- **13E test:** `tests/lifecycle.test.ts` (7 case: pingStore up/down/re-init, closeStore idempotent, baseline migration kayıtlı, runMigrations idempotent 2.run boş, MIGRATIONS unique+monoton); SIGTERM canlı self-boot turu.
- **Kanıt:** tsc temiz; **sqlite 75/1** + **Postgres (yerel pg18) 75/1 ×2 paralel** (advisory-lock deterministik); canlı SIGTERM → `clean exit` 0 + port freed; `--migrate-only` pg'de `schema_migrations` v1 kaydı; helm/k8s render valid. **SIFIR yeni dep.**

## Faz 17 — v1.5 (MCP Protocol Completeness + Observability Depth, branch feat/v1.5, zero-dep)
- **Ne:** Ürün kimliği = MCP gateway. v1.0-v1.4 SaaS/ops'u tamamladı; sıradaki kaldıraç MCP spec yüzeyi + multi-replica gözlemlenebilirlik. 2 Explore audit (`fork/main`=617fefb okundu) zero-dep gap buldu: capabilities boş ilan, `logging` YOK, `/metrics` sığ. v1.4 PR #6 merge (`617fefb`) → `feat/v1.5`. **SIFIR yeni dep.** Sampling/roots/elicitation/resource-subscribe = bilinçli backlog (stateless transport + "gateway ≠ LLM proxy").
- **14A MCP logging + dürüst capabilities:** `server/mcp/server.ts` — capabilities `{tools:{listChanged:false},resources,prompts,completions,logging:{}}`, server 1.5.0; `SetLevelRequestSchema` handler (RFC 5424, per-connection level, `MCP_LOG_LEVEL` taban); choke-point'te `emitLog(level,data)` → `notifications/message` (rank-gated; host/privileged `notice`, sonuç `info`/`error`), CallTool'da await'li yayım.
- **14B tool outputSchema + structured content:** `ToolSchema.function.outputSchema?` (`tool-registry.ts`) + `ToolRegistry.info(name)`; ListTools `outputSchema` ilan eder (tanımlıysa); CallTool obje çıktıda `structuredContent` döner (text bloğu korunur). *(completion tool-arg DROP edildi — MCP `complete` ref'i yalnız prompt/resource, ref/tool spec-dışı.)*
- **14C observability depth:** `server/metrics.ts` — `shutdownTotal` counter + `registerStoreMetrics()` (idempotent) async-collect gauge'lar: `ollamas_db_pool_connections{state}` (pg), `ollamas_migration_version`, `ollamas_webhook_queue_depth`. Store accessors `poolStats()` (adapter `stats()`: pg pool sayaçları / sqlite null) + `migrationVersion()` + `pendingDeliveryCount()`. server.ts boot'ta register + SIGTERM'de `shutdownTotal.inc()`.
- **14D test:** `tests/mcp-gateway.e2e.test.ts` +2 (logging capability+setLevel; /metrics yeni seriler); `tests/observability.test.ts` (5 case: migrationVersion, poolStats dialect-aware, pendingDeliveryCount, gauge scrape, register idempotent).
- **Kanıt:** tsc temiz; **sqlite 81/1** + **Postgres (yerel pg18) 81/1**; MCP client `logging` capability + `setLevel` no-error; `/metrics` yeni seriler. **SIFIR yeni dep.** **GOTCHA:** stateless Streamable HTTP server→client `notifications/message` teslimi best-effort (test soft-assert); prom-client gauge double-register throw → `registerStoreMetrics` idempotent guard.

## Faz 18 — v1.6 (MCP Ecosystem Interop + Auth Completeness, branch feat/v1.6, zero-dep)
- **Ne:** GitHub'da eşleşen TAMAMLANMIŞ projeler e2e arandı (resmi `modelcontextprotocol/registry`, IBM/mcp-context-forge, lacausecrypto/mcp-conduit, docker/mcp-gateway, MCP Auth spec 2025-11-25). Proven spec/registry kodundan adopte (sıfırdan icat yok). v1.5 PR #7 merge (`3dd2aff`) → `feat/v1.6` fork/main'den. **SIFIR yeni dep.** Kapsam (Emre): Interop + DCR · yayın yayına-hazır (gerçek public push YOK).
- **15A discovery + manifest:** repo-kökü `server.json` (resmi format, schema `2025-12-11`, reverse-DNS `io.github.eCy-coding/ollamas`, `remotes[streamable-http]`); `server/mcp/discovery.ts` → `GET /.well-known/mcp.json` (name/version/protocolVersion/transport/capabilities/auth/primitives); tek `MCP_SERVER_NAME`/`MCP_SERVER_VERSION`/`MCP_PROTOCOL_VERSION`/`MCP_CAPABILITIES` const (`server/mcp/server.ts`, 1.5.0→1.6.0) — discovery + handshake aynı kaynaktan (drift-guard). `MCP_PUBLIC_URL` ile remote URL pin (yoksa req'ten türet).
- **15B OAuth 2.1 DCR (RFC 7591):** `server/store/index.ts` `registerClient()` (`oc_` client_id, confidential `ocs_` secret / public `none` secretsiz, `rat_` registration token; secret/token yalnız sha256, plaintext bir kez döner) + migration v2 `oauth_clients` (text-PK, dialect-agnostik); `server.ts` public `POST /register` (pre-auth, rate-limited, `DCR_INITIAL_ACCESS_TOKEN` Bearer gate, non-array redirect_uris→400); `oauth-metadata.ts` `buildAuthServerMetadata` (RFC 8414) + `GET /.well-known/oauth-authorization-server` + RFC 9728 `authorization_servers` self-point.
- **15C test + docs:** `tests/discovery.test.ts` (server.json required-field + reverse-DNS + manifest↔VERSION + mcpDiscovery capabilities==MCP_CAPABILITIES drift-guard); `tests/dcr.test.ts` (registerClient confidential/public/default-grant, getClient secret-sızdırmaz, migration v2 recorded+idempotent, AS-metadata, iki dialect); `tests/mcp-gateway.e2e.test.ts` +4 (mcp.json pre-auth, AS-metadata, /register 201, non-array 400). README v1.6 + AGENTS Faz 15 ✅ + `.env.example` MCP_PUBLIC_URL/DCR_INITIAL_ACCESS_TOKEN + `.github/workflows/registry-publish.yml` (validate-only, real push disabled).
- **Kanıt:** tsc temiz; **sqlite 99/1** + **Postgres (yerel pg18) 99/1** (+18 test); vite build; 5-uçlu canlı self-boot turu (mcp.json 22 tool/3 prompt, AS metadata, protected-resource, DCR confidential+public). **SIFIR yeni dep.** **Sınır:** DCR yalnız client-metadata kaydı (token issuance = tam OAuth 2.1 AS, backlog); gerçek registry push dışa-dönük → ayrı onaylı adım.

## Faz 17–19 — v1.7→v1.10 (özet; tam detay AGENTS.md §7 Yol Haritası)
- Bu defter v1.6'da donmuştu; v1.7 (interceptor hardening) → v1.8 (bench/power tool) → v1.9 (sampling+elicitation) → v1.10 (OAuth 2.1 AS) faz logları **AGENTS.md §7**'de + commit history'de tutuldu (drift-not). İleriye tek-kaynak AGENTS roadmap.

## Faz 20 — v1.11 (MCP Protocol Polish: Roots + Abort-to-Host, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** İki MCP protokol-olgunluk eksiği kapatıldı. OSS e2e arandı → çalışan-kod adopte: SDK `ListRootsRequestSchema`/`callTool({signal})` (mevcut `@modelcontextprotocol/sdk`) + Node stdlib `AbortSignal.any`. **SIFIR yeni dep** (rubric 12/12; el-yazımı abort-wrapper + yeni iptal-kütüphanesi elendi).
- **Nasıl:** 20A consume-side **roots** — Client `roots:{listChanged:false}` capability + `ListRootsRequest` handler (`server/mcp/client.ts`) workspace kökünü (`db.data.workspacePath`→`file://`) döner (boşsa `{roots:[]}`). 20B **abort-to-host** — `host-bridge.ts` `combineSignal` = `signal?AbortSignal.any([signal,timeout]):timeout`; `runOnHostTerminal`/`execOnHost`/`writeHostFile` + `ToolDeps` opsiyonel `signal?`; 10 uzun-süren host tool invoke'una `ctx.abortSignal` thread; upstream `callTool(...,{signal})`. Hızlı tool'lar + server.ts/mcp-stdio wiring değişmedi (opsiyonel param = geriye-uyum).
- **Niçin:** Ürün kimliği = MCP gateway → spec yüzeyi (roots = upstream'e sandbox sinyali) + gerçek iptal (CancelledNotification artık host fetch'i keser, kendi timeout'una kadar sürmez = kaynak israfı yok).
- **Kanıt:** tam suite **150 passed/2 skipped** (+6: 2 consume-roots + 3 abort-forward spy + 1 combineSignal); tsc temiz; vite+server+stdio bundle; `conformance:stdio` tools/list OK.
- **Sonraki (önceden hesaplandı):** v1.12 — OAuth refresh + RFC 9700 rotation (migration v4) · client_credentials grant · expose-side roots (client root'larını okuyup FS-tool scope) · resource subscriptions.

## Faz 21 — v1.12 (Abort Propagation E2E + Federated Roots Aggregation, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** v1.11'in iki desenini uçtan uca tamamladı. **0 yeni dep** (SDK `ListRootsResultSchema` + Node stdlib `AbortSignal.any`). Çoklu-worker: kod paralel sekme tarafından yazılmıştı; tutarlı + gate-yeşil olduğu için **additive tamamlandı** (test + docs eklendi, 4 dosya rewrite edilmedi) — clobber yok.
- **Nasıl:** 21A **abort propagation** — `server.ts` ReAct SSE loop `AbortController` + client-disconnect (`req/res.on("close")→abort`) → `ProviderRouter.generate(...,signal)` + `buildSignal=AbortSignal.any([caller,timeout300s])` 5 provider'a + tool `ctx.abortSignal`; `AbortError`→graceful `res.end()`. 21B **federated roots** — `client.ts` connect-sonrası upstream `roots/list` çeker → `upstreamRoots` (never-throw) + `getFederatedRoots()` `<server>:<name>`; `mcp/server.ts` `roots:{}` capability + `roots/list`=workspace+federated.
- **Niçin:** İptal artık client'tan LLM+tool+loop'a kadar gerçekten propage olur (kaynak israfı yok); federation görünürlüğü için upstream root'ları expose'da agrege edilir (sandbox sinyali zinciri).
- **Kanıt:** tam suite **163 passed/2 skipped** (+2 federated-roots: agrege + graceful-boş; ilk full-run'da conformance inspector "fetch failed" **flaky**→izole 3/3 + re-run temiz, env-level port, regresyon değil); tsc temiz; conformance:stdio exit 0; vite+server+stdio bundle. Abort yolu = v1.11 birim testleri + e2e kod-yolu (providers `buildSignal` modül-private, sessiz-skip yok — dürüst not).
- **Sonraki (önceden hesaplandı):** v1.13 — OAuth refresh + RFC 9700 rotation (migration v4) · client_credentials grant · resource subscriptions · expose-side sampling-to-tool.

## Faz 22 — v1.13 (OAuth Refresh-Token Rotation [RFC 9700] + Client-Credentials Grant, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** OAuth 2.1 AS'i M2M + uzun-oturum için tamamladı. **0 yeni dep** — SDK `mcpAuthRouter` refresh_token grant'ı zaten provider'a yönlendirir; rotation deseni RFC 9700 + node-oidc-provider (MIT) fikir-port; stdlib `crypto.timingSafeEqual`/`randomUUID`.
- **Nasıl:** 22A **refresh+rotation** — migration v4 `oauth_refresh_tokens` (`family_id`+`used`); `saveRefreshToken`/`rotateRefreshToken`/`revokeRefreshFamily`/`refreshFamilyOf`; `exchangeAuthorizationCode`→access+refresh (14g, yeni family), `exchangeRefreshToken`→her kullanımda rotate (aynı family yeni çift), **used replay→family revoke (reuse detection)**, scope yalnız daralır, `revokeToken`→access+family; DCR default grant_types+=refresh_token. 22B **client_credentials** — `verifyClientSecret` (timing-safe) + `mcpAuthRouter`-öncesi `/token` pre-route (SDK reddeder) → confidential+tenant-bound+grant-allowed→access (refresh yok), else `invalid_client`/`unauthorized_client`; diğer grant'lar SDK'ya pass-through.
- **Niçin:** Refresh = kısa-ömürlü access + güvenli yenileme (çalınan token RFC 9700 ile tespit→family çöker); client_credentials = sunucu-sunucu (M2M) entegrasyon, ürünün SaaS-gateway kimliği.
- **Kanıt:** gerçek suite **173 passed/2 skipped** (+10: 7 refresh store+provider, 3 cc self-boot e2e); tsc temiz; conformance:stdio exit 0; vite+server+stdio bundle. **NOT:** tam-tarama 1 fail = `.claude/worktrees/agent-*/ClusterE2ELive.test.ts` (BAŞKA lane'in subagent-worktree'si, `/api/cluster` relative-URL kendi bug'ı) — MCP scope DIŞI, regresyon değil; `--exclude '**/.claude/**'` ile gerçek suite 0-fail.
- **Sonraki (önceden hesaplandı):** v1.14 — expose-side sampling'i somut tool'a bağlama · resource subscriptions (stateless transport sınırı) · (OAuth tarafı tam: authcode+PKCE+refresh-rotation+client_credentials).

## Faz 23 — v1.14 (Expose-Side Sampling Tool, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** Bidirectional sampling'i tamamladı — `ctx.onSample` köprüsü (Faz 18A) vardı ama hiçbir tool kullanmıyordu. **0 yeni dep** (SDK `ctx.onSample`→`server.createMessage`).
- **Nasıl:** `server/tool-registry.ts` yeni **safe-tier** `sample` tool: `{prompt,system?,maxTokens?}` → `ctx.onSample` → bağlanan client'ın LLM cevabı. Capability yoksa graceful notice (throw yok). safe = ollamas kaynağı harcamaz (caller'ın modeli); çıktı caller'ın kendi LLM'i → sanitize yok. **No-half:** tool ekleme yan-etkisi → built-in 22→23 + free-plan safe 15→16, **3 sayı assertion** güncellendi (tool-registry / mcp-gateway-e2e / **mcp-stdio-e2e — checklist'te kaçmıştı, grep-tarama ile yakalandı**).
- **Niçin:** Simetri — v1.9 ollamas-CLIENT upstream sampling'i cevaplar (consume), v1.14 ollamas-SERVER bağlanan client'ın LLM'ini bir tool ile kullanır (expose). Gateway'in iki yönlü MCP yüzeyi tam.
- **Kanıt:** gerçek suite **177 passed/2 skipped** (+4: 3 sample unit + 1 sample-stdio e2e [sampling-capable client→callTool→client-LLM cevabı, bidirectional]); tsc temiz; conformance:stdio exit 0; vite+server+stdio bundle.
- **Sonraki (önceden hesaplandı):** v1.15 — **resource subscriptions** (ERTELENDİ gerekçe: stateless Streamable-HTTP server per-request kuruluyor → subscription state kalıcı değil + güvenilir server→client teslimat yok [v1.5 dersi] + fs.watch infra; yarım kurmaktansa belgelendi). Alternatif aday: host-bridge token TTL/TLS.

## Faz 24 — v1.15 (Per-Tenant Upstream Tool Isolation — CRITICAL güvenlik fix, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** Kritik-gap audit ile bulunan çok-tenant güvenlik açığını kapattı. **0 yeni dep** (explicit OWNERS map, integrations-lane v2.3 ispatlı deseni).
- **Açık (kök-neden):** Per-tenant upstream tool'ları `mcp__<tenantId>_<srv>__<tool>` adıyla kayıtlıydı ama (1) `list()` filtresi `mcp__tnt_` prefix bekliyordu → gerçek adla hiç eşleşmez → **tüm tenant'lara görünür**; (2) `execute()` owner-gate içermiyordu → **görünürlük≠yetki**: tenant B, A'nın tool adını tahmin edip invoke edebiliyordu. Faz 9E (per-tenant upstream storage) yarım kalmıştı.
- **Nasıl:** `tool-registry.ts` `OWNERS` Map (toolName→tenantId) + `register(name,def,owner?)` + `list` owner-gate (`!o||o===tenantId`, kırık prefix-filtre KALDIRILDI) + **`execute` deny-by-default** (owner≠ctx.tenantId → `tool_not_permitted`, emit(false)) + `unregisterByPrefix` OWNERS temizler. `client.ts` `connectUpstream(cfg,owner?)`+`connectAllUpstreams(...,owner?)`. `server.ts` global tools.json **ownerless**, per-tenant store upstream **owner=tenant_id** (boot + runtime POST, mevcut adlandırma korundu → delete-path kırılmadı).
- **Niçin:** Ürün hedefi = üretim çok-tenant SaaS gateway → cross-tenant tool erişimi kabul edilemez. deny-by-default = güvenlik temel ilkesi.
- **Kanıt:** gerçek suite **179 passed/2 skipped** (+2 upstream-isolation: owner-visibility + cross-tenant-deny + unregister-cleanup); tsc temiz; conformance:stdio exit 0; vite+server+stdio bundle. Eski "Faz 10A name-convention" testi owner-gate semantiğine güncellendi (no-half).
- **Prevention (RISK-MCP):** Görünürlük filtresi ASLA tek başına erişim-kontrolü değildir → her per-tenant kaynak `execute` choke-point'inde deny-by-default gate'lenir. İsim-konvansiyonuyla izolasyon YASAK → explicit owner map.
- **Sonraki (önceden hesaplandı):** v1.16 — RFC 8707 resource-binding enforcement (`/mcp`'de token.resource vs request-URI; çok-resource deploy için). v1.17 — resource subscriptions.

## Faz 25 — v1.16 (RFC 8707 Resource-Binding Enforcement — HIGH güvenlik fix, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** Opaque OAuth token audience-confusion açığını kapattı. **0 yeni dep** (JWT-audience deseni opaque path'e simetrik + stdlib URL).
- **Açık (kök-neden):** `auth.ts resolveOAuth` `resolveOAuthToken`'dan `resource`'u alıyordu ama **doğrulamıyordu** (audience-drop) → resource-A için basılan `ot_` token resource-B'de geçerli (cross-resource reuse / confused-deputy). JWT path `:60-62` audience'ı enforce ediyordu → asimetri.
- **Nasıl:** `canonicalResource(u)` (URL normalize + trailing-slash strip) + `resolveOAuth(token, expectedResource)`: `r.resource` non-null & `canonical` eşleşmezse → null (401 invalid_token); null-resource → kısıtsız (geriye-uyum). Çağrı `resolveOAuth(key, OAUTH_AUDIENCE || \`${base}/mcp\`)` — JWT path ile AYNI beklenen-resource (iki path tutarlı).
- **Niçin:** RFC 8707/9728 + MCP 2025-06-18 — token bir resource-server'a bağlıysa başkasında kullanılamaz (üretim çok-resource SaaS güvenliği).
- **Kanıt:** gerçek suite **183 passed/2 skipped** (+4 oauth-resource-binding: match→auth, mismatch→401, null→backward-compat, trailing-slash-canonical); tsc temiz; conformance:stdio exit 0; bundle. Regresyon yok (cc/refresh resource göndermez→null→geçer; api-key path ayrı).
- **Prevention (RISK-MCP):** Token'ın audience/resource alanı SAKLANIYORSA resolve'da MUTLAKA enforce edilmeli (saklamak≠doğrulamak); tüm token-türleri (JWT+opaque) aynı beklenen-resource kaynağını kullanmalı.
- **Sonraki (önceden hesaplandı):** v1.17 — resource subscriptions (stdio-stateful path; stateless-HTTP best-effort belgeli). OAuth tarafı artık tam (authcode+PKCE+refresh-rotation+client_credentials+resource-binding+tenant-isolation).

## Faz 26 — v1.17 (OAuth Token Retention / Expired-Row GC, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** Üretim lifecycle defekti — OAuth AS expired satırları (codes/tokens/refresh) süresiz birikiyordu → tablo şişmesi. **0 yeni dep** (standart GC deseni + webhook-worker scheduler + nowIso).
- **Nasıl:** `store.purgeExpiredOAuth()` = 3× `DELETE WHERE expires_at < now` (`{codes,tokens,refresh}` sayı döner, iki-dialekt ISO-compare). `server/oauth-gc.ts` `startOAuthGc` (boot'ta bir-kez-hemen + `OAUTH_GC_INTERVAL_MS||1h` interval, `unref`, never-throw) / `stopOAuthGc`. server.ts: boot `startWebhookWorker` yanı + SIGTERM shutdown `stopWebhookWorker` yanı (timer sızıntısı yok).
- **Niçin:** Üretim SaaS gateway = sınırsız token-issuance → GC olmadan DB sonsuz büyür. Operasyonel zorunluluk.
- **Kanıt:** gerçek suite **185 passed/2 skipped** (+2 oauth-gc); tsc temiz; conformance:stdio exit 0; bundle; graceful-shutdown regresyon yok.
- **Güvenlik invariant (kritik):** SADECE `expires_at < now` silinir → used-ama-**unexpired** refresh KORUNUR → RFC 9700 reuse-detection penceresi (=14g TTL) bozulmaz (test ile kanıtlı). revoked-unexpired token: resolveOAuthToken `revoked=0` zaten filtreler, expire'da GC'lenir.
- **Atlanan (gereksiz, kanıtla):** token-endpoint rate-limit (`rateLimitMiddleware:85 !t→next()` = pre-auth no-op; 192-bit secret brute-force-infeasible; DoS infra-katmanı) · gcm:1705 (false-positive: self-test + setAuthTag mevcut + tam tag).
- **Prevention (RISK-MCP):** Süreli her tablo (token/code/session) bir retention-sweeper ister; sweeper YALNIZ expired siler (aktif güvenlik-pencerelerini bozma).
- **Sonraki (önceden hesaplandı):** v1.18 — resource subscriptions (stdio-stateful; stateless-HTTP best-effort belgeli). OAuth AS artık üretim-tam (authcode+PKCE+refresh-rotation+client_credentials+resource-binding+tenant-isolation+GC).

## Faz 27 — v1.18 (Consume-Side Upstream Resilience — federation supervisor, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** consume-side connect-once → resilient federation. **0 yeni dep** (integrations-lane ispatlı `supervisor.ts` adopte — VIBE değil, en-güvenilir eşleşen kaynak = kendi projemiz; LibreChat MCP_CB_* + IBM backoff desen).
- **Açık (kök-neden):** `client.ts` upstream'e bir kez bağlanıp bırakıyordu; reconnect/health/circuit-breaker yoktu → upstream ölünce tool'ları süresiz fail (manuel restart'a dek).
- **Nasıl:** 27A `client.ts` `pingUpstream`/`disconnectUpstream`/`toolNames`. 27B `supervisor.ts` `superviseUpstream(cfg,owner?)` + `tickOnce` (connected→ping; degraded→due-reconnect; circuit→cooldown re-arm) + `computeBackoff` (exp+cap) + `schedule` (MAX_CYCLES→circuit) + status/collisions/remove + `startSupervisor`(opt-in `MCP_HEALTH_INTERVAL_MS`, unref)/`stopSupervisor`. 27C `server.ts` boot supervise (global ownerless + per-tenant owner) + start + runtime POST/DELETE→supervise/remove + `/upstreams/status` + SIGTERM stop.
- **Niçin:** Federation gateway üretimde upstream dalgalanmalarına dayanmalı; tek choke-point korunur (supervisor connectUpstream/ToolRegistry sürer, ikinci dispatch yok).
- **Kanıt:** gerçek suite **197 passed/2 skipped** (+8 upstream-supervisor); tsc temiz; conformance:stdio exit 0; bundle; graceful-shutdown regresyon yok.
- **Güvenlik invariant (KRİTİK):** reconnect `connectUpstream(cfg, s.owner)` → **owner KORUNUR** → per-tenant tool reconnect'te ownerless'a DÜŞMEZ (Faz 24 izolasyon korunur, spy-test ile kanıtlı). **Prevention:** her reconnect/re-register güvenlik-bağlamını (owner/tenant) taşımalı — connect-once'ı resilient yaparken izolasyon sessizce kaybolmamalı.
- **Sonraki (önceden hesaplandı):** v1.19 — resource subscriptions (stdio-stateful; stateless-HTTP best-effort belgeli). Consume+expose MCP yüzeyi artık üretim-olgun (federation+resilience+isolation+abort+roots+sampling).

## Faz 28 — v1.19 (Live Runtime Validation + `npm run smoke` deploy-gate, branch feat/v1.11-roots-abort, zero-dep)
- **Ne:** ollamas İLK KEZ canlı boot edilip gerçek-zamanlı kullanıldı (lane'in ertelediği canlı-kanıt) + bulunan runtime-defekt fix + tek-komut deploy-gate. **0 yeni dep**.
- **Canlı kanıt (28A, gerçek instance PORT=3019):** health `db:up`+ollama 0.30.10 · ready 200 · metrics prom · discovery caps[roots,tools,...] protocol 2025-06-18 · **MCP tools/list=23, sample LIVE** · gerçek `tools/call list_tree` · **OAuth TAM ZİNCİR** tenant→key→DCR(cc)→`/token` cc→`ot_`→**authed /mcp init=200** · supervisor `/upstreams/status`=[] 200 · **DOGFOOD gerçek ollama `/api/ai/generate`→`{source:ollama_local, model:qwen3:8b-16k, text:"ALIVE", 115.47 tok/s}`**.
- **28B DEFEKT (canlı-koşu yakaladı, unit'ler kaçırdı):** `/api/generate` ESKİ raw endpoint `messages[]` bekliyor; `{prompt}` ile → `providers.ts:196 config.messages.find` undefined→**TypeError 500**. **Fix:** `executeProvider` `config.messages||[]` guard (asla TypeError, demo-fallback graceful) + `/api/generate` `messages` array-validation→clean 400 (`/api/ai/generate` yönlendir). Regresyon testi `providers-guard.test`. Canlı re-doğrulama: `{prompt}`→400, `messages[]`→200, dogfood ALIVE.
- **28C durable:** `tests/smoke-live.e2e.test.ts` tek zincirli üretim senaryosu (self-boot→health→tenant-key→MCP tools/list+tool-call→OAuth cc→authed→supervisor→ollama-gated-dogfood) + `package.json` `npm run smoke`.
- **Niçin:** "çalıştır+test+kullan" — unit kapsamı runtime gerçeğini garanti etmez; canlı koşu gerçek-ollama + boot + handshake defektlerini yakalar (yakaladı da).
- **Kanıt:** gerçek suite **202 passed/2 skipped** (+5); `npm run smoke` yeşil; tsc temiz; conformance:stdio exit 0; bundle; server kill (port temiz).
- **Prevention (RISK-MCP):** her versiyon ürün hedefini canlı boot ile bir kez gerçek-zamanlı doğrula (unit-only yetmez); router/parse hot-path'leri malformed input'ta TypeError-crash değil graceful olmalı (`|| []` guard).
- **Sonraki (önceden hesaplandı):** v1.20 — resource subscriptions (stdio-stateful; stateless-HTTP best-effort belgeli). Üretim yüzeyi artık CANLI-doğrulanmış.

## Faz 29 — Colab local-runtime full-auto kurulum scripti (general-lane, branch feat/colab-local-runtime, izole worktree, zero-dep)
- **Ne:** User'ın 2 pasted komutunu (Docker image + `jupyter server --allow_origin=colab`) tek idempotent script'e tamamladı: `scripts/colab-local-runtime.sh` (up/stop/status/url, auto-port, Docker-first + jupyter-fallback) + doc. ollamas-wired: workspace mount /content/ollamas + `OLLAMA_HOST=host.docker.internal:11434`. **0 yeni dep** (resmi Colab image + resmi jupyter_http_over_ws prosedürü).
- **Dürüst düzeltmeler (pasted komutlar eksik/çakışık):** bare `jupyter server` Colab'a bağlanmaz → `jupyter_http_over_ws` ZORUNLU (script ekler). User'ın `--port=3100`'ü DOLU (+ :8080/:3000) → auto-port (3100→9000→8888…). İki komut da :3100 ister → ALTERNATİF (Docker default).
- **🔴 Canlı-koşu KRİTİK bulgu (unit kaçırırdı):** jupyter path bu makinede TEMELDE çalışmaz — `jupyter_http_over_ws` 0.0.8 (son/bakımsız) `from distutils import version` yapar, **distutils Python ≥3.12'de KALDIRILDI** (makinede py3.12.13/3.14). Server HTTP 200 verir ama extension yüklenmez → Colab bağlanamaz. İlk script "READY" yazıyordu = **false-ready**. **Fix:** setuptools<81 shim dene → `python3 -c import jupyter_http_over_ws` import-check → başarısızsa launch ETME, Docker'a yönlendir + die; launch sonrası log'da extension-load doğrula, yoksa server'ı kill + die. Artık asla false-ready; canlı test: `up --jupyter`→dürüst die, :9200 sızıntı yok. **Docker = desteklenen yol** (resmi image uyumlu python+extension bundle'lar, distutils sorununu by-pass eder).
- **Kanıt:** `bash -n` OK · **shellcheck CLEAN** · status/help/url/stop çalışır · jupyter path CANLI launch edildi (:9000 HTTP 200 → port/token/launch mekaniği kanıtlı) + py3.12 incompat doğru yakalandı/bloklandı. Docker path: image layer'ları cached, full container-boot AĞIR tek-seferlik adım (bu turda green-confirm edilemedi — dürüst, fake-green YOK; user `up` ile tamamlar). Paralel :3000/:3100 + feat/colab-v1 (ALAKASIZ AI-engine lane) dokunulmadı.
- **Sonraki:** opsiyonel starter `.ipynb` (ollamas endpoint'lerini Colab'dan süren) — preemptive değil. Branch operatör merge'üne hazır. 30 agent tool, bridge 6 endpoint, warm-model kalibre, watchdog+self-heal,
shellcheck-doğrulamalı, gözlemlenebilir (seyir defteri). Repo: `eCy-coding/ollamas`.

## Faz 30 — Colab runtime'ı e2e ollamas-geliştirme için kullan: `notebooks/ollamas-colab-dev.ipynb` (general-lane, branch feat/colab-local-runtime, zero-dep)
- **Ne:** Faz 29'un ertelediği starter notebook'u tamamladı — ama "endpoint süren demo" değil, **tam ollamas dev+kalite döngüsü** Colab local-runtime içinde uçtan uca koşar: env+reachability → node24 provision → npm ci → lint→build→test → Tier-0 yerel-model kod-review (qwen3:8b, $0 M4) → gateway smoke. **0 yeni dep** (dev-harness tooling; mevcut `detectMode`/npm scriptleri reuse; ürün vibe-kod YOK).
- **Canlı bağlantı kanıtı:** Colab gerçekten local runtime'a bağlandı (`/api/status` connections:1 kernels:1; aktif session = Colab notebook fileId WebSocket). Runtime tam dev-box: node20+py3.12+mount /content/ollamas + host Ollama (17 model) + gateway :3000→200.
- **🔴 Canlı-koşu KRİTİK bulgular (unit kaçırırdı, executed-notebook yakaladı):**
  1. **node mismatch:** Colab image node20 ama proje `node:sqlite` (`DatabaseSync`, server/store/db-adapter.ts:6) → node22.5+ ister. node20'de **12 suite fail** (`No such built-in module: node:sqlite` + "server did not become healthy"). **Fix:** notebook node24.16.0 (host eşleşir) /opt'a provision → os.environ PATH → **18-pass/12-fail → 30-pass/3-skip (194 test) exit 0**.
  2. **yerel-model boş yanıt:** `qwen3:30b-a3b` ve `qwen3-coder:30b` host Ollama'da `{"model":"","response":"","done":false}` döndürüyor (bozuk). **Fix:** review `qwen3:8b` + `think:false` → gerçek review üretti (SQL-injection/parameterized-query önerileri).
  3. **emülasyon-VM crash:** full paralel vitest amd64-emülasyonda container'ı düşürdü (exit0, OOM değil; VM-spike). **Fix:** test cell `--no-file-parallelism` (sıralı → kaynak-spike yok).
  4. gateway `/api/models/ollama-local`→401 (admin-gated, beklenen) → notebook 401'i "auth çalışıyor" olarak etiketler.
- **Niçin:** "Colab'ı e2e ollamas geliştirmek için kullan" — runtime'ı sadece bağlamak değil, gerçek dev döngüsünü içinde koşturmak; node20-vs-node:sqlite + yerel-model + emülasyon-limit defektleri ancak canlı-koşuda çıktı.
- **Kanıt:** `jupyter nbconvert --execute` (container içi) **EXIT=0**; executed outputs: node24.16.0 · npm ci 686 · lint exit0 · build (vite 1700 mod + esbuild 233kb) · **test exit0 194-pass** · qwen3:8b review dolu · gateway health 200 + 401-as-expected. Source `.ipynb` valid JSON, 8 code-cell hepsi clean (outputs=[]), **secret YOK**. `.colab-data/` gitignore'a eklendi (runtime state, commit edilmez).
- **Prevention (RISK-COLAB):** Colab image node sürümü projenin runtime-gereğinin GERİSİNDE olabilir → provision-to-match şart; emülasyonlu runtime'da ağır test paralelizmi VM-crash riski → sıralı koş; yerel-model "loaded" görünüp generate'te boş dönebilir → küçük çalışan model + `think:false` fallback.
- **Sonraki:** branch operatör merge'üne hazır (notebook + README + .gitignore + bu SEYIR). Runtime :9100/:8080'de çalışır halde bırakıldı.

## Faz 31 — `colab-local-runtime.sh run`: 0-manuel headless dev-loop execution (general-lane, branch feat/colab-local-runtime, zero-dep)
- **Ne:** User "0 manuel işlem ile bunu yap" → notebook'u Colab'da elle "Run all" yaptırmadan tek komutla koşan `run` subcommand. `./scripts/colab-local-runtime.sh run` → runtime'ı (gerekirse) ayağa kaldır → container içinde `jupyter nbconvert --execute` → executed notebook'u parse → her kalite-kapısı için PASS/FAIL tablosu + dürüst exit code. **0 yeni dep.**
- **Nasıl:** `cmd_run()` (state-check→cmd_up_docker idempotent; nbconvert timeout 2400; `docker exec -i python3 -` ile executed.ipynb parse: `{'lint','build','test'}` regex + review-non-empty + `/api/health 200` marker; gate fail→`sys.exit(1)`). Arg-parser `up|stop|status|url|run`, dispatch `run) cmd_run`, help+EXAMPLES, README "Zero-manual run" + colab-local-runtime.md.
- **Niçin:** zero-manual ethos — Colab UI'a dokunmadan tüm ollamas dev döngüsü tek komut; scriptable/CI-friendly (exit code gerçek gate, kozmetik değil).
- **Kanıt:** **shellcheck CLEAN** · bash -n OK · **canlı `run` → lint PASS / build PASS / test PASS / review PASS / gateway PASS, RESULT: PASS, RUN_EXIT=0**. nbconvert container-içi EXIT 0, executed 23810 byte.
- **Prevention:** nbconvert exit 0 ≠ testler geçti (test cell test==0 assert etmiyor) → executed outputs'u parse edip ayrı gate şart; `docker exec` heredoc `-i` ZORUNLU (stdin yoksa sessizce no-op).
- **Sonraki:** branch operatör merge'üne hazır. Runtime :9100 ayakta.
