# ODYSSEY O5 — Sistem-Geneli Extensibility + Sürdürülebilirlik

> **Odyssey planı** — ollamas'ı odysseus-kalitesinde self-hosted AI-workspace'e evrimleştirme.
> Bu dosya **O5 (Extensibility)** kapsamını kaplar: MCP-plugin sistemi + modular-service
> sınırları + config-driven `.env` + tool-schema registry + **"yeni feature nasıl eklenir"
> geliştirici rehberi**.
> **Dil:** TR · kod/komut/dosya-yolu: EN. **Yöntem:** her adım TDD (test-önce).
> **Kaynak-doğrulama tarihi:** 2026-07-10 — her iddia `/Users/emrecnyngmail.com/Desktop/ollamas`
> gerçek koduna karşı Read/Grep ile doğrulandı (aşağıda `dosya:satır` referansları).

---

## 0. Yönetici Özeti

ollamas'ın extensibility altyapısı **odysseus-parity'ye çok yakın, bazı eksenlerde ötesinde**.
odysseus'un extensibility sırrı üç ayak: **(a) MCP-as-extension**, **(b) modular-services**,
**(c) config-driven `.env` (40+ toggle)**. ollamas'ta üçü de mevcut ve olgun:

1. **Tek choke-point tool-registry** (`server/tool-registry.ts:831-962`) — TÜM tool çağrıları
   (ReAct loop + MCP expose + MCP consume) tek `ToolRegistry.execute()` üzerinden akıyor.
   `register()` / `unregisterByPrefix()` dinamik tool ekleme seam'i (`:852-862`).
2. **Interceptor chain** (`server/tool-interceptors.ts`) — choke-point'i yeniden düzenlemeden
   pre/post middleware takma (`registerInterceptor`, `:25`). Bugün secret-redaction + cache;
   yeni cross-cutting concern (rate-limit, audit, poison-guard) buraya plug-in.
3. **Config-driven `.env`** — `.env.example`'da **38 dökümante toggle** (grep ile sayıldı),
   her feature "graceful fallback" ile opt-in. odysseus'un 40+ emsaline denk.
4. **Üç MCP-extension yolu** — curated `catalog.ts` (one-click), global `tools.json`
   (`server.ts:617-643`), per-tenant store upstream'ler — hepsi supervisor + choke-point'e
   yönlenir (`server/mcp/supervisor.ts`).
5. **Manifest-driven host tools** — `scripts/inventory.json` (single source of truth) +
   zod schema (`bin/host-bridge/schema.mjs`) + drift-guard → `registerHostScripts()` boot'ta
   reconcile eder (`server.ts:102`).

**O5'in gerçek işi "sıfırdan sistem kurmak" DEĞİL**, dağınık seam'leri **formalize + belgelemek +
drift-guard'la kilitlemek**:

| # | Alt-modül | odysseus emsali | ollamas mevcut | Δ (delta / O5 işi) |
|---|-----------|-----------------|----------------|--------------------|
| O5.1 | **MCP-plugin sistemi** | `mcp_manager` + `mcp_servers` config | **VAR** — catalog + tools.json + supervisor; **3 dağınık yol** | Tek "extension manifest + lifecycle" soyutlaması |
| O5.2 | **Modular-service sınırları** | ayrık `services/` modülleri | **KISMİ** — `server.ts` 3191 satır monolit; alt-modüller (`server/mcp/`, `server/billing/`, `server/store/`) ayrık | Route-modülerleştirme + service-boundary sözleşmesi |
| O5.3 | **Config-driven `.env`** | 40+ `.env` toggle | **VAR** — 38 toggle, graceful fallback | Tek `config.ts` şema + validasyon + `envReport()` |
| O5.4 | **Tool-schema registry** | tool-policy + schema | **VAR ve olgun** — tier + outputSchema + ajv validasyon | Registry'yi tek public "extension API" olarak dondur + doc |
| O5.5 | **"Yeni feature nasıl eklenir" rehberi** | `CONTRIBUTING` / plugin-docs | **YOK** — dağınık AGENTS.md notları | `docs/DEVELOPER.md` + 3 recipe (tool / route / interceptor) |

**Kabul kriteri (üst düzey):** Yeni bir developer, **hiçbir choke-point'i değiştirmeden**,
belgelenmiş 3 recipe ile (1) yeni bir tool, (2) yeni bir MCP-upstream, (3) yeni bir cross-cutting
interceptor ekleyebilmeli; ekleme drift-guard + test-suite'ten geçmeli; config her yerde tek
`config.ts` şemasından okunmalı (dağınık `process.env` erişimi kalmamalı).

---

## 1. Mevcut Durum (kanıt-temelli, kod okundu)

### 1.1 Tool-registry — VAR ve olgun (extensibility'nin kalbi)

Merkezi soyutlama `server/tool-registry.ts` (971 satır). Sözleşme:

- **`ToolTier = "safe" | "host" | "privileged" | "host_upstream"`** (`:43`) — güvenlik katmanı.
- **`ToolSchema`** = OpenAI function-calling şeması, aynı zamanda MCP `inputSchema` (`:101-104`).
  Opsiyonel `outputSchema` (Faz 14B) → choke-point'te ajv ile valide edilir (`:944-952`).
- **`ToolDef`** = `{ tier, schema, invoke(args, ctx) }` (`:106-111`). Statik built-in tool'lar
  `const TOOLS: Record<string, ToolDef>` (`:195-816`); dinamik tool'lar `const DYNAMIC` (`:818`).
- **`ToolRegistry` public API** (`:831-962`):
  - `schemas()` — ReAct `tools:` param için (`:833`).
  - `list(tiers?, tenantId?)` — MCP expose + per-plan allowlist + per-tenant ownership filtre (`:843`).
  - **`register(name, def, owner?)`** — dinamik tool ekleme seam'i; `owner` verilirse tenant-scoped (`:852`).
  - **`unregisterByPrefix(prefix)`** — upstream silinince tool'ları kaldır (`:858`).
  - `has` / `tier` / `info` — introspection (`:864-876`).
  - **`execute(name, args, ctx)`** — THE choke-point (`:882-961`). Sırayla: unknown→reject →
    ownership-gate (`:895`) → tier-allowlist (`:901`) → scope-enforce (`:907`) → abort-check (`:913`)
    → PRE-interceptor (`:919`) → invoke (`:928`) → outputSchema-validate (`:946`) → POST-interceptor (`:954`).
    **Asla throw etmez** — caller `ok` okur.

> **Kanıt (AGENTS.md §4 invariant):** `tool-registry.ts:1-8` yorumu — "Single choke-point for
> ALL workspace tool execution. The ReAct loop, MCP server (expose) and MCP client (consume) all
> run tools through ToolRegistry.execute — never a second dispatch path."

### 1.2 Interceptor chain — VAR (cross-cutting extension seam)

`server/tool-interceptors.ts` — choke-point'i yeniden düzenlemeden pre/post middleware takma:

- **`ToolInterceptor = { name, pre?, post? }`** (`:15-21`). `pre` bir `ToolResult` döndürerek
  short-circuit edebilir (cache-hit); `post` sonucu registration sırasıyla dönüştürür.
- **`registerInterceptor(i)`** (`:25`) — extension seam. `runPre`/`runPost` (`:31-58`) choke-point'ten
  çağrılır. **Interceptor asla throw dışarı vermez** — hatalı olan atlanır + loglanır (sözleşme).
- Mevcut kayıtlı: **`redactionInterceptor`** (gitleaks/secretlint pattern'leri, `:101`) +
  **`cacheInterceptor`** (read-only, `:132`). Boot'ta register (`:153-154`).

> **odysseus-üstü:** odysseus'ta interceptor-as-plugin katmanı bu kadar formalize değil; ollamas'ın
> `docker/mcp-gateway --block-secrets` + IBM `mcp-context-forge` pattern'ini benimsemesi (`:1-6`).

### 1.3 MCP-plugin sistemi — VAR ama 3 DAĞINIK YOL

odysseus tek `mcp_servers` config'i; ollamas'ta üç ekleme yolu (bilinçli, farklı use-case):

1. **Curated `catalog.ts`** (`server/mcp/catalog.ts`) — one-click, vetted, MIT, stdio, zero-account.
   8 official reference server (memory, filesystem, git, fetch, time, sequential-thinking, playwright,
   everything). `CatalogEntry` şeması (`:14-26`) + `decorateCatalog()` host-availability check (`:175`).
2. **Global `tools.json`** (`server.ts:617-643`) — repo-kök manifest, `mcpServers[]`, ownerless
   (shared). Boot'ta okunur, her upstream `connectUpstream()` + supervisor'a verilir.
   `registry_version: 2.1.0`, `allowedTools[]` per-server allowlist (`tools.json:1-40`).
3. **Per-tenant store upstream'ler** — SaaS modda kiracıya özel, `owner` (tenantId) ile scoped.

Üçü de **tek yere yönlenir**: `connectUpstream()` (`server/mcp/client.ts`) → tool'ları
`ToolRegistry.register()` ile choke-point'e merge eder → `startSupervisor()` (`supervisor.ts:135`)
periyodik health-check + exponential-backoff + circuit-breaker ile besler.

- **`superviseUpstream` state-machine**: `connected | degraded | down` (`supervisor.ts:15`).
- **Tenant-isolation invariant** (Faz 24): reconnect `owner`'ı korur — bir reconnect per-tenant
  tool'u shared'a demote edemez (`supervisor.ts:8-9`, `client.ts` register owner-preserving).
- **Config toggle**: `MCP_HEALTH_INTERVAL_MS`, `MCP_CB_BASE_BACKOFF_MS`, `MCP_CB_MAX_BACKOFF_MS`,
  `MCP_CB_COOLDOWN_MS`, `MCP_CB_MAX_CYCLES` (`supervisor.ts:44-52`).

### 1.4 Manifest-driven host tools — VAR (drift-guard'lı)

Host-lane tool'ları (host makinede çalışan) **manifest-driven register-seam** ile eklenir:

- **`scripts/inventory.json`** — single source of truth. 20 host tool, her biri
  `{ name, tier, entry, description }` (`inventory.json:1-25`). `version: 18.0.0`, `namespace: "host_"`.
- **`bin/host-bridge/schema.mjs`** — zod input-şema (single source), `zodToJsonSchema` ile
  registry'nin beklediği JSON-schema'ya derive edilir (`schema.mjs:11-32`). `validateArgs()` (`:52`).
- **`bin/host-bridge/register-host-scripts.mjs`** — THE register-seam (`:1-18`). inventory okur,
  zod valide eder, JSON-schema derive eder, choke-point'e **idempotent reconcile** eder (built-in
  varsa skip). Boot'ta çağrılır (`server.ts:102`).
- **Drift-guard ENFORCED** (`bin/host-bridge/drift-check.mjs`, CI'da `scripts-ci.yml`): inventory
  names == schema.mjs keys == register BUILDERS == `tools/*.mjs` dosyaları — hepsi eşleşmeli
  (`inventory.json:$comment`). Bir tool ekleyip birini unutursan CI kırılır.

> **odysseus-üstü:** Bu manifest + zod + drift-guard üçlüsü, "yeni host tool ekle" işini
> **compile-time garantili** yapar; odysseus'ta host-tool ekleme daha manuel.

### 1.5 Config-driven `.env` — VAR (38 toggle, graceful fallback)

`.env.example` **38 dökümante toggle** (grep sayımı: 19 aktif + 19 opsiyonel-comment). Her feature
"unset → sane default / graceful fallback" prensibiyle opt-in. Faz-etiketli gruplar:

| Grup | Örnek toggle | Fallback davranışı |
|------|-------------|--------------------|
| Core | `PORT`, `OLLAMA_HOST`, `OLLAMA_NUM_CTX` | localhost/11434/8192 |
| SaaS gateway | `SAAS_ENFORCE`, `SAAS_ADMIN_TOKEN`, `MCP_EXPOSE_TIERS`, `MCP_AUTO_APPLY` | tek-kullanıcı localhost (no auth) |
| OAuth (Faz 9B) | `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_JWKS_URI` | opaque `olm_` key'ler çalışır |
| Store (Faz 12) | `DATABASE_URL`, `DB_POOL_SIZE` | node:sqlite (single-writer) |
| Lifecycle (Faz 13) | `SHUTDOWN_GRACE_MS`, `--migrate-only` | 10s drain |
| MCP interop (Faz 15) | `MCP_PUBLIC_URL`, `DCR_INITIAL_ACCESS_TOKEN`, `MCP_LOG_LEVEL` | request'ten türet |
| Supervisor (Faz 27) | `MCP_HEALTH_INTERVAL_MS`, `MCP_CB_*` | connect-once (no supervisor) |
| Webhooks (Faz 11) | `WEBHOOK_RETRY_MAX_ATTEMPTS`, `WEBHOOK_WORKER_INTERVAL_MS` | 5 attempt / 30s |
| Rate-limit | `REDIS_URL`, `RATE_LIMIT_MAX_BUCKETS` | in-memory bucket |

**Eksik (O5.3 işi):** Config **dağınık `process.env.X` erişimiyle** okunuyor (supervisor, server,
interceptor'lar her biri kendi `process.env` okuyor — merkezi şema yok). Bir `config.ts` +
boot-time validasyon + `envReport()` yok. odysseus'ta config tek noktadan valide edilir.

### 1.6 Modular-service sınırları — KISMİ

- **Ayrık alt-modüller VAR**: `server/mcp/` (MCP), `server/billing/`, `server/store/`,
  `server/middleware/`, `server/lib/` — sorumluluk ayrımı net.
- **Ama `server.ts` = 3191 satır monolit** — 100+ route inline tanımlı (`app.get/post`
  doğrudan `server.ts`'te, `:129-519+`). Route grupları modüle çıkarılmamış.
- **Service-boundary sözleşmesi yok**: `ToolDeps` injection (`tool-registry.ts:46-55`) iyi bir
  DI örneği (host helper'ları inject edilir, circular import yok) ama route/service katmanında
  benzer bir kontrat yok.

### 1.7 Frontend extensibility — KISMİ

- **34 component** (`src/components/`), her feature bir panel (ör. `IntegrationsPanel.tsx`,
  `KeyVault.tsx`, `MultiAgentPipeline.tsx`). `CapabilityGate.tsx` var — feature-flag'e göre UI gate.
- **Ama component-registry / plugin-panel soyutlaması yok** — yeni panel eklemek elle App'e wire
  gerektirir. (Not: bu, odysseus'un VanillaJS'ine göre zaten daha modüler; O5 kapsamında düşük öncelik.)

---

## 2. odysseus-Referans (parity hedefi)

odysseus extensibility mimarisinin ollamas'a eşlenmesi:

| odysseus konsept | odysseus mekanizma | ollamas karşılığı | parity durumu |
|------------------|--------------------|--------------------|---------------|
| **MCP-as-extension** | `mcp_manager` + `.env` server config | catalog + tools.json + supervisor | ✅ VAR (3 yol, formalize gerek) |
| **modular-services** | `services/*.py` ayrık modüller | `server/{mcp,billing,store}/` + monolit `server.ts` | ⚠️ KISMİ (route-split gerek) |
| **config-driven** | 40+ `.env` toggle | 38 toggle | ✅ VAR (merkezi şema gerek) |
| **tool-policy** | admin/non-admin tool gating | `ToolTier` + `allowedTiers` + scope | ✅ VAR ve olgun |
| **tool-schema** | JSON-schema tool defs | `ToolSchema` + `outputSchema` + ajv | ✅ VAR ve olgun |
| **plugin lifecycle** | load → register → health → unload | connect → register → supervise → unregisterByPrefix | ✅ VAR |
| **extension docs** | plugin-docs / CONTRIBUTING | dağınık AGENTS.md notları | ❌ YOK (O5.5) |

**Sonuç:** ollamas'ın extensibility motoru odysseus-parity'de ya da üstünde (interceptor chain +
drift-guard + outputSchema-validation odysseus'ta yok). **Parity boşluğu belge + formalizasyon**,
motor değil.

---

## 3. Hedef Plan (TDD-adımlı)

> **TDD disiplini:** her adımda önce test yaz (kırmızı), sonra implement (yeşil), sonra refactor.
> Kabul: `npm test` (vitest) + `npm run lint` (tsc --noEmit) fresh-run geçmeli.

### O5-Adım 1 — Config merkezi şema (`server/config.ts`)

**Amaç:** Dağınık `process.env.X` erişimini tek şema + boot-time validasyon arkasına al.

1. **Test-önce** (`server/__tests__/config.test.ts`):
   - `loadConfig(env)` bilinen key'leri parse eder, tip-güvenli (`PORT: number`, `SAAS_ENFORCE: boolean`).
   - Eksik zorunlu (`SAAS_ADMIN_TOKEN` when `SAAS_ENFORCE=1`) → validasyon hatası (fail-closed).
   - `envReport()` set/unset + fallback değeri döndürür (secret VALUE maskeli, key görünür).
   - Bilinmeyen `MCP_*`/`OAUTH_*` key uyarı verir (typo-guard), fatal değil.
2. **Implement:** `server/config.ts` — zod şema (host-bridge `schema.mjs` pattern'i), `.env.example`'daki
   38 key'i tanımla, her birine default + Faz-etiketi. `process.env` erişimini bu modüle centralize et.
3. **Refactor:** supervisor/server/interceptor'lardaki `process.env.X` → `config.X`. Choke-point
   değişmez.
4. **Kabul:** `.env.example` key sayısı == `config.ts` şema key sayısı (yeni bir drift-guard testi).

### O5-Adım 2 — Extension-manifest soyutlaması (MCP-plugin lifecycle birleştirme)

**Amaç:** 3 dağınık MCP-ekleme yolunu (catalog / tools.json / per-tenant) tek `ExtensionManifest`
soyutlaması + lifecycle state-machine arkasına al.

1. **Test-önce** (`server/mcp/__tests__/extension.test.ts`):
   - `parseManifest(json)` catalog-entry + tools.json-entry + store-upstream'i tek `ExtensionManifest`e
     normalize eder.
   - `installExtension(manifest, owner?)` → `connectUpstream` + `ToolRegistry.register` + supervisor'a
     ekler; `uninstallExtension(name)` → `unregisterByPrefix` + `disconnectUpstream`.
   - Aynı tool-adı iki upstream'de → collision surface edilir (supervisor `toolOwners` map, `supervisor.ts:37`).
   - owner-preserving: reconnect owner'ı korur (mevcut invariant regresyon testi).
2. **Implement:** `server/mcp/extension.ts` — `ExtensionManifest` type + `install/uninstall` fonksiyonları.
   `server.ts:617-643` (tools.json boot) + catalog install endpoint'i bu API'yi çağıracak şekilde refactor.
3. **Kabul:** Üç yolun tümü `installExtension` üzerinden akar; `server.ts`'te doğrudan `connectUpstream`
   çağrısı kalmaz (grep 0).

### O5-Adım 3 — "Yeni feature nasıl eklenir" geliştirici rehberi (`docs/DEVELOPER.md`)

**Amaç:** O5.5 boşluğu — 3 executable recipe + drift-guard referansı.

1. **Test-önce** (`tests/developer-recipes.test.ts` — doc'un canlı kanıtı):
   - **Recipe A (yeni tool):** doc'taki örnek tool tanımını `TOOLS`'a eklemeden, aynı şekli
     `ToolRegistry.register()` ile ekleyip `execute()`'un çalıştığını doğrula. Recipe kod snippet'i
     gerçekten derlenmeli/çalışmalı (doc-drift guard).
   - **Recipe B (yeni host tool):** inventory'ye örnek tool ekleyip `drift-check.mjs`'in yeşil kaldığını
     (name/schema/builder/file 4'ü de mevcut) doğrula.
   - **Recipe C (yeni interceptor):** örnek interceptor `registerInterceptor` ile eklenince
     `interceptorNames()` içinde göründüğünü + `runPost`'un çağırdığını doğrula.
2. **Implement:** `docs/DEVELOPER.md` — 3 recipe (aşağıda §4 taslağı), her biri gerçek dosya:satır
   seam referansı + "hangi choke-point'e dokunma" uyarısı.
3. **Kabul:** Yeni bir developer doc'u okuyup 3 recipe'i **choke-point'i değiştirmeden** uygular;
   `tests/developer-recipes.test.ts` yeşil.

### O5-Adım 4 — Route-modülerleştirme (modular-service sınırı)

**Amaç:** `server.ts` (3191 satır) monolitini route-modüllerine böl; service-boundary kontratı ekle.

1. **Test-önce** (`server/__tests__/routes.test.ts`):
   - Her route-modülü `mountRoutes(app, deps)` imzasıyla export eder (DI kontratı, `ToolDeps` pattern'i).
   - Supertest ile mevcut endpoint davranışı **birebir korunur** (regresyon guard) — ör.
     `/api/github/actions/*`, `/api/revenue/*`, `/api/ecysearcher/*`.
2. **Implement:** `server/routes/{github,revenue,ecysearcher,integrations,notify}.ts` — ilgili
   `app.get/post` blokları taşınır (`server.ts:298-519`). `server.ts` sadece bootstrap + mount kalır.
3. **Refactor kuralı:** Davranış değişmez (yalnız taşıma); choke-point ve middleware sırası korunur.
4. **Kabul:** `server.ts` < 800 satır; tüm mevcut e2e/smoke test'ler (`npm run smoke`, `test:e2e:web`) geçer.

### O5-Adım 5 — Extensibility observability (`envReport` + `extensions` endpoint)

**Amaç:** Bir operatör "hangi feature açık, hangi extension yüklü, hangi tool hangi tier'da" görebilsin.

1. **Test-önce:** `GET /api/extensions` → `{ tools: [...tier], upstreams: [...state], config: envReport() }`.
   `SAAS_ENFORCE=1` iken admin-guard'lı (mevcut `adminGuard`, `server.ts:2566`).
2. **Implement:** endpoint + frontend `ObservabilityPanel.tsx`'e "Extensions" sekmesi (mevcut panel var).
3. **Kabul:** endpoint config-report + registry-list + supervisor-status birleştirir; secret VALUE maskeli.

---

## 4. `docs/DEVELOPER.md` Taslağı — "Yeni Feature Nasıl Eklenir" (3 Recipe)

> Bu §, O5-Adım 3'ün üreteceği belgenin iskeletidir. **Altın kural:** hiçbir recipe choke-point'i
> (`ToolRegistry.execute`, `runPre/runPost`) DEĞİŞTİRMEZ — hepsi belgelenmiş seam'i kullanır.

### Recipe A — Yeni bir tool ekle

**İki yol var:**
- **Statik built-in** (ürünün parçası): `server/tool-registry.ts` `TOOLS` map'ine
  `{ tier, schema: fn(name, desc, params, outputSchema?), invoke }` ekle. Tier seç:
  `safe` (read-only, `readOnlyHint`), `host` (host-mutasyon), `privileged` (tam host yetkisi).
  outputSchema verirsen choke-point ajv ile valide eder.
- **Dinamik** (runtime/upstream): `ToolRegistry.register(name, def, owner?)` çağır. `owner`
  (tenantId) verirsen tool tenant-scoped olur (cross-tenant invoke reddedilir).

**Dokunma:** `execute()` gövdesi. **Test:** `tests/tool-registry.test.ts` pattern'i.

### Recipe B — Yeni bir host tool ekle (host makinede çalışan)

Dört yeri **birlikte** güncelle (drift-guard hepsini zorunlu kılar):
1. `scripts/inventory.json` → `{ name, tier, entry, description }`.
2. `bin/host-bridge/schema.mjs` → `SCHEMAS[name] = z.object({...}).strict()`.
3. `bin/host-bridge/register-host-scripts.mjs` → `BUILDERS[name] = (args, deps) => ({ argv, timeoutMs? })`.
4. `bin/host-bridge/tools/<entry>.mjs` → gerçek script.

Sonra `node bin/host-bridge/drift-check.mjs` yeşil olmalı. `registerHostScripts()` boot'ta
idempotent register eder (`server.ts:102`).

### Recipe C — Yeni bir cross-cutting interceptor ekle (audit / rate-limit / poison-guard)

`server/tool-interceptors.ts`:
```ts
export const myInterceptor: ToolInterceptor = {
  name: "my-concern",
  pre(tool, args, ctx, tier) { /* return ToolResult to short-circuit */ },
  post(tool, args, ctx, tier, r) { /* transform + return r */ },
};
registerInterceptor(myInterceptor);
```
**Sözleşme:** asla throw dışarı verme (hatalı olan atlanır). **Dokunma:** `runPre/runPost`.
**Test:** interceptor'ı register et, `interceptorNames()` + `execute()` davranışını doğrula.

### Recipe D — Yeni bir MCP-upstream ekle (O5-Adım 2 sonrası)

`tools.json` `mcpServers[]`'a entry ekle (global/shared) VEYA catalog'dan one-click install
(curated) VEYA store upstream API (per-tenant). Üçü de `installExtension()`'a yönlenir →
`connectUpstream` + `register` + supervisor. `unregisterByPrefix` ile temiz kaldırma.

---

## 5. odysseus-Parity Kabul Kriteri

O5 "done" sayılır ⟺ **hepsi** sağlanır:

1. **[O5.1]** Üç MCP-ekleme yolu tek `installExtension()`/`ExtensionManifest` arkasında; `server.ts`'te
   doğrudan `connectUpstream` çağrısı yok (grep 0). Lifecycle state-machine (`connected/degraded/down`)
   + owner-preserving reconnect korunur.
2. **[O5.2]** `server.ts` < 800 satır; route-grupları `server/routes/*.ts` altında `mountRoutes(app, deps)`
   kontratıyla; tüm mevcut e2e/smoke test'ler regresyonsuz geçer.
3. **[O5.3]** Tek `server/config.ts` şema; dağınık `process.env.X` erişimi kalmadı (choke-point + middleware
   dışında grep 0); boot-time validasyon fail-closed; `.env.example` ↔ `config.ts` drift-guard testi yeşil.
4. **[O5.4]** Tool-schema registry public API (`register/unregister/list/execute`) dondurulmuş + doc'lu;
   `outputSchema` + tier + ownership invariant'ları test-kapsamlı (mevcut + yeni).
5. **[O5.5]** `docs/DEVELOPER.md` 4 recipe (tool / host-tool / interceptor / upstream) + `tests/developer-recipes.test.ts`
   canlı-doc guard yeşil; yeni developer choke-point'e dokunmadan feature ekleyebiliyor.
6. **[genel]** `npm test` + `npm run lint` + `drift-check.mjs` fresh-run geçer; hiçbir choke-point
   invariant'ı (AGENTS.md §4 tek-dispatch) kırılmadı.

**Nicel hedef:** extensibility "yeni-feature-ekleme süresi" — yeni bir tool için ≤ 1 dosya + 1 test
(dinamik) ya da ≤ 4 dosya (host, drift-guard'lı); yeni upstream için ≤ 1 manifest entry; yeni
cross-cutting concern için ≤ 1 interceptor. Hiçbiri choke-point diff'i gerektirmez.

---

## 6. Kör-Nokta Ledger

> **Kural (CLAUDE.md §4):** CRITICAL gizleme YASAK — bilinmeyen/varsayım/risk açıkça listelenir.

| # | Tür | Kör-nokta / Varsayım / Risk | Etki | Azaltma |
|---|-----|------------------------------|------|---------|
| KN-1 | **Varsayım** | odysseus'un tam extensibility API'si (github.com/pewdiepie-archdaemon/odysseus) **doğrudan okunmadı** — "mcp_manager + 40+ toggle + modular-services" görev-brief'inden alındı. Gerçek odysseus internal'i farklı olabilir. | Parity kriteri brief-temelli, kod-temelli değil | O5-Adım 0: odysseus repo'sunu klonla + `mcp_manager` + `.env.example` gerçek dosyalarını oku, tabloyu revize et |
| KN-2 | **Kör-nokta** | `server/mcp/client.ts` (`connectUpstream`/`UpstreamConfig` imzası) **tam okunmadı** — grep 0 döndü (fonksiyon farklı isimle export ediliyor olabilir). O5-Adım 2 bu imzaya bağımlı. | Extension-manifest refactor'ı yanlış imza varsayabilir | Adım 2 öncesi `client.ts`'i tam oku; `UpstreamConfig` şeklini doğrula |
| KN-3 | **Risk** | **Örtüşme:** `05-features/mcp-extensions.md` zaten "plugin-ekleme protokolü + tool-registry lifecycle + hook framework (gwv2)" kapsıyor. O5.1/O5.2 ile çakışma var. | Çift-iş / tutarsız plan | 00-MASTER.md'de O5 (sistem-katmanı: config + route-split + dev-guide) vs 05-mcp-extensions (feature-katmanı: plugin-protokol) sınırını netleştir; O5.1'i "manifest birleştirme"ye daralt, protokol detayını mcp-extensions'a bırak |
| KN-4 | **Risk** | **Route-split regresyon riski** yüksek: `server.ts` 3191 satır, 100+ inline route, webhook `express.raw` sıralaması (`:251-263`) ve middleware order kritik. Yanlış taşıma auth/CORS/rate-limit sırasını bozar. | Prod auth-bypass / CORS kırılması | Adım 4 saf-taşıma; supertest regresyon suite ZORUNLU; middleware order snapshot testi; küçük partiler (bir route-grubu / PR) |
| KN-5 | **Varsayım** | `.env.example` "38 toggle" sayımı `grep -E '(^|# )[A-Z_]+='` ile; bazı satırlar açıklama-only olabilir (over/under-count ±3). odysseus "40+" ile karşılaştırma yaklaşık. | Parity nicel iddiası ±3 hatalı | `config.ts` şeması yazılınca kesin sayı oradan gelir; `.env.example` ↔ `config.ts` drift testi kesinleştirir |
| KN-6 | **Kör-nokta** | **Frontend extensibility** (component-registry / plugin-panel) O5'te düşük-öncelik bırakıldı — ama Claude Design handoff akışı (03-claude-design-ui.md) yeni panel'leri elle-wire gerektiriyor. Design→Code handoff sık ise bu darboğaz. | Design-handoff friction | Ayrı ele al (03-claude-design-ui ile koordine); O5 kapsamı backend-extensibility ile sınırlı tutuldu |
| KN-7 | **Risk** | **Interceptor sırası bağımlılığı**: yeni interceptor (poison-guard, O6.5) redaction'dan ÖNCE mi SONRA mı çalışmalı? `runPost` registration-sırası (`:44-56`). Yanlış sıra secret leak / injection kaçağı. | Güvenlik regresyon | Interceptor register-order'ını explicit belgele (`docs/DEVELOPER.md` Recipe C); order-sensitive testi ekle |
| KN-8 | **Bilinmeyen** | `config.ts` refactor'ın **test/e2e ortam** etkisi: bazı test'ler `process.env`'i doğrudan mock'luyor olabilir (`vitest` setup). Centralize edince mock'lar kırılabilir. | Test-suite kırılması | Adım 1'de `loadConfig(env)` **injectable** (host-bridge `schema.mjs` gibi pure) — global `process.env` yerine parametre; testler env inject eder |

---

## 7. Bağımlılık ve Sıra

```
O5-Adım 1 (config.ts)  ──┐
                          ├─→ O5-Adım 5 (observability: envReport)
O5-Adım 2 (extension)  ──┤
                          └─→ O5-Adım 3 (DEVELOPER.md: recipe'ler seam'lere bağlı)
O5-Adım 4 (route-split) ── bağımsız, en riskli, EN SON (regresyon guard olgunlaşınca)
```

- **Önce KN-1 + KN-2** kapat (odysseus + client.ts oku) — plan varsayımlarını sağlamlaştır.
- **Sonra KN-3** kapat (00-MASTER'da O5 ↔ 05-mcp-extensions sınırı) — çift-iş önle.
- Adım 1 → 2 → 3 → 5 sıralı; Adım 4 bağımsız + en son (yüksek regresyon riski).
- Her adım kendi TDD döngüsü; hiçbiri AGENTS.md §4 tek-choke-point invariant'ını kırmaz.
