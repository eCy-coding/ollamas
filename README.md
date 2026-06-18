# LLM Mission Control: Distributed Mesh

LLM Mission Control, kişisel bilgisayarların GPU/RAM kaynaklarını birleştirerek devasa modelleri (70B+) yerel ağınızda çalıştırmanıza olanak tanıyan, şeffaf ve gönüllülük esasına dayalı bir dağıtık çıkarım (inference) ağıdır.

## Teknik Şartname & Güvenlik (Hard Laws)
- **Güvenlik (§0-§6):** Tüm yabancı kodlar WASM sandbox içerisinde çalışır.
- **Gizlilik:** Kişisel veriler asla makineden çıkmaz. Sadece model katman aktivasyonları mesh üzerinden iletilir.
- **Gönüllülük:** Hiçbir makine izinsiz katılamaz, "opt-out" bir tıkla gerçekleşir.

## Kurulum ve Çalıştırma (macOS M4 Pro Max / ARM64)

Bu proje macOS (ARM64) üzerinde en yüksek performans için optimize edilmiştir.
M4 Pro Max için "Master" seviyesi ince ayarlar:

### 1. E2E Master Workflow (iTerm2 / Terminal)

1. **Ön Hazırlık:**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

2. **Server Başlatma:**
   ```bash
   npm run dev
   # Port 3000 üzerinde orchestrator aktif olur.
   ```

3. **Cluster Mesh'e Dahil Olma:**
   - Web arayüzünden informed consent onayını verin.
   - Orchestrator M4 Pro Max çip mimarisini otomatik olarak kalibre edecektir (`./bin/hardware_orchestrator` üzerinden).

4. **Doğrulama Görevleri:**
   - `G-Cluster` ve `G-Sandbox` testlerini `G-Gates` panelinden tetikleyin.
   - Şüpheli bir durumda `project_cortex.md` dosyasını `tail -f project_cortex.md` komutuyla izleyin, tüm hatalar buraya düşer.

### 2. İnce Performans Ayarları (M4 Pro Max için):
   - Cluster ayarlarından `Performance Flags` kısmına şunu girmenizi öneririz:
     `--metal --threads 12 --batch-size 512`
   - Bu, Apple Metal hızlandırmasını tetikler ve M4'ün yüksek-performans çekirdeklerini optimize eder.

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

### Güvenlik notu (§5)
`macos_terminal` / `write_host_file` = tam host yetkisi (privileged tier, sandbox yok).
Uzak tenant'a açmadan önce `MCP_EXPOSE_TIERS`'i daralt veya plan allowlist'ine güven.
Tüm env var'lar `.env.example`'da. Tüm SaaS yolları hermetik test altında (`npx vitest run`).

## Doğrulama Kapıları (G-Gates)
Sistemin dürüstlüğünü kanıtlayan kapılar:
- **G-Cluster:** İletişim testi.
- **G-Sandbox:** WASM/WASI izolasyon testi.
- **G-Governor:** CPU/VRAM kaynak kısıtlama testi.
- **G-Durability:** Düğüm arızasında Pause-Replicate-Retry testi.
