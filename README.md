# ollamas — LLM Mission Control

Yerel modelleri (ollama) + bulut sağlayıcıları tek bir kontrol panelinden yöneten, **MCP gateway**
olarak tool'larını dışa açan ve **$0 yerel-model conductor**'ıyla kendini yöneten bir LLM işletim
merkezi. Kendi modelini getir, kendi tool'unu ekle, Claude Code veya herhangi bir MCP client'ı bağla —
hepsi kendi makinende, gerekli olmadıkça API key olmadan.

- **Yerel-önce:** ollama yerel motor (varsayılan `qwen3:8b`); key yoksa nazik fallback (ollama → … → demo).
- **MCP gateway:** workspace tool'larını `/mcp` (Streamable HTTP) üzerinden expose + dış MCP server'ları consume.
- **tools-as-SaaS:** tek choke-point (`server/tool-registry.ts`) üstünde multi-tenant auth + rate-limit + usage metering + Stripe billing.
- **$0 conductor:** Claude-Code-free FSM loop, joker failover, katalog (`ollamas do`), gated apply.
- **Birleşik CLI:** zero-dep `ollamas` (chat/agent/mcp/saas/bench/top).

## Hızlı başlangıç

```bash
npm run ready        # ön-koşulları tespit+düzelt (Node, deps, .env, ollama, model pull, doctor)
npm run dev          # tsx server.ts → http://localhost:3000  (veya: make up)
```

`npm run ready` idempotent: Node kontrol, `npm ci`, `.env`'i `.env.example`'dan kopyala, ollama
daemon doğrula, varsayılan modeli çek, derin audit. **Yerel kullanım için API key gerekmez.**
Tam 60-saniye yol + slash komutlar (`/ready /agent /ops /verify /ship`): **[QUICKSTART.md](QUICKSTART.md)**.

## Platform

macOS (Apple Silicon / ARM64) için optimize; Docker ile Linux/çok-platform desteği — yol seçimi
(local / Docker / compose / Helm / k8s) + güncelleme akışı: **[docs/deploy-guide.md](docs/deploy-guide.md)**.
Tek-GPU gerçeği: yerel LLM çağrılarını **sıralı** işle (paralel ~3× yavaş serialize eder).

## Katkı

Geliştirme kurulumu, kalite-kapısı ve PR akışı: **[CONTRIBUTING.md](CONTRIBUTING.md)**. Kendi tool/skill/
CLI-komutu eklemek: [`docs/extension-guide.md`](docs/extension-guide.md).

## Lisans

MIT — bkz. [LICENSE](LICENSE).

---

## MCP Gateway + tools-as-SaaS

ollamas, 22 workspace tool'unu **MCP gateway** olarak hem dışarı açar (expose) hem
dışarıdaki MCP server'ları tüketir (consume). Tüm tool çağrıları tek choke-point'ten
geçer (`server/tool-registry.ts`); üstünde multi-tenant auth + rate-limit + usage
metering + Stripe billing katmanı vardır. Operasyon sözleşmesi: `AGENTS.md`.

### Claude Code'u (veya herhangi bir MCP client'ı) bağlama
`/mcp` Streamable HTTP transport sunar:
```
claude mcp add --transport http ollamas http://localhost:3000/mcp
```
`SAAS_ENFORCE=1` ise `Authorization: Bearer <API_KEY>` gerekir.

### Tek-kullanıcı vs SaaS
- **Tek-kullanıcı (default):** `SAAS_ENFORCE` kapalı → `/mcp` localhost'ta keysiz,
  tüm tier'ler (`MCP_EXPOSE_TIERS`). Mevcut davranış korunur.
- **SaaS (multi-tenant):** `SAAS_ENFORCE=1` + `SAAS_ADMIN_TOKEN=<token>`. Web'deki
  **SaaS Gateway** sekmesinden (ya da `/api/saas/*`) tenant oluştur, API key issue et.
  Plan tier allowlist'i belirler (free=safe · pro=safe+host · enterprise=+privileged),
  rate-limit + aylık kota uygulanır.

### Billing
Tool çağrıları `usage_events`'e metrelenir (`~/.llm-mission-control/saas.db`).
`POST /api/billing/run` ay-bazlı rollup'ı Stripe metered usage'a yazar; `STRIPE_API_KEY`
yoksa **dry-run** (önizleme: `GET /api/billing/preview`). Tenant başına `stripe_customer_id`.

### Spec-uyum + güvenlik (Faz 6, araştırma-temelli)
- **MCP Authorization keşfi (RFC 9728):** `GET /.well-known/oauth-protected-resource` + her 401'de `WWW-Authenticate: Bearer resource_metadata="..."`. Standart MCP client'lar auth'u keşfeder. (Opaque API key; tam OAuth 2.1 server backlog'da.)
- **DNS-rebinding koruması:** `/mcp` Origin allowlist (`ALLOWED_ORIGINS`, default localhost).
- **Tool annotations:** tier'den türetilen `readOnlyHint`/`destructiveHint` (privileged→destructive).
- **Untrusted upstream izolasyonu:** consume edilen MCP tool'ları `host_upstream` tier'de — default expose DIŞI; `allowedTools` allowlist + isim-çakışma blok + output sanitization (prompt-injection) + manifest hash (rug-pull tespiti).
- **Audit:** host/privileged/upstream çağrıları `audit_events`'e; `GET /api/saas/audit` (admin).
- **Token metering:** in-app LLM token (eval_count) `usage_events tool=__llm__` olarak ayrı dimension.

### v1.0 Production GA (Faz 9 — fallback-first)
Tüm prod özellikleri **dış secret olmadan** çalışır; secret girilince otomatik aktifleşir:
- **Auth:** API-key lifecycle (expiry `API_KEY_MAX_TTL_DAYS`, scopes, last-used) + opsiyonel OAuth JWT (`OAUTH_ISSUER` → JWKS doğrulama, audience, `tools:<tier>` scope). Opaque key hep çalışır.
- **Rate-limit:** `REDIS_URL` varsa atomik Redis token-bucket (çok-instance); yoksa in-memory.
- **Billing:** `STRIPE_API_KEY` varsa Meter/Price/Customer otomasyonu + `/api/billing/{portal,checkout}` + webhook dedup; yoksa dry-run.
- **Observability:** `GET /metrics` (Prometheus: http latency + `mcp_tool_calls_total`), `GET /api/ready`, pino JSON log (`LOG_LEVEL`).
- **Per-tenant upstream MCP:** `GET/POST/DELETE /api/saas/upstreams` (tenant-auth).
- **Güvenlik:** AES-GCM authTagLength pinned, path-traversal guard, non-root Docker, helmet.
- **CI:** `.github/workflows/ci.yml` (tsc + vitest + build, Node 22/24).

### v1.2 (Faz 11 — zero-dep)
- **MCP prompts/completions:** `prompts/list`+`get` (architect/coder/reviewer) + `completion/complete` (enum autocomplete).
- **Tenant webhooks:** `POST /api/saas/webhooks {url,events[]}` → HMAC-signed (`X-Ollamas-Signature: t=..,v1=..`, Stripe-compatible) outbound delivery with retry + dead-letter. Events: `key.created/revoked`, `usage.quota_exceeded`, `subscription.updated`.
- **Self-service dashboard:** SaaS UI panel (tenant key) — pure-SVG usage charts, webhooks CRUD, upstreams, billing portal button.
- **Deploy:** `deploy/helm/ollamas/` Helm chart (`helm install ollamas deploy/helm/ollamas`) + `release-please` (conventional commits → semver tag → GHCR image via `publish.yml`).

### v1.3 (Faz 12 — Postgres, multi-replica scale)
Birleşik **async store**: sqlite default, Postgres opt-in — yatay ölçek için.
- **Store:** `DATABASE_URL` unset → `node:sqlite` (tek-yazar, tek replica, sıfır kurulum). Set → `pg` Pool (async, çok-replica). Aynı `npx vitest run` suite **iki dialect'te de yeşil**; CI matrix (`db: [sqlite, postgres]` × Node 22/24) ikisini de koşar.
- **Multi-replica-safe webhook worker:** Postgres'te `FOR UPDATE SKIP LOCKED` + `RETURNING` ile job-claim → iki replica aynı delivery'i çift göndermez; sqlite'ta tek-call unique claim token aynı garantiyi tek-yazar altında verir.
- **Yerel pg:** `docker compose --profile postgres up -d` → `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ollamas` (`.env`). `DB_POOL_SIZE` (default 5) replica başına havuz.
- **Dialect farkları (adapter içinde gizli):** `?`→`$n` param rewrite, `AUTOINCREMENT`↔`GENERATED ALWAYS AS IDENTITY`, PRAGMA yalnız sqlite, pg COUNT/SUM string→`Number()` coercion, çift-tırnaklı mixed-case alias (pg lowercase-folding).

### v1.4 (Faz 13 — Production Operations Hardening, zero-dep)
Multi-replica yaşam döngüsünü güvenli kılan işletim katmanı:
- **Graceful shutdown:** `SIGTERM`/`SIGINT` → yeni bağlantı durdur, webhook worker'ı kapat, uçuştaki istekleri `SHUTDOWN_GRACE_MS` (10s) içinde drain et, pg pool'u kapat, `exit 0`. K8s rolling deploy stream/teslimat koparmaz.
- **Versiyonlu schema migrations:** `server/store/migrations.ts` — sıralı, append-only `MIGRATIONS` + `schema_migrations` tablosu, iki dialect. Boot'ta **advisory-lock** altında uygulanır (çok-replica boot çift-uygulamaz). Standalone: `tsx server.ts --migrate-only` (K8s pre-upgrade Job / Helm hook). Fresh DB baseline DDL'den, sonraki evrim migration kaydından.
- **Gerçek readiness:** `GET /api/ready` artık **DB ping** eder (`SELECT 1`) — pg down iken 503 (LB trafiği başka replica'ya yönlendirir). `GET /api/health` `db: up/down` raporlar ama liveness'a bağlamaz (DB blip pod restart etmez).
- **Deploy:** K8s `migration-job.yaml` (`--migrate-only`, `terminationGracePeriodSeconds: 30`) + `DATABASE_URL` Secret; Helm `pre-install/pre-upgrade` migration hook + Chart `appVersion 1.4.0`; compose `stop_grace_period: 30s`. Migration app içinden koşar — image'da `psql` GEREKMEZ.

### v1.5 (Faz 14 — MCP Protocol Completeness + Observability, zero-dep)
MCP spec yüzeyini derinleştir + multi-replica sistemin gözlemlenebilirliği:
- **MCP logging:** server `logging` capability ilan eder; `logging/setLevel` (RFC 5424 seviyeleri) + tool çağrılarında choke-point'ten `notifications/message` (level-gated; host/privileged tier `notice`). `MCP_LOG_LEVEL` taban. *(Not: stateless Streamable HTTP'de server→client notification teslimi best-effort.)*
- **Dürüst capabilities:** boş `{}` yerine gerçek yüzey ilan (`tools.listChanged:false`, `logging:{}`); server version 1.5.0.
- **Tool `outputSchema` + structured content:** `ToolDef` opsiyonel `outputSchema`; ListTools ilan eder; CallTool obje çıktıda `structuredContent` döner (text bloğu geriye-uyumlu korunur).
- **Observability depth (`/metrics`):** yeni Prometheus serileri — `ollamas_db_pool_connections{state}` (pg), `ollamas_migration_version`, `ollamas_webhook_queue_depth`, `ollamas_shutdown_total`. prom-client async `collect` ile store'dan pull. Zero-dep.

### v1.6 (Faz 15 — MCP Ecosystem Interop + Auth Completeness, zero-dep)
ollamas'ı dış dünyaya keşfedilebilir + standart auth-onboarding yapar. Proven spec/registry kodundan adopte (sıfırdan icat yok):
- **Registry manifest:** repo-kökü `server.json` (resmi `modelcontextprotocol/registry` formatı, schema `2025-12-11`, reverse-DNS `io.github.eCy-coding/ollamas`, `remotes[streamable-http]`). Yayına hazır; gerçek public push manuel/onaylı adım (workflow disabled).
- **HTTP discovery:** `GET /.well-known/mcp.json` — client'lar bağlanmadan önce capabilities + transport + auth gereksinimi + primitive özetini okur. Tek `MCP_SERVER_VERSION`/`MCP_CAPABILITIES` const'tan beslenir (drift-guard; canlı `/mcp` handshake ile birebir).
- **OAuth 2.1 Dynamic Client Registration (RFC 7591):** public `POST /register` → `client_id` (+ confidential client için `client_secret`, public `none` için secretsiz) + `registration_access_token`. Rate-limited; `DCR_INITIAL_ACCESS_TOKEN` set ise Bearer gate. `GET /.well-known/oauth-authorization-server` (RFC 8414) `registration_endpoint`'i ilan eder; RFC 9728 metadata `authorization_servers`'ı kendine işaret ettirir → DCR varsayılan keşfedilebilir.
- **Sınır:** DCR yalnız **client-metadata kaydı**. Token issuance (authorization/token endpoint) = tam OAuth 2.1 AS, backlog'da; ollamas hâlâ opaque API key (+ opsiyonel dış-AS JWT) ile auth eder.

**Resmi registry'ye yayınlama (hazır, gerçek push manuel):**
```
# 1) server.json'daki remotes[].url'i public adresinle değiştir (veya MCP_PUBLIC_URL set)
# 2) GitHub namespace sahipliğini doğrula + publish:
npx @modelcontextprotocol/publisher publish server.json   # dışa-dönük; onayla
```

### Güvenlik notu (§5)
`macos_terminal` / `write_host_file` = tam host yetkisi (privileged tier, sandbox yok).
Uzak tenant'a açmadan önce `MCP_EXPOSE_TIERS`'i daralt veya plan allowlist'ine güven.
Tüm env var'lar `.env.example`'da. Tüm SaaS yolları hermetik test altında (`npx vitest run`).

## Doğrulama (kalite kapısı)
Commit öncesi kanıt-temelli kapı (evidence over assertion — komutu koş, çıktıyı gör):
```bash
npm run lint && npm run test    # tsc --noEmit + full vitest suite (PBVC gate)
npm run test:e2e                # playwright (React lane)
npm run doctor                  # node/ollama/bridge/app health derin audit
```
Sınırlar: token İSİMLERİ loglanabilir, DEĞERLERİ asla · kök-neden önce · `npm run lint && npm run test` yeşil olmadan commit yok.
