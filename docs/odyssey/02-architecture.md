# ODYSSEY 02 — Hedef Mimari: 10 Adoption-Pattern + Mevcut→Hedef Diff (TDD-Adımlı)

> **Belge amacı:** ODYSSEY programının **mimari omurgası** (00-MASTER §3'te O0+O1 olarak işaret edilen
> "temel katman + modüler servis ayrıştırması"). Mevcut **ollamas** stack'ini (`server.ts` 3191 satır tek
> dosya, `orchestration/` fleet, `server/mcp/*` host, $0-local qwen3:8b + cloud katalog) **odysseus'un 10
> adoption-pattern'i** ile hizalar; her pattern için **mevcut-durum → hedef → diff → TDD-adım**.
> **Doğrulama disiplini:** her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek koduna karşı
> Read/Grep ile doğrulandı (tarih **2026-07-10**). Aşağıda `dosya:satır` referansları verilir.
> **Dil:** TR (anlatı) · EN (kod/komut/dosya-yolu). **Yöntem:** her adım **TDD (test-önce)**.
> **Claude Design sınırı (değişmez):** Claude Design yalnız **UI-prototip üretir** (HTML+screenshot+README
> handoff); bu belgedeki hiçbir backend/servis/DB/adapter'ı **üretmez**, localhost/MCP'ye **bağlanamaz**.
> Bu belge tümüyle **Claude Code implementasyon** kapsamıdır.

---

## 0. TL;DR (tek nefes)

ollamas mimarisi bugün **iki eksende olgun, bir eksende monolitik**:

- **Olgun (koru + genişlet):** `server/mcp/*` choke-point host'u (MCP-as-extension'ın %70'i hazır),
  `server/tool-registry.ts` tier'lı schema-registry + tek `execute()` choke-point, `server/store` çift-dialekt
  (SQLite↔pg) tenant persistence, `server/middleware/*` auth+rate-limit, `server/tool-interceptors.ts`
  pre/post middleware-stack, `providers.ts` dual-model fallback-chain, `server/rag.ts` sqlite-vec vektör-store.
- **Monolitik (böl):** `server.ts` **3191 satır / ~163 KB tek dosya** — 200+ route, ~90 modül import'u,
  in-line iş mantığı. odysseus'un "modular-services" deseni burada **yok**; her yeni O4-modül (research,
  documents, email, notes, calendar) bu tek dosyayı daha da şişirir.
- **En kritik bulgu — ÜÇ ayrı persistence dünyası:** (1) `server/db.ts` = JSON-file şifreli vault +
  session/security-event (lowdb-benzeri, keychain master-key, `atomicWriteFileSync`), (2) `server/store/*`
  = SQLite/pg tenant+billing+oauth (versiyonlu migration), (3) `server/rag.ts` = **ayrı** `DatabaseSync`
  (`allowExtension:true`, sqlite-vec). Yeni O4-modüllerin (notes/tasks/documents/calendar) hangi dünyaya
  yazacağı **kararlaştırılmamış** → **O0 blocker** (00-MASTER KN-M4).

**Hedef mimari = "monolit'i bölmeden ölmeden" 10-pattern hizalama:** `server.ts`'i tek seferde parçalamayı
zorlamak yerine, her yeni modülü `server/modules/<name>/` modular-service olarak doğur; `module-registry`
config-toggle ile route'ları mount et; persistence'ı **tek `store` katmanına** (SQLite/pg + sqlite-vec)
yakınsat. Böylece 10 pattern **tek çıkış-kapısı**yla ölçülür: `MODULE_REGISTRY.enabled(id)` true iken modül
route+servis+UI-tab+persistence GREEN, `.env` toggle ile açılır-kapanır, kalite kapısı (typecheck+lint+test)
geçer.

---

## 1. Mevcut Mimari — Katman Haritası (koda karşı doğrulanmış)

### 1.1 Süreç topolojisi (tek Node process, gömülü Vite)

```
                         ┌─────────────────────────── server.ts (3191 satır) ───────────────────────────┐
  HTTP :PORT ──▶ helmet ─┤  pinoHttp ─▶ raw-body seams (billing/github/upload/transcribe)               │
  (server.ts:111)        │  ─▶ express.json(50mb) ─▶ localOwnerGuard (SAAS_ENFORCE) ─▶ 200+ route        │
                         │      · /metrics /api/health /api/ready /api/orchestra                          │
                         │      · /api/ai/* /api/agent/* /api/pipeline/* /api/generate                    │
                         │      · /api/github/* /api/revenue/* /api/billing/* /api/saas/*                  │
                         │      · /mcp  ──▶ handleMcpRequest(ctxFactory)  [server/mcp/server.ts]           │
                         │      · Vite middleware (dev) / static dist (prod)                               │
                         └──────────────────────────────────────────────────────────────────────────────┘
        │                          │                         │                          │
        ▼                          ▼                         ▼                          ▼
  server/tool-registry.ts    server/store/*          server/providers.ts        server/mcp/*
  (choke-point execute)      (SQLite↔pg adapter)     (dual-model chain)          (host + upstream federation)
        │                          │                         │                          │
        ▼                          ▼                         ▼                          ▼
  server/tool-interceptors   migrations.ts (v1..6)   ollama-local → cloud → demo  client/supervisor/catalog
  (pre/post redact+cache)    server/rag.ts (sqlite-vec)                            + tool-interceptors chain
```

### 1.2 Doğrulanmış bileşen envanteri (`dosya:satır`)

| Katman | Dosya | Kanıt | Rol |
|---|---|---|---|
| HTTP giriş | `server.ts:111-297` | helmet + pinoHttp + raw-body seam'ler + `express.json(50mb)` | Tek giriş noktası |
| Owner-guard | `server.ts` (`localOwnerGuard`, 07-security §2.1 doğr.) | `SAAS_ENFORCE=1` fail-closed 403 | Tek-owner dashboard koruması |
| Auth | `server/middleware/auth.ts:99-124` | 3 kimlik yolu (`olm_`/`ot_`/JWT) | tenant+plan+scopes → `req.tenant` |
| Rate-limit | `server/middleware/rate-limit.ts` | token-bucket + Redis-opsiyonel + DoS-evict | per-tenant kota |
| Tool choke-point | `server/tool-registry.ts:882-961` (`execute`) | tek gate: ownership→allowedTiers→scope→pre→invoke→outputSchema→post | **Tüm tool çağrıları buradan** |
| Tool schema | `server/tool-registry.ts:101-108` (`ToolSchema`/`ToolDef`) + `getValidator` (ajv) | OpenAI fn-schema = MCP inputSchema; `outputSchema` ajv-doğrulanır | Schema-registry |
| Interceptor | `server/tool-interceptors.ts:31-52` (`runPre`/`runPost`) | ordered pre/post, "asla throw etmez" | middleware-stack |
| MCP host | `server/mcp/server.ts:36-252` | `MCP_PROTOCOL_VERSION=2025-06-18`, tools/resources/prompts/completions | Choke-point'e köprü |
| MCP federation | `server/mcp/{client,supervisor,catalog}.ts` | `superviseUpstream`, `computeBackoff`, collision-detect | Upstream MCP birleştirme |
| Dual-model | `server/providers.ts:1-1504` + `server/ai.ts` | `ProviderRouter` fallback `ollama-local → cloud → demo` | $0-local öncelik |
| Tenant store | `server/store/index.ts:1-634` + `db-adapter.ts` | SQLite (default) ↔ pg (`DATABASE_URL`) | Çok-replika-hazır |
| Migration | `server/store/migrations.ts:34-204` | v1..6, append-only, advisory-lock | Versiyonlu şema |
| Vektör-store | `server/rag.ts:9-176` + `embed-catalog.ts` | **ayrı** `DatabaseSync{allowExtension}` + sqlite-vec | RAG (rag_index/rag_search) |
| Config-vault | `server/db.ts:1-30+` | JSON-file + keychain + `atomicWriteFileSync` | Şifreli key-vault, session |
| Frontend | `src/App.tsx:63-235` | 21 tab, `activeTab` state, `isTabEnabled(perms)` gate | Kokpit UI |
| PWA | `vite.config.ts:5-33` (`VitePWA autoUpdate`) | manifest + workbox | Offline/web-clip |

### 1.3 Config-toggle taban çizgisi (koda karşı)

`.env.example` = **21** toggle (`grep -cE '^[A-Z_]+='`). Önekler: `MCP_*`×3, `WEBHOOK_*`×3, `SAAS_*`×2,
`OLLAMA_*`×2, ayrıca `OAUTH_ISSUER`, `RATE_*`, `DB_*`, `BILLING_*`, `LOG_*`. Kod içinde çok daha fazla
runtime-toggle okunuyor (ör. `MCP_EXPOSE_TIERS`, `MCP_SAMPLING`, `MCP_REDACT`, `MCP_CACHE_TTL_MS`,
`MCP_HEALTH_INTERVAL_MS`, `MCP_UPSTREAM_ALLOW_ANY`, `SAAS_ENFORCE`, `SAAS_ADMIN_TOKEN`, `REDIS_URL`,
`DATABASE_URL`, `EMBED_PROVIDER`, `MAC_MODEL_CHAMPION`). → **config-driven pattern %70 hazır**, ama
`.env.example` **eksik-belgeli** (kod-toggle > belgelenmiş-toggle) ve **`MODULE_*` modül-toggle ailesi YOK**.

---

## 2. odysseus Referansı — 10 Adoption-Pattern (kavram-parity, birebir-port değil)

odysseus (FastAPI + VanillaJS + SQLite + ChromaDB + Docker, 82k★) extensibility sırrı **üç sütun**:
MCP-as-extension + modular-services + config-driven `.env` (40+ toggle). Bu belge bu üçü + yedi tamamlayıcı
pattern'i **ollamas'ın Node/TS stack'ine** kavramsal olarak taşır (FastAPI→Express, ChromaDB→sqlite-vec,
Python-service→`server/modules/*`).

| # | Pattern | odysseus emsali | ollamas'ta karşılığı |
|---|---|---|---|
| P1 | **MCP-as-extension** | `mcp_manager` + `mcp_servers` plugin sistemi | `server/mcp/*` federation (%70) → +manifest/lifecycle |
| P2 | **Modular-services** | `open_webui/*` servis modülleri (router+service ayrık) | **YOK** — `server.ts` monolit → `server/modules/<name>/` |
| P3 | **Dual-model** | local (ollama) + cloud katalog, otomatik fallback | `providers.ts` `ProviderRouter` chain (VAR) |
| P4 | **Middleware-stack** | FastAPI middleware zinciri | express `app.use(...)` + `runPre/runPost` (VAR, birleşik-değil) |
| P5 | **Config-driven .env** | 40+ toggle `.env` | ~21 belgeli + kod-toggle'lar (VAR, `MODULE_*` YOK) |
| P6 | **PWA** | manifest + service-worker | `VitePWA` (VAR) |
| P7 | **Tool-schema-registry** | tool_schema tek kayıt + expose | `tool-registry.ts` schema+ajv (VAR) |
| P8 | **Vector-abstraction** | ChromaDB soyutlaması (retrieval) | `rag.ts` sqlite-vec + `embed-catalog` (VAR, ayrık-DB) |
| P9 | **RBAC-tool-policy** | admin/non-admin tool_policy | `ToolTier`+`allowedTiers`+`scope` (KISMİ, `role` yok) |
| P10 | **Threat-model** | implicit (docs) + injection-guard | redaction-interceptor + verifier (KISMİ, doc yok) |

> **Not:** P9/P10 detayı `07-security.md`'de tam işlenir; burada yalnız **mimari kancaları** (nereye
> takılır) verilir — çift-belge çakışmasını önlemek için (KN-A6).

---

## 3. Hedef Mimari — 10 Pattern × (Mevcut → Hedef → Diff)

### P1 — MCP-as-extension
- **Mevcut:** `server/mcp/{server,client,supervisor,catalog}.ts` + 3 dağınık ekleme-yolu (global
  `tools.json`, per-tenant store `upstream_servers`, curated `catalog.ts`). Lifecycle = yalnız
  `connected/degraded/down` (`supervisor.ts:14`). Kurulum-anı state-machine + audit **yok**.
- **Hedef:** tek **extension-manifest + lifecycle** soyutlaması (`installing→validating→registering→active
  →quarantined→removed`) + gwv2 hook noktaları (`onRegister/onDiscover/onQuarantine/onRemove`).
- **Diff:** `server/mcp/hooks.ts` (YENİ), `server/mcp/manifest.ts` (YENİ); `05-features/mcp-extensions.md`
  tam plan sahibidir → bu belge yalnız **manifest'in modular-service şemasına** (`server/modules/*`)
  bağlanma noktasını tanımlar.

### P2 — Modular-services (bu belgenin çekirdeği)
- **Mevcut:** `server.ts` 3191 satır, tüm route+iş-mantığı in-line. `server/*.ts` yardımcıları var ama
  route'lar hâlâ tek dosyada.
- **Hedef:** her O4-modül `server/modules/<name>/` = `{ router.ts, service.ts, store.ts, schema.ts, index.ts }`.
  `index.ts` bir `ModuleDef` export eder: `{ id, mountRoutes(app), tools[], migrations[], requiresPerm }`.
- **Diff:** `server/modules/registry.ts` (YENİ, aşağıda) `server.ts`'te **tek satırla** mount edilir:
  `mountEnabledModules(app)`. `server.ts` **küçülmez** ama **büyümeyi durdurur** (yeni modül tek dosyaya
  eklenmez). Var olan route'lar aşamalı extract (O1 sonrası temizlik).

```ts
// server/modules/registry.ts  (HEDEF iskelet — Claude Code implement)
export interface ModuleDef {
  id: string;                               // "research" | "documents" | "email" | ...
  envFlag: string;                          // "MODULE_RESEARCH"  → config-driven (P5)
  requiresPerm?: string;                    // CapabilityGate ile eşleşir (frontend)
  mountRoutes(app: express.Express): void;  // router.ts
  tools?: ToolDef[];                        // tool-registry'ye register (P7)
  migrations?: Migration[];                 // store/migrations'a append (P8)
}
export function moduleEnabled(id: string): boolean { /* env + registry */ }
export function mountEnabledModules(app: express.Express): void { /* iterate + guard */ }
```

### P3 — Dual-model
- **Mevcut:** `providers.ts` `ProviderRouter` + `ai.ts` (`ollama-local` default, `MAC_MODEL_CHAMPION=qwen3:8b`),
  fallback chain `ollama-local → cloud → demo`, `chain-policy.ts` privacy-filtre (`privateMode` cloud'u dışlar).
- **Hedef:** değişiklik **minimal** — yeni modüller (research/documents) inference'ı **doğrudan
  `aiGenerate`/`ProviderRouter`'dan** çağırır, kendi HTTP'sini açmaz. Embedding tarafı `rag.ts`
  `resolveEmbedder` üzerinden (P8).
- **Diff:** yeni kod **yok**; yalnız **kullanım-sözleşmesi** (modüller router'ı bypass etmez). Test:
  modül offline'da `demo` tier'e düşer, cloud key olmadan çöker-mez.

### P4 — Middleware-stack
- **Mevcut:** İki ayrı zincir — (a) express `app.use` (helmet→pinoHttp→raw-seam→json→owner-guard→auth→rate),
  (b) tool-level `runPre/runPost` (`tool-interceptors.ts`). Birleşik değil.
- **Hedef:** iki zinciri **isimlendirilmiş katmanlar** olarak belgeleyip modül-mount'a tek giriş: her modül
  router'ı **standart middleware-önek** (`authMiddleware`, `rateLimitMiddleware`, `requireModulePerm`) alır.
- **Diff:** `server/modules/middleware.ts` (YENİ, ince) — modül router factory'si standart zinciri sarar;
  yeni global middleware **eklenmez** (mevcutlar yeterli).

### P5 — Config-driven .env
- **Mevcut:** ~21 belgeli + çok sayıda kod-içi runtime toggle. `MODULE_*` ailesi yok.
- **Hedef:** her modül tek `MODULE_<NAME>=0|1` toggle; `.env.example`'a **modül bloğu** + kod-toggle'ların
  belgelenmesi. `moduleEnabled()` bunu okur (P2).
- **Diff:** `.env.example` genişletilir (belge borcu kapatılır); `server/modules/registry.ts` tek okuma-noktası.

### P6 — PWA
- **Mevcut:** `VitePWA autoUpdate` + manifest + workbox (`vite.config.ts:14-33`), `pwa-icon.svg`.
- **Hedef:** yeni modül-tab'ları offline-cache stratejisine dahil (workbox runtime-caching route pattern);
  `OfflineBadge` + `useOnline` zaten var (`src/components/OfflineBadge.tsx`, `src/hooks/useOnline.ts`).
- **Diff:** workbox `runtimeCaching` kuralı/modül (küçük); yeni bileşen yok.

### P7 — Tool-schema-registry
- **Mevcut:** `tool-registry.ts` — `ToolSchema` (OpenAI fn = MCP inputSchema), ajv `outputSchema` doğrulama
  (`getValidator`, cache'li), `register(name, def, owner?)` runtime-ekleme (`:852`), tier'lı `list()`.
- **Hedef:** modül tool'ları `ModuleDef.tools[]` → `registry.register()` ile mount-anında kayıt.
  Schema-registry **değişmez** (zaten sözleşme-uyumlu).
- **Diff:** yeni kod yok; yalnız modül-registry'nin registry'ye register-akışı (P2 ile birlikte).

### P8 — Vector-abstraction (persistence yakınsama — O0 blocker)
- **Mevcut:** `rag.ts` **ayrı** `DatabaseSync` (sqlite-vec) + `resolveEmbedder` (pinned cloud → local
  ollama fallback, `EMBED_PROVIDER`). `embed-catalog.ts` dim-kilit (rotasyon-yasağı: farklı model=farklı dim).
  Ama tenant-store (`server/store`) ve config-vault (`db.ts`) **ayrı DB'ler**.
- **Hedef:** `RagStore`-benzeri bir **`VectorStore` arayüzü** (`upsert/query/delete`), sqlite-vec varsayılan,
  gelecekte ChromaDB-MCP takılabilir (P1 upstream). Yeni O4-modüller (research/documents/notes) **bu arayüzü**
  kullanır, kendi DB'sini açmaz. Metadata-tablolar `server/store/migrations`'a **append** (v7+).
- **Diff:** `server/store/vector.ts` (YENİ, `rag.ts`'i sarar/taşır) + yeni migration(lar). **Bu O0'ın
  kalbi** — 00-MASTER KN-M4 "persistence uçurumu". Karar: **sqlite-vec kalır** (zero-config), ChromaDB
  yalnız opsiyonel-MCP-upstream olarak (yeni ağır bağımlılık yok).

### P9 — RBAC-tool-policy (mimari kancalar; detay 07-security)
- **Mevcut:** `ToolTier`(4) + `ctx.allowedTiers` (plan-allowlist) + `tools:<tier>` scope; `role` yok.
- **Hedef-kanca:** `ToolCtx`'e `role?: "admin"|"user"` alanı; `execute()` tier-gate'ine role-gate eklenir
  (aynı choke-point, `:901-910` civarı). Modül-registry `requiresPerm` frontend `CapabilityGate` ile hizalı.
- **Diff:** `ToolCtx` genişletme + tek `if` (07-security O6.2/O6.3 sahibidir).

### P10 — Threat-model (mimari kancalar; detay 07-security)
- **Mevcut:** `redactionInterceptor` (secret pattern) + verifier; `threat-model.md` yok.
- **Hedef-kanca:** poison-guard **yeni bir interceptor** olarak `runPre`/`runPost` chain'ine takılır
  (upstream tool-output untrust). Mimari olarak **kanca zaten var** (`registerInterceptor`).
- **Diff:** `server/mcp/poison-guard.ts` (YENİ interceptor, 07-security O6.5 sahibidir).

---

## 4. Mevcut→Hedef Diff — Özet Tablo

| Katman | Mevcut | Hedef | Δ tipi | Sahip belge |
|---|---|---|---|---|
| Route organizasyon | `server.ts` monolit (3191) | `server/modules/<name>/*` + registry | **YENİ iskelet** | **02 (bu)** |
| Module toggle | yok | `MODULE_*` + `moduleEnabled()` | **YENİ** | **02 (bu)** |
| Vector persistence | `rag.ts` ayrık DB | `VectorStore` arayüzü + store'a append | **YENİ/refactor** | **02 (bu)** — O0 |
| MCP-extension | federation (%70) | +manifest+lifecycle+hooks | genişletme | 05-mcp-extensions |
| Dual-model | `ProviderRouter` chain | kullanım-sözleşmesi | değişiklik-yok | 02 (kanca) |
| Middleware | 2 ayrı zincir | isimli katman + modül-factory | ince-YENİ | 02 (kanca) |
| Schema-registry | ajv + tier | modül-tool register akışı | akış | 02+07 |
| RBAC | tier+scope, role-yok | `role` + role-gate | genişletme | 07-security |
| Threat/poison | redact-interceptor | poison-guard interceptor + doc | YENİ | 07-security |
| PWA | VitePWA | modül-tab runtime-cache | ince | 02 (kanca) |

**Kanonik sınır:** `server.ts`'i **tek büyük refactor'la** bölmek **kapsam-dışı** (regresyon riski XL).
Strateji = **"strangler-fig"**: yeni her şey `server/modules/*`'a, eski route'lar aşamalı extract (O1
sonrası, ayrı temizlik dalgası). Bu belge **iskeleti** kurar, **taşımayı zorlamaz**.

---

## 5. TDD Yürütme Planı (test-önce, her adım RED→GREEN)

> Kural: her adım **önce RED test**, sonra minimal implement, sonra `typecheck ✓ lint ✓ vitest ✓`
> (CLAUDE.md pre-ship kapısı). `görev-id` = PROGRESS.md log formatı (`ARCH.<faz>.<adım>`).

### Faz A0 — Module-registry iskeleti (P2+P5) · BLOCKER-ilk
- **A0.1 (RED):** `server/modules/__tests__/registry.test.ts` — `moduleEnabled("x")` `MODULE_X=1` iken true,
  set-değilken false; bilinmeyen id false.
- **A0.2 (GREEN):** `server/modules/registry.ts` — `ModuleDef`, `moduleEnabled(env)`, `mountEnabledModules(app)`.
- **A0.3 (RED):** mount testi — devre-dışı modülün route'u **404**, açıkken **200** (fake `ModuleDef`).
- **A0.4 (GREEN):** `mountEnabledModules` iterate + `moduleEnabled` guard + `express.Router` mount.
- **Çıkış-kapısı:** `.env` `MODULE_DEMO=1` ile fake modül route'u canlı; `=0` ile 404. Kanıt: test-adı+PASS.

### Faz A1 — VectorStore soyutlama (P8) · O0 kalbi
- **A1.1 (RED):** `server/store/__tests__/vector.test.ts` — injektabl embedder ile `upsert→query`
  en-yakın-komşu döndürür; boş-index'te query `[]`; `delete` sonrası query komşuyu düşürür.
  (Deterministik: `rag.ts`'in injektabl `Embedder` deseni izlenir — ollama'sız çalışır.)
- **A1.2 (GREEN):** `server/store/vector.ts` — `VectorStore` arayüzü, sqlite-vec impl `rag.ts`'i sarar;
  dim-kilit `embed-catalog` üzerinden korunur (rotasyon-yasağı testi).
- **A1.3 (RED):** migration testi — modül-metadata tablosu v7 idempotent (iki kez çalışınca no-op).
- **A1.4 (GREEN):** `server/store/migrations.ts`'e v7 append (append-only kural, `:34` sözleşmesi).
- **Çıkış-kapısı:** `VectorStore` ollama'sız yeşil; migration çift-çalıştırmada tekil. Kanıt: test PASS + `applied_at` tekil.

### Faz A2 — Modül-middleware factory (P4) + RBAC kancası (P9)
- **A2.1 (RED):** modül-router `requireModulePerm("x")` yetkisiz istekte 403, yetkilide geçer.
- **A2.2 (GREEN):** `server/modules/middleware.ts` — `authMiddleware`+`rateLimitMiddleware`+perm sarmalı.
- **A2.3 (RED):** `ToolCtx.role` yokken mevcut davranış aynı (regresyon-yok); `role:"user"` + privileged tool → deny.
- **A2.4 (GREEN):** `ToolCtx`'e `role?` ekle; `execute()` role-gate `if` (07-security ile koordine, çakışmasız).
- **Çıkış-kapısı:** eski testler yeşil (regresyon-yok) + yeni role-deny testi PASS.

### Faz A3 — İlk gerçek modül (referans implementasyon: `notes`)
- **A3.1 (RED):** `server/modules/notes/__tests__/*` — `POST /api/modules/notes` yazar, `GET` okur
  (`VectorStore` + store-tablo); `MODULE_NOTES=0` iken tüm route 404.
- **A3.2 (GREEN):** `server/modules/notes/{router,service,store,schema,index}.ts` = ilk `ModuleDef`.
- **A3.3 (RED):** tool-registry — `note_save`/`note_search` tool'ları `MODULE_NOTES=1` iken `tools/list`'te,
  kapalıyken **yok** (P7 register akışı + P1 expose).
- **A3.4 (GREEN):** `ModuleDef.tools[]` → `registry.register()` mount-anında; kapalıyken register-etme.
- **Çıkış-kapısı:** notes ucu uçtan-uca (route+tool+persistence+toggle) yeşil = **modular-service şablonu kanıtlandı**.
  Sonraki O4-modüller (research/documents/email/calendar) **bu şablonu** kopyalar.

### Faz A4 — Belge borcu + parity ölçümü
- **A4.1:** `.env.example`'a `MODULE_*` bloğu + kod-toggle belgelenmesi (P5 kapanış).
- **A4.2:** `server.ts`'te `mountEnabledModules(app)` **tek satır** entegrasyon (mevcut route'lara dokunmaz).
- **A4.3:** parity smoke — 6 kabul kriteri (§7) otomatik ölçülür (`vitest run` + `MODULE_*` matris).

> **Sıra kilidi:** A0 → A1 **paralel-güvenli değil** (A1, A0'ın `ModuleDef.migrations`'ına yaslanır);
> A2 A0'a, A3 A0+A1+A2'ye bağlı. Roadmap dalga-eşlemesi: **W-arch = O0(A0,A1) → O1(A2,A3,A4)**.

---

## 6. odysseus-Parity Kabul Kriteri (bu belge = O0+O1)

Bu mimari **DONE** sayılır ancak ve ancak **6/6** GREEN:

1. **Modular-service (P2):** en az bir gerçek modül (`notes`) `server/modules/notes/*`'ta yaşar; route+tool+
   persistence+UI-tab **`server.ts`'e in-line kod eklenmeden** mount edilir. Kanıt: `git diff server.ts` = yalnız
   `mountEnabledModules` tek-satır.
2. **Config-driven toggle (P5):** `MODULE_NOTES=0` → route 404 + tool `tools/list`'te yok; `=1` → ikisi de canlı.
   Kanıt: `.env` matris testi PASS.
3. **Vector-abstraction (P8):** `VectorStore.upsert/query` ollama'sız (injektabl embedder) yeşil; sqlite-vec
   arkada; dim-kilit korunur. Kanıt: `vector.test.ts` PASS.
4. **Choke-point korundu (P7+P9):** modül tool'ları **hâlâ** `ToolRegistry.execute()`'tan geçer (bypass yok);
   tier/scope/role gate uygulanır. Kanıt: registry-bypass yok (grep) + role-deny testi PASS.
5. **Regresyon-yok:** mevcut `vitest run` + `test:e2e` yeşil kalır; `server.ts` mevcut route'ları değişmez.
   Kanıt: pre/post test-sayısı ≥ baseline, 0 kırık.
6. **Kalite kapısı:** `tsc --noEmit` ✓ + `eslint` ✓ + `vitest run` ✓ (CLAUDE.md pre-ship). Kanıt: 3 komut exit-0.

> **Not:** P1/P3/P4/P6/P10 bu belgede **kanca-düzeyinde** parity sağlar (arayüz/uzatma-noktası hazır); tam
> parity ilgili sahip-belgelerde (`05-mcp-extensions`, `07-security`) ölçülür — çift-sayım yapılmaz.

---

## 7. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| ID | Tip | Açıklama | Etki | Azaltma / karar |
|---|---|---|---|---|
| **KN-A1** | RİSK | **`server.ts` strangler-fig varsayımı:** yeni modüller ayrık dosyada, ama mevcut 200+ route in-line kalır; tam de-monolit **bu belgenin kapsamı değil**. | "Mimari temiz" beklentisi yanlış olabilir; monolit sürer | Kabul: O0/O1 = **büyümeyi durdur** (yeni kod ayrık). Tam extract = ayrı O1-temizlik dalgası, ayrı risk-bütçesi. |
| **KN-A2** | VARSAYIM | **Üç-DB yakınsama sınırı:** `db.ts` (JSON-vault), `store/*` (SQLite/pg), `rag.ts` (sqlite-vec) **birleştirilmiyor**; yalnız yeni modüller `store`+`VectorStore`'a yazar. Vault ayrı kalır (kasıtlı — keychain master-key). | Üç persistence dünyası sürer; modül-yazarı hangi DB belirsizliği | Karar: **modül-verisi → `store` (SQLite/pg) + vektör → `VectorStore`**; vault yalnız secret. §1.2'de netleştirildi. |
| **KN-A3** | RİSK | **sqlite-vec `DatabaseSync{allowExtension}` çok-replika:** `rag.ts` dedike bir SQLite dosyası açar; `DATABASE_URL`=pg modda vektör-store **pg'ye taşınmaz** (pgvector değil). | Multi-replika prod'da vektör-tutarsızlığı | Kabul: sqlite-vec **tek-node/local-öncelik**; pg-prod'da vektör O5+ (pgvector-MCP-upstream) — bu belgede **YOK**, işaretlendi. |
| **KN-A4** | BİLİNMEYEN | **`node:sqlite` `DatabaseSync` API kararlılığı** (Node 22 experimental) — `rag.ts` buna dayanır; Node sürüm-yükseltmesinde kırılabilir. | VectorStore taban riski | Azaltma: `VectorStore` arayüzü impl'i soyutlar; kırılırsa impl-swap (better-sqlite3) arayüzü değiştirmez. |
| **KN-A5** | VARSAYIM | **`MODULE_*` toggle default'u:** yeni modüller **default-OFF** varsayıldı (opt-in, güvenli). Ama bazı modüller (notes) "her zaman açık" beklenebilir. | UX sürprizi (tab görünmez) | Karar: default-OFF (fail-safe); `notes` gibi çekirdekler `.env.example`'da `=1` önerilir, kod-default değil. |
| **KN-A6** | RİSK | **Belge-çakışması P9/P10:** RBAC/threat detayı `07-security`'de; burada **yalnız kanca**. İki belge `ToolCtx.role`/poison-guard'a dokunursa çift-implement riski. | Çakışan PR/kod | Azaltma: bu belge **arayüz-kancasını** tanımlar (`role?` alanı, `registerInterceptor` noktası); **implementasyon 07-security'de**. Sahiplik tablosu §4. |
| **KN-A7** | VARSAYIM | **`ModuleDef.migrations` append-only uyumu:** yeni modül migration'ları v7+ olarak store'a eklenecek; ama modüller **bağımsız-numaralanırsa** çakışır (iki modül v7). | Migration çakışması | Karar: migration-numarası **global-monoton** (registry merkezi atar), modül-lokal değil. A1.3 testi bunu koruyacak. |
| **KN-A8** | BİLİNMEYEN | **Frontend `CapabilityGate`↔`requiresPerm` eşleme sözleşmesi** doğrulanmadı (perm-adı string-match). Yanlış-eşleşme tab'ı yanlış gate'ler. | Modül-tab yanlış görünür/gizlenir | Azaltma: A3'te notes-perm string'i frontend `isTabEnabled` ile **aynı sabit-tablodan** okunur (tek kaynak-of-truth); A3.1 testi kapsar. |
| **KN-A9** | RİSK | **`server.ts` tek-satır entegrasyon (A4.2) sırası:** `mountEnabledModules` **auth/owner-guard'dan sonra** mı önce mi mount edilmeli belirsiz; yanlış sıra modül-route'u guard'sız bırakır. | Güvenlik açığı | Karar: modül-mount **`localOwnerGuard` + `authMiddleware`'den SONRA** (guard-kapsamı içinde); A2.1 perm-testi + A4.2 sıra-testi doğrular. |

---

## 8. Doğrulama Günlüğü (bu belgenin kanıt tabanı)

- `server.ts` — 3191 satır (`wc -l`), import+route yapısı grep'lendi (§1.1–1.2).
- `server/tool-registry.ts:882-961` — `execute()` choke-point sırası (ownership→allowedTiers→scope→pre→invoke→outputSchema→post) okundu.
- `server/tool-interceptors.ts:31-52` — `runPre`/`runPost` middleware-stack; "asla throw etmez" sözleşmesi.
- `server/mcp/server.ts:36-252` — MCP host, `2025-06-18`, capabilities (tools/resources/prompts/completions).
- `server/mcp/supervisor.ts:14-170` — upstream lifecycle `connected/degraded/down`, `computeBackoff`, collision.
- `server/providers.ts` (1504) + `server/ai.ts` — dual-model `ProviderRouter` chain, `MAC_MODEL_CHAMPION`.
- `server/store/{index,migrations,db-adapter}.ts` — SQLite↔pg adapter, migration v1..6 append-only + advisory-lock.
- `server/rag.ts:9-176` + `embed-catalog.ts` — sqlite-vec `DatabaseSync{allowExtension}`, `resolveEmbedder`, dim-kilit.
- `server/db.ts:1-30` — JSON-file şifreli vault + `atomicWriteFileSync` + keychain (üçüncü persistence dünyası).
- `server/middleware/{auth,rate-limit}.ts` — 3 kimlik yolu + token-bucket/Redis.
- `src/App.tsx:63-235` — 21 tab, `activeTab`, `isTabEnabled(perms)`; `CapabilityGate`.
- `vite.config.ts:5-33` — `VitePWA autoUpdate` + manifest + workbox.
- `.env.example` — 21 belgeli toggle (`grep -c`); `.mcp.json` — 3 upstream (ollamas/context7/deepwiki).
- `docs/odyssey/{00-MASTER,01,07,10,05-features/mcp-extensions,PROGRESS}.md` — kardeş-belge terminoloji + O0/O1 sahiplik hizası.

*Doğrulama tarihi: 2026-07-10. Bu belge O0(temel katman)+O1(modüler servis) mimari sahibidir; P1/P9/P10
detay-sahipliği sırasıyla 05-mcp-extensions / 07-security'dedir.*
