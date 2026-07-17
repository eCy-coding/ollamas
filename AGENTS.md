# AGENTS.md — ollamas Operasyon Kılavuzu (Master Prompt)

> Bu dosya ollamas üzerinde çalışan HER agent'ın (Claude Code dahil) ve uygulama-içi
> ReAct agent'ının **değişmez operasyon sözleşmesidir**. Tek kaynak. `server.ts` runtime
> system prompt'u buradan türer. Her oturumda önce bunu oku, sonra çalış.

---

## 0. Kuzey Yıldızı

**ollamas = bölgesel MCP gateway + tools-as-SaaS broker.**

Bugün tek-kullanıcılı localhost bir ReAct workspace agent'ı. Hedef: 22 host tool'unu
**barındırılan MCP server** olarak dışarı açan (expose) ve dışarıdaki MCP server'ları
**tüketen** (consume), multi-tenant + auth + metering + billing'li bir SaaS gateway.

Her commit bu hedefe yaklaştırmalı. Hedefe yaklaştırmayan iş, iş değildir.

---

## 1. Roller

İş bir role atanır; rol prensiplerini uygular. Bir oturumda roller arası geçilebilir
ama her adımın sahibi nettir.

| Rol | Sorumluluk | Kaynak |
|-----|-----------|--------|
| **Genesis Quantum Architect** | Orkestrasyon, nihai karar, hata günlüğü | `project_cortex.md` |
| **Architect** | Dizin/dosya yapısı + mimari tasarım | `server.ts` 3-aşama pipeline |
| **Coder** | Tam, çalışır dosya içeriği üretir | `server.ts` pipeline |
| **Reviewer** | Audit + Big-O + güvenlik denetimi | `server.ts` pipeline |
| **MCP Gateway Engineer** | expose + consume, transport, schema map | `server/mcp/*` |
| **Tenancy/SaaS Engineer** | multi-tenant model, auth, rate-limit | `server/store/*`, `server/middleware/*` |
| **Security/Isolation Officer** | per-plan tool allowlist, host-komut sınırı, Hard Laws §0-§6 | KRİTİK — aşağı bkz |
| **Billing/Metering Engineer** | usage_events, Stripe, kota | `server/billing/*` |

---

## 2. Değişmez Prensipler (ihlal = hata)

1. **Root cause önce** — semptom fix YASAK.
2. **Evidence önce** — "çalışıyor" iddiası = komutu koş, çıktıyı göster. Kanıtsız tamam yok.
3. **TDD** — test önce, implement sonra.
4. **Paralel Tier-1** — bağımsız işler TEK mesajda paralel.
5. **CRITICAL gizleme YASAK** — kötü haber her zaman ilk sıra.
6. **Unused code silinir** — commit etme.
7. **Comment sadece non-obvious WHY** — WHAT/HOW değil.
8. **Tek choke-point** — bkz §4. Yeni tool yolu açma.

---

## 3. Kalite Kapısı (pre-ship ZORUNLU)

Commit öncesi sırayla, her biri taze koşu:

```
typecheck (tsc --noEmit / lint_format)  ✓
lint (shell_check + lint_format)         ✓
test suite (run_tests, fresh)            ✓
→ sonra conventional commit (feat|fix|refactor|chore|docs|test(scope): msg)
```

Biri kırmızıysa commit YOK. Atlanan adım varsa açıkça söyle.

---

## 4. Tek Choke-Point Yasası

Her tool çağrısı **tek** fonksiyondan geçer: `ToolRegistry.execute(name, args, ctx)`
(`server/tool-registry.ts`).

- MCP-expose, MCP-consume, metering, rate-limit, per-tenant allowlist — hepsi BU noktaya takılır.
- `server.ts` ReAct döngüsü, `orchestrator.ts`, `server/mcp/server.ts` — hepsi buradan çağırır.
- Asla ikinci bir dispatch yolu açma. Yeni tool = registry'ye yeni `ToolDef`.
- `execute` döner: `{ output, ok, diff?, applied?, halt? }`. `write_file` approval/halt
  semantiği (`autoApply=false` → diff döndür + `halt=true`) KORUNUR.

---

## 5. Güvenlik — Hard Laws §0-§6 (Security/Isolation Officer)

Bridge tool'ları **gerçek host komutu** çalıştırır (`macos_terminal` = tam host yetkisi,
sandbox YOK). Dış tenant'a açmak ciddi sınır.

- **Allowlist zorunlu**: her tool'un bir `tier`'i var (`safe` | `host` | `privileged`).
  `host`/`privileged` tool'lar yalnız plan allowlist'i izin verirse çalışır.
- **Tenant izolasyonu**: bir tenant'ın workspace/credential'ı başka tenant'a sızamaz.
- **Credential**: upstream MCP secret'ları `SecureDB.encrypt` ile şifreli; API key'ler
  reversible değil, SHA-256 hash.
- **Gizlilik (README Hard Laws)**: kişisel veri makineden çıkmaz; yabancı kod WASM sandbox.
- Şüphede default = REDDET. Yeni host-yetkili yüzey eklerken Officer onayı şart.

---

## 6. Gözlemlenebilirlik

- Her faz/iş → `SEYIR_DEFTERI.md` (yüksek seviye) + `~/.llm-mission-control/seyir-defteri.jsonl` (`logSeyir`).
- Hatalar → `project_cortex.md` (failure sink, `tail -f` ile izlenir).
- `registry.execute` her çağrıyı latency + ok/fail ile loglar; metering bu loga takılır.

---

## 7. Yol Haritası (fazlar)

- ✅ `Faz 0` Tek choke-point (`tool-registry.ts`)
- ✅ `Faz 1` MCP expose+consume (`server/mcp/`)
- ✅ `Faz 2` multi-tenant store (`server/store/`, node:sqlite)
- ✅ `Faz 3` auth+rate-limit (`server/middleware/`)
- ✅ `Faz 4` metering+billing (`server/billing/`)
- ✅ `Faz 5` E2E sertleştirme — flag triage + hermetik test suite (`tests/`) + SaaS admin UI (`src/components/SaaSAdmin.tsx`) + portability/docs
- ✅ `Faz 6` Araştırma-temelli spec-uyum + güvenlik — RFC 9728 metadata + WWW-Authenticate + Origin guard + tool annotations; consume untrusted `host_upstream` tier + allowlist + output sanitization + manifest hash; audit_events + `/api/saas/audit`; token metering (`tool=__llm__`)
- ✅ `Faz 9` v1.0 Production GA (fallback-first) — 9A GCM authTagLength + path guard + non-root Docker + helmet; 9B API-key lifecycle (expiry/scopes) + OAuth JWT dual-path + scope enforcement; 9C Redis rate-limit fallback + Stripe Meter/Price/Customer/portal/checkout + webhook dedup; 9D prom-client `/metrics` + pino + `/api/ready`; 9E per-tenant `upstream_servers` CRUD; 9F GitHub Actions CI + SaaS UI audit viewer
- ✅ `Faz 10` v1.1 (ürünü tamamla) — 10A tam MCP (per-tenant tool izolasyon + pagination + resources + progress); 10B tenant self-serve scoped endpoint + usage timeseries + per-call async Stripe meter; 10C OpenAPI 3.1 + Swagger UI; 10D GHCR publish workflow + K8s manifest; 10E host-bridge HMAC-SHA256 imzalama (token geriye-uyum)
- ✅ `Faz 11` v1.2 (protokol+ekosistem, zero-dep) — 11A MCP prompts (architect/coder/reviewer) + completions; 11B tenant webhooks (HMAC-imzalı outbound + retry/dead-letter + worker); 11C self-service dashboard (pure-SVG usage chart + webhooks/upstreams/portal); 11D Helm chart + release-please. **Postgres+async-store → v1.3.**
- ✅ `Faz 12` v1.3 (Postgres + async-store, multi-replica scale) — 12A unified async `DbClient` adapter (`server/store/db-adapter.ts`: sqlite default + pg opt-in via `DATABASE_URL`, `?`→`$n`, dialect-aware DDL); 12B 36 store export + 5 caller + test suite async dönüşümü (tsc-rehberli); 12C multi-replica-safe webhook worker (`claimDeliveries`: pg `FOR UPDATE SKIP LOCKED`+`RETURNING`, sqlite unique claim-token); 12D CI matrix (`db: [sqlite, postgres]` × Node 22/24 + pg:17 service) + docker-compose `postgres` profili + docs. **Canlı kanıt: tam suite 68/1 iki dialect'te de yeşil (yerel pg:17).**
- ✅ `Faz 13` v1.4 (Production Operations Hardening, zero-dep) — 13A graceful shutdown (SIGTERM/SIGINT → `server.close` + `stopWebhookWorker` + `SHUTDOWN_GRACE_MS` drain + `closeStore`/pool.end + exit, çift-sinyal guard); 13B versiyonlu schema migrations (`server/store/migrations.ts`: append-only `MIGRATIONS` + `schema_migrations`, advisory-lock'lu runner, `--migrate-only` mode, iki dialect); 13C gerçek readiness (`/api/ready` DB ping → 503, `/api/health` `db` alanı report-only); 13D K8s `migration-job.yaml` + `terminationGracePeriodSeconds:30` + `DATABASE_URL` Secret + Helm pre-install/pre-upgrade hook + Chart appVersion 1.4.0 + compose `stop_grace_period`. **Canlı kanıt: SIGTERM→clean exit 0 + port freed; tam suite 75/1 iki dialect; `--migrate-only` schema_migrations kaydı.**

- ✅ `Faz 14` v1.5 (MCP Protocol Completeness + Observability, zero-dep) — 14A MCP logging (`logging` capability + `logging/setLevel` + choke-point `notifications/message` level-gated; dürüst capabilities, server 1.5.0); 14B tool `outputSchema` + CallTool `structuredContent` (text geriye-uyumlu); 14C observability depth (`/metrics`: `ollamas_db_pool_connections{state}`/`migration_version`/`webhook_queue_depth`/`shutdown_total`, prom-client async collect + store accessors `poolStats`/`migrationVersion`/`pendingDeliveryCount`). **Canlı kanıt: capability+setLevel e2e; tam suite 81/1 iki dialect; /metrics yeni seriler.** *(completion tool-arg + sampling/roots/elicitation/resource-subscribe → backlog: MCP `complete` yalnız prompt/resource ref; stateless transport bidirectional sınırı.)*

- ✅ `Faz 15` v1.6 (MCP Ecosystem Interop + Auth Completeness, zero-dep) — proven spec/registry kodundan adopte (sıfırdan icat yok). 15A discovery+manifest: `server.json` (resmi `modelcontextprotocol/registry` formatı, schema 2025-12-11, reverse-DNS `io.github.eCy-coding/ollamas`, `remotes[streamable-http]`) + `GET /.well-known/mcp.json` (capabilities/transport/auth/primitives, `server/mcp/discovery.ts`) + tek `MCP_SERVER_VERSION`/`MCP_CAPABILITIES` const (drift-guard, `server/mcp/server.ts`); 15B OAuth 2.1 DCR (RFC 7591): public `POST /register` → `client_id`(+secret confidential) + `registration_access_token` (`registerClient`, migration v2 `oauth_clients`, rate-limited + `DCR_INITIAL_ACCESS_TOKEN` gate) + `GET /.well-known/oauth-authorization-server` (RFC 8414, `registration_endpoint`) + RFC 9728 metadata `authorization_servers` self-point. **Canlı kanıt: 5-uçlu self-boot turu (mcp.json 22 tool/3 prompt, AS metadata, DCR confidential+public); tam suite 99/1 iki dialect (sqlite+pg18); vite build.** *(DCR = yalnız client-metadata kaydı; token issuance = tam OAuth 2.1 AS → backlog. Gerçek public registry push dışa-dönük → ayrı onaylı adım, workflow disabled.)*

- ✅ `Faz 16` v1.7 (MCP Adoption: stdio expose + conformance + outputSchema enforce + scan gate) — çalışan-kod adopte, sıfırdan icat yok. 16A `outputSchema` enforcement: choke-point (`server/tool-registry.ts execute()`) yapısal (object) çıktıyı ajv ile advertise edilen şemaya doğrular → ihlal `ok:false output_schema_violation` (never-throw korunur); text-only tool'lar etkilenmez; malformed şema no-op (ajv @modelcontextprotocol/sdk ile gelir, dedupe). 16B stdio EXPOSE (`bin/mcp-stdio.ts` → `npx ollamas-mcp`): AYNI `buildServer()` + ToolRegistry choke-point'i stdio'ya bağlar (ikinci dispatch yok); single-tenant (metering/tenant yok), default safe-tier (`MCP_STDIO_TIERS` genişletir), host-bridge client `server/host-bridge.ts`'e çıkarıldı (HTTP app + stdio paylaşır); Claude Desktop/Cursor/Code tüketebilir; `server.json packages[npm/stdio]`. 16C konformans: resmi MCP Inspector CLI (`@modelcontextprotocol/inspector --cli`, devDep) bağımsız client ile `/mcp` + stdio doğrular (`tests/conformance.e2e.test.ts`, `npm run conformance:*`). 16D upstream güvenlik tarama gate (`server/mcp/client.ts`, opt-in `MCP_SCAN_CMD`, Stripe-vari no-op/dry-run): manifest harici scanner'a (cisco-ai-defense/mcp-scanner) pipe → flagged tool register-öncesi skip; fail-open (host_upstream tier + manifest pin + sanitization üstüne defense-in-depth). **Canlı kanıt: tam suite 113 passed/2 skipped (+14: 4 outputSchema + 3 conformance + 4 scan + 3 stdio); stdio built cjs Inspector CLI ile 15 safe tool; tsc temiz.** *(SSE legacy transport DECLINED: `sessionIdGenerator:undefined` stateless prensibiyle çakışır + spec'te deprecated + Streamable HTTP tüm modern client'ları kapsar. Sampling/elicitation/resource-subscribe hâlâ backlog: stateless transport bidirectional sınırı.)*

- ✅ `Faz 17` v1.8 (Choke-point Interceptors: redaction + cache + cancellation) — çalışan-kod/desen adopte, sıfırdan icat yok. 17A interceptor zinciri (`server/tool-interceptors.ts`): tek sıralı pre/post middleware (docker/mcp-gateway + IBM mcp-context-forge deseni); `execute()` PRE (cache-hit short-circuit) + POST (transform) çalıştırır, never-throw (interceptor hatası yutulur); AYNI choke-point (ikinci dispatch yok). 17B secret redaction (default ON, `MCP_REDACT=0` opt-out): gitleaks+secretlint MIT regex setinden DATA-port (AWS/GitHub/GitLab/Slack/Google/Stripe/JWT/PEM + generic key=value value-mask); `redactDeep` string+nested object/array özyineler, key'ler korunur; built-in + upstream tüm tool çıktısına uygulanır. 17C read-only sonuç cache (opt-in `MCP_CACHE_TTL_MS>0`, `lru-cache` MIT dedupe): yalnız saf-okuma tool seti (`CACHEABLE`; write/run/web_search/logbook HARİÇ), key `tenant:tool:sha256(args)` (tenant-izole), yalnız `ok && !halt && !applied` saklanır; redaction'dan SONRA kayıt (cache-hit maskeli döner). 17D tool-call cancellation (`@modelcontextprotocol/sdk` bedava): CallTool handler `extra.signal` (SDK `notifications/cancelled`→abort) → `ctx.abortSignal`; `execute()` pre-abort + invoke-vs-abort race → prompt `ok:false cancelled` (alt host çağrısı kendi timeout'una kadar sürebilir). **Canlı kanıt: tam suite 129 passed/2 skipped (+16: 15 interceptor [4 chain/cancel + 6 redaction + 4 cache + 1] + 1 stdio cancel e2e); stdio canlı cancel <3s (4s sleep); tsc temiz + server/stdio bundle.** *(SSE hâlâ DECLINED. Sampling/elicitation = v1.9 stdio-only bidirectional; OAuth 2.1 AS token endpoint = v1.9 `node-oauth2-server` MIT.)*

- ✅ `Faz 18` v1.9 (Bidirectional MCP: Sampling + Elicitation) — çalışan-kod adopte, 0 yeni dep (SDK + mevcut ProviderRouter). v1.8 bidirectional stdio transport'unu kullanır. 18A capability-aware callback threading: CallTool handler (`server/mcp/server.ts`) `server.getClientCapabilities()` okur → `caps.elicitation`/`caps.sampling` varsa `ctx.onElicit`/`ctx.onSample` (SDK `elicitInput`/`createMessage` sarmalayıcı) thread eder (`onProgress` deseni); capability yoksa undefined → tool fallback (HTTP/no-cap regresyon yok). 18B write_file elicitation (capability-gated, additive): `!autoApply && ctx.onElicit` → client'a `elicitInput({approve:boolean})` sorar; accept→yaz+applied, decline→"declined" (halt YOK); capability yoksa **mevcut halt+diff fallback**. stdio bin local-write izni `fileWrite=true` (autoApply yalnız prompt-vs-auto). 18C consume-side sampling provider (`server/mcp/client.ts`, opt-in `MCP_SAMPLING=1`): ollamas Client `sampling` capability + `CreateMessageRequest` handler → mevcut `ProviderRouter.generate()` (Ollama); inbound prompt `sanitizeUpstreamOutput` guard; default OFF (capability deklare edilmez → untrusted upstream LLM harcayamaz). **Canlı kanıt: tam suite 135 passed/2 skipped (+6: 3 elicit unit + 1 stdio elicit accept/decline e2e + 2 consume sampling [mock provider]); tsc temiz + server/stdio bundle.** *(OAuth 2.1 AS → v1.10; roots/list + expose-side sampling-to-tool → backlog.)*

- ✅ `Faz 19` v1.10 (OAuth 2.1 Authorization Server) — çalışan-kod adopte, **0 yeni dep**: `@modelcontextprotocol/sdk@1.29` zaten tam OAuth router içeriyor. 19A migration v3 (`oauth_codes`+`oauth_tokens`+`oauth_clients.tenant_id` ALTER guard) + store helpers (`saveAuthCode`/`consumeAuthCode` one-time+expiry, `saveOAuthToken`/`resolveOAuthToken`/`revokeOAuthToken` opaque `ot_`+SHA-256 — api_key deseni). 19B DCR-time tenant binding: `/register` caller tenant API-key (`x-api-key` / gate-yokken bearer) sunarsa `resolveKey`→`client.tenant_id`; anonim→null. 19C `OllamasOAuthProvider` (`server/mcp/oauth-provider.ts`) SDK `OAuthServerProvider` impl (authorize auto-consent tenant-bound, challenge/exchange opaque token, verifyAccessToken, revoke; refresh stub); clientsStore yalnız getClient (registerClient YOK → router /register mount etmez, DCR bizde kalır). 19D `mcpAuthRouter` mount (`/authorize`+`/token`+`/revoke`+PKCE S256), AS-metadata bizde (registration_endpoint korunur, router ondan sonra). 19E auth.ts `ot_` dalı → `resolveOAuthToken`→tenant→plan→allowedTiers (api-key ile aynı downstream, `mcpCtxFactory` değişmedi). **Canlı kanıt: tam suite 144 passed/2 skipped (+9: 5 store + 4 e2e); uçtan uca DCR(bound)→authorize→token(PKCE S256)→`ot_` token ile `/mcp` 200; PKCE mismatch→400; unbound client→access_denied; tsc temiz + server/stdio bundle.** *(Refresh + client_credentials + consent-UI → v1.11.)*
- ✅ `Faz 20` v1.11 (MCP Protocol Polish: Roots + Abort-to-Host) — çalışan-kod adopte, **0 yeni dep** (SDK `ListRootsRequestSchema`/`callTool` signal + Node stdlib `AbortSignal.any`). 20A consume-side **roots**: ollamas Client `roots:{listChanged:false}` capability + `ListRootsRequest` handler (`server/mcp/client.ts`) → upstream'in `roots/list`'ine workspace kökünü (`db.data.workspacePath`→`file://`) döner (sandbox sinyali; boşsa `{roots:[]}`). 20B **abort-to-host**: `host-bridge.ts` `combineSignal(signal,timeout)=signal?AbortSignal.any([signal,timeout]):timeout` → `runOnHostTerminal`/`execOnHost`/`writeHostFile` opsiyonel `signal?`; `ToolDeps` 3 host-helper imzası `signal?` alır; 10 uzun-süren host tool (`macos_terminal`/`write_host_file`/`run_tests`/`build_app`/`lint_format`/`pkg_install`/`tools_doctor`/`shell_check`/`apply_patch`/`web_search`) invoke'una `ctx.abortSignal` thread (artık MCP CancelledNotification host fetch'i gerçekten keser, kendi timeout'una kadar sürmez); upstream `callTool(...,{signal:ctx.abortSignal})`. Hızlı tool'lar değişmedi; server.ts/mcp-stdio wiring geriye-uyumlu (opsiyonel param). **Canlı kanıt: tam suite 150 passed/2 skipped (+6: 2 consume-roots + 3 abort-forward spy + 1 combineSignal); tsc temiz + server/stdio bundle + conformance:stdio tools/list OK.** *(Refresh+rotation + client_credentials + expose-side roots → v1.12.)*
- ✅ `Faz 21` v1.12 (Abort Propagation E2E + Federated Roots Aggregation) — çalışan-kod adopte, **0 yeni dep** (SDK `ListRootsResultSchema` + stdlib `AbortSignal.any`; v1.11 desenleri ileriye taşındı). 21A **abort propagation**: ReAct SSE loop (`server.ts`) `AbortController` + client-disconnect (`req/res.on("close")`) → abort; `ProviderRouter.generate(...,signal)` 4. param + `buildSignal(caller)=AbortSignal.any([caller,timeout(300s)])` 5 provider fetch'ine; tool çağrısı `ctx.abortSignal`; `AbortError`/`signal.aborted` → graceful `res.end()` (hata değil). Artık client kapanınca LLM + tool + loop **gerçekten durur** (kaynak israfı yok). 21B **expose-side federated roots**: `client.ts` connect sonrası upstream `roots/list` çeker → `upstreamRoots` map (never-throw, desteklemeyen→[]) + `getFederatedRoots()` `<server>:<name>` namespaced; `server/mcp/server.ts` `roots:{}` capability + `roots/list` handler = workspace kökü + federated upstream roots. **Canlı kanıt: tam suite 163 passed/2 skipped (+2 federated-roots: roots-serving upstream agrege + non-roots upstream graceful boş); tsc temiz + server/stdio bundle + conformance:stdio OK; abort yolu v1.11 birim testleri + e2e kod-yolu ile.** *(Refresh+rotation + client_credentials + resource-subscriptions → v1.13.)*
- ✅ `Faz 22` v1.13 (OAuth Refresh-Token Rotation [RFC 9700] + Client-Credentials Grant) — çalışan-kod adopte, **0 yeni dep** (SDK `mcpAuthRouter` refresh_token grant'ı zaten `provider.exchangeRefreshToken`'a yönlendirir; rotation deseni RFC 9700/node-oidc-provider MIT fikir-port; stdlib `crypto.timingSafeEqual`). 22A **refresh + rotation**: migration v4 `oauth_refresh_tokens` (family_id + used flag) + store `saveRefreshToken`/`rotateRefreshToken`/`revokeRefreshFamily`/`refreshFamilyOf`; `exchangeAuthorizationCode` ek `rt_` üretir (14g, family doğar), `exchangeRefreshToken` her kullanımda rotate (yeni access+yeni refresh aynı family) — **used token replay→tüm family revoke (reuse detection)**, scope yalnız daralır; `revokeToken` access+family revoke; DCR default `grant_types`+=`refresh_token`. 22B **client_credentials** (M2M): `verifyClientSecret` (timing-safe sha256) + `mcpAuthRouter`-öncesi `app.post("/token")` pre-route (SDK bu grant'ı reddeder) — confidential+tenant-bound+grant-allowed → access token (refresh YOK), aksi `invalid_client`(401)/`unauthorized_client`(400); diğer grant'lar `next()`→SDK. **Canlı kanıt: gerçek suite 173 passed/2 skipped (+10: 7 refresh store+provider [rotate/reuse-family-revoke/expiry/client-mismatch/scope-narrow] + 3 cc self-boot e2e [token→/mcp auth, yanlış-secret 401, grant-yok 400]); tsc temiz + server/stdio bundle + conformance:stdio OK.** *(refresh+cc'nin migration v4'ü dialect-agnostik; expose-side sampling-to-tool + resource-subscriptions → v1.14.)*
- ✅ `Faz 23` v1.14 (Expose-Side Sampling Tool) — çalışan-kod adopte, **0 yeni dep** (SDK `ctx.onSample`→`server.createMessage` köprüsü Faz 18A'da MEVCUT, tool yoktu). `server/tool-registry.ts` yeni **safe-tier** `sample` tool: bağlanan client'ın LLM'ini MCP sampling ile kullanır (`ctx.onSample` → `{prompt,system?,maxTokens?}`); client `sampling` capability ilan etmezse (HTTP/stateless) graceful "sampling unavailable" notice (throw yok). **safe** çünkü ollamas host/kaynak harcamaz — caller'ın modelini kullanır; çıktı caller'ın kendi LLM'i → sanitize yok. Simetri: v1.9 consume-side sampling provider (ollamas-client upstream'i cevaplar) ↔ v1.14 expose-side (ollamas-server client'ı kullanır). No-half: built-in 22→23 + free-plan safe 15→16 (3 test assertion güncellendi: tool-registry/mcp-gateway-e2e/mcp-stdio-e2e). **Canlı kanıt: gerçek suite 177 passed/2 skipped (+4: 3 sample unit [onSample-forward/graceful-notice/safe-tier] + 1 sample-stdio e2e [sampling-capable client → callTool sample → client-LLM cevabı, bidirectional ispat]); tsc temiz + server/stdio bundle + conformance:stdio OK.** *(resource subscriptions → v1.15: stateless Streamable-HTTP server-per-request → subscription state-ephemeral + teslimat best-effort + fs.watch infra; yarım kurmaktansa belgelenmiş ertelendi.)*
- ✅ `Faz 24` v1.15 (Per-Tenant Upstream Tool Isolation — **CRITICAL güvenlik fix**) — kritik-gap audit: per-tenant upstream tool'ları (`mcp__<tenantId>_<srv>__<tool>`, server.ts:168/1457) izole DEĞİLDİ — (1) `list()` filtresi `mcp__tnt_` prefix bekliyordu, gerçek ad `mcp__<tenantId>_...` → hiç eşleşmez → **tüm tenant'lara görünür**; (2) `execute()` **tenant-gate yoktu** → isim tahminle **cross-tenant invoke** (görünürlük≠yetki, Faz 9E yarım). **0 yeni dep**, çözüm = explicit **OWNERS map** (integrations-lane v2.3 ispatlı deseni, isim-parse DEĞİL): `tool-registry.ts` `OWNERS` Map + `register(name,def,owner?)` + `list` owner-gate (`!o||o===tenantId`, kırık prefix-filtre kaldırıldı) + **`execute` deny-by-default** (`tool_not_permitted`, owner≠tenant) + `unregisterByPrefix` OWNERS temizler; `client.ts` `connectUpstream(cfg,owner?)`/`connectAllUpstreams(...,owner?)`; `server.ts` global tools.json **ownerless** + per-tenant store upstream **owner=tenant_id** (boot + runtime POST). **Canlı kanıt: gerçek suite 179 passed/2 skipped (+2 upstream-isolation: owner-visibility [owned yalnız sahibine, global herkese] + cross-tenant invoke→tool_not_permitted deny + unregister OWNERS-cleanup); tsc temiz + server/stdio bundle + conformance:stdio OK.** *(RFC 8707 resource-binding → v1.16; resource-subscriptions → v1.17.)*
- ✅ `Faz 25` v1.16 (RFC 8707 Resource-Binding Enforcement — HIGH güvenlik fix) — kritik-gap audit: opaque `ot_` token path (`auth.ts resolveOAuth`) token'ın `resource` (audience) alanını SAKLIYOR ama doğrulamıyordu → resource-A için basılan token resource-B'de geçerli (audience-confusion / confused-deputy / cross-resource reuse). JWT path zaten `jose` ile audience enforce ediyordu (asimetri). **0 yeni dep** (RFC 8707/9728 + MCP 2025-06-18; JWT-audience deseni opaque path'e simetrik + stdlib URL normalize). `resolveOAuth(token, expectedResource)`: `r.resource` non-null ise `canonicalResource` (trailing-slash normalize) eşleşmezse → null (401 invalid_token); null-resource → kısıtsız (geriye-uyum); beklenen-resource JWT path ile AYNI kaynak (`OAUTH_AUDIENCE || ${base}/mcp`). **Canlı kanıt: gerçek suite 183 passed/2 skipped (+4 oauth-resource-binding: match→authenticated, mismatch→401, null→backward-compat, trailing-slash-canonical); tsc temiz + server/stdio bundle + conformance:stdio OK.** *(resource-subscriptions → v1.17.)*
- ✅ `Faz 26` v1.17 (OAuth Token Retention / Expired-Row GC — üretim lifecycle) — production-readiness audit: OAuth AS expired satırları (`oauth_codes`/`oauth_tokens`/`oauth_refresh_tokens`) asla silinmiyordu → busy-AS tablo şişmesi/sorgu yavaşlaması. **0 yeni dep** (node-oidc-provider GC deseni fikir-port + mevcut webhook-worker scheduler + `nowIso` ISO-compare). `store.purgeExpiredOAuth()` (3× `DELETE WHERE expires_at < now`, `{codes,tokens,refresh}` döner) + `server/oauth-gc.ts` `startOAuthGc/stopOAuthGc` (boot'ta bir-kez-hemen + `OAUTH_GC_INTERVAL_MS||1h` interval, `unref`, never-throw) + server.ts boot (`startWebhookWorker` yanı) & SIGTERM shutdown (`stopWebhookWorker` yanı) wire. **Güvenlik invariant: SADECE expired sil** → used-ama-unexpired refresh korunur (RFC 9700 reuse-detection penceresi=TTL bozulmaz). **Atlanan (gereksiz, kanıtlı): token-endpoint rate-limit** (`rateLimitMiddleware !t→next()` pre-auth no-op + 192-bit secret brute-force-infeasible + DoS infra-katmanı), **gcm:1705** (false-positive, setAuthTag mevcut). **Canlı kanıt: gerçek suite 185 passed/2 skipped (+2 oauth-gc: expired-purge/fresh-survive + used-unexpired-refresh reuse-detection korundu); tsc temiz + server/stdio bundle + conformance:stdio OK; graceful-shutdown regresyon yok.** *(resource-subscriptions → v1.18.)*
- ✅ `Faz 27` v1.18 (Consume-Side Upstream Resilience — federation supervisor) — production-readiness audit (OAuth dışı): consume-side `client.ts` upstream'e connect-once yapıyordu, **reconnect/health/circuit-breaker YOK** → upstream ölünce `mcp__<srv>__*` tool'ları süresiz fail. **0 yeni dep** (integrations-lane'in ispatlı `supervisor.ts` adopte: LibreChat MCP_CB_* + IBM/mcp-context-forge backoff desen-port; tek choke-point korunur). 27A `client.ts`: `pingUpstream`(listTools-probe)/`disconnectUpstream`(close+delete)/`UpstreamResult.toolNames`. 27B `server/mcp/supervisor.ts`: `superviseUpstream(cfg,owner?)` + health-check + `computeBackoff`(exp+cap MCP_CB_*) + circuit-breaker(MAX_CYCLES→cooldown) + **owner-preserving reconnect** + `getUpstreamStatus`/`getCollisions`/`removeUpstream`/`startSupervisor`(opt-in MCP_HEALTH_INTERVAL_MS, unref)/`stopSupervisor`. 27C `server.ts`: boot upstream'leri supervise (global ownerless + per-tenant owner=tenant_id) + `startSupervisor` + runtime POST→supervise / DELETE→removeUpstream + `GET /api/saas/upstreams/status` (tenant-filtreli) + SIGTERM `stopSupervisor`. **KRİTİK güvenlik invariant: reconnect owner'ı KORUR** → per-tenant tool reconnect'te ownerless'a düşmez (Faz 24 izolasyon korunur, test ile kanıtlı). **Canlı kanıt: gerçek suite 197 passed/2 skipped (+8 upstream-supervisor: backoff/circuit-breaker/health-degraded/owner-preserving-reconnect/collisions/remove); tsc temiz + server/stdio bundle + conformance:stdio OK; graceful-shutdown regresyon yok.** *(resource-subscriptions → v1.19.)*
- ✅ `Faz 28` v1.19 (Live Runtime Validation + `npm run smoke` deploy-gate) — ollamas İLK KEZ CANLI boot edilip gerçek-zamanlı kullanıldı (lane'in ertelediği canlı-kanıt). **0 yeni dep**. **28A canlı koşu** (PORT=3019 tsx self-boot): health db:up + ollama 0.30.10 · ready 200 · metrics · discovery (caps roots/tools, protocol 2025-06-18) · **MCP tools/list 23 tool sample-LIVE** · gerçek tool/call list_tree · **OAuth TAM ZİNCİR** (tenant→key→DCR-cc→/token cc→`ot_`→authed /mcp 200) · supervisor /upstreams/status 200 · **DOGFOOD gerçek ollama /api/ai/generate→"ALIVE" qwen3:8b-16k 115 tok/s**. **28B canlı-koşu DEFEKTİ fix** (unit'lerin kaçırdığı): `/api/generate` (raw endpoint, `messages[]` ister) `{prompt}` ile çağrılınca `providers.ts:196 config.messages.find` **TypeError→500**; fix = `executeProvider` `config.messages||[]` guard (asla TypeError) + `/api/generate` messages-array validation (clean 400 + "use /api/ai/generate" yönlendir). **28C durable** `tests/smoke-live.e2e.test.ts` (tek zincirli üretim senaryosu) + `npm run smoke` deploy-gate. **Canlı kanıt: gerçek suite 202 passed/2 skipped (+5: 4 smoke-live [health/discovery + tenant-key-mcp-toolcall + oauth-cc-authed + ollama-dogfood-gated] + 1 providers-guard); npm run smoke yeşil; /api/generate {prompt}→400 (eski 500-crash fix) + messages[]→200; tsc temiz + bundle + conformance:stdio OK.** *(resource-subscriptions → v1.20.)*

Sonraki işler aynı sözleşmeyle: yeşil kapı (§3) + logbook (§6) + conventional commit.
Detay: `~/.claude/plans/ollamas-projesini-a-ve-atomic-wand.md`.

### Backlog (araştırma-onaylı, henüz YAPILMADI)
Faz 9 sonrası kalanlar (ayrı altyapı ister):
- ✅ ~~Gateway hardening~~ — **Faz 17 v1.8'de YAPILDI** (interceptor zinciri + redaction + read-only cache).
- ✅ ~~MCP sampling + elicitation~~ — **Faz 18 v1.9'da YAPILDI** (elicitation write_file + consume-side sampling provider).
- ✅ ~~OAuth 2.1 Authorization Server~~ — **Faz 19 v1.10'da YAPILDI** (SDK mcpAuthRouter + opaque token + DCR-time tenant bind).
- ✅ ~~OAuth refresh token + client_credentials grant~~ — **Faz 22 v1.13'te YAPILDI** (migration v4 `oauth_refresh_tokens` family+rotation, RFC 9700 reuse→family-revoke; client_credentials pre-route + timing-safe secret verify).
- ✅ ~~consume-side roots + abort-to-host~~ — **Faz 20 v1.11'de YAPILDI**.
- ✅ ~~roots/list upstream agregasyonu + abort propagation~~ — **Faz 21 v1.12'de YAPILDI**. ✅ ~~expose-side sampling'i somut tool'a bağlama~~ — **Faz 23 v1.14'te YAPILDI** (`sample` tool). Kalan: **resource subscriptions** → v1.15 (stateless transport state-ephemeral + teslimat best-effort; belgelenmiş ertelendi).
- Tam **OAuth 2.1 authorization-server** (token issuance/refresh). *JWT validation + RFC 8707 audience Faz 9B'de; DCR client-metadata kaydı Faz 15B'de; eksik olan authorization/token endpoint'i.*
- Host-bridge token **HMAC + TTL + TLS/unix-socket** (şu an plaintext `X-Bridge-Token`, localhost).
- **Per-call gerçek-zamanlı** Stripe meter (şu an nightly batch, idempotent).
- **K8s manifest** + Redis HA + tam **OpenAPI** spec + MCP `resources`/`prompts` primitive.
- ✅ ~~Per-tenant upstream tool **visibility izolasyonu**~~ — **Faz 24 v1.15'te YAPILDI** (OWNERS map + execute deny-by-default; cross-tenant invoke kapatıldı).
- ✅ ~~RFC 8707 resource-binding enforcement~~ — **Faz 25 v1.16'da YAPILDI** (opaque `ot_` token audience match `/mcp`; cross-resource reuse kapatıldı).

**Güvenlik sözleşmesi (§5 ek):** `/mcp` üzerinden write_file auto-apply eder
(`MCP_AUTO_APPLY=0` ile diff/halt). Privileged tier (`macos_terminal`/`write_host_file`)
uzak tenant'a yalnız plan allowlist'i izin verirse açılır. `SAAS_ENFORCE=1` iken
`SAAS_ADMIN_TOKEN` zorunlu (yoksa admin route'lar kilitli).

---

## 8. Çalışma Modeli (kalıcı)

Bu dosya yazıldıktan sonra ollamas üzerindeki her iş §1 rollerine + §2 prensiplerine +
§3 kapısına göre yürür. Plan tek seferlik değil — sürekli, her işlemde bir adım ileri.
Bir şeyi değiştirirken bu sözleşmeyi de güncel tut: kural değişiyorsa önce burada değişir.

---

## 9. Orchestration — Otonom Kondüktör (0-manuel, entegre)

`orchestration/` dizini projenin **0-manuel otonom kondüktörüdür** (read-only meta-katman; lane
kodu yazmaz, koordine eder). Operating-model'in birinci-sınıf parçası — bolted-on değil.

- **Tek-komut pipeline:** `npx tsx orchestration/bin/autopilot.ts` → benchprompt(M4-optimal model
  seçimi) → critic+dod(öz-denetim) → conduct(deterministik tek-eylem) → fuse(birleşik kritik
  gereksinim `REQUIREMENTS.md`) → status → doctor(readiness GO/NO-GO). Artefaktlar: `orchestration/*.md`.
- **Detector precision:** dod/critic gürültü-flag'i `.policy-suppress.json` (gerekçeli-istisna,
  silent-değil) ile elenir → verdict güvenilir.
- **Sürekli operasyon (bir-kerelik aktivasyon, PRIVILEGED):** `bash orchestration/bin/activate.sh`
  → `.claude/settings.json` hook (SessionStart→autopilot + model-soru→benchmark-kanıtlı cevap) +
  launchd agent (bench-değişim + 30dk periyodik). Path'ler script-konumundan dinamik (portable, vO16).
- **Sözleşme:** `orchestration/ORCHESTRATION_AGENTS.md` (§0-§15+). Kanıt: `orchestration/SEYIR_DEFTERI_ORCHESTRATION.md`.
- **Yönetim/organizasyon (ORG layer):** roller + en-ucuz-yetkin routing + dispatch-öncesi hata-registry
  ön-kontrolü + her işlem brain-ledger'a. Charter `orchestration/ORGANIZATION.md`, master prompt
  `orchestration/MANAGEMENT.md`, makine şeması `orchestration/ORG_CHART.json`.
- **Test:** `npx vitest run --config orchestration/vitest.config.ts` (root suite'ten izole, ERR-SCR-002).
