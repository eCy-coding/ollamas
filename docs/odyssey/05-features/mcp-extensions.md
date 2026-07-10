# ODYSSEY · 05-Features · MCP-as-Extension (Extensibility Çekirdeği)

> **Odak:** odysseus'un `mcp_manager` + `mcp_servers` plugin-sistemine denk, ollamas'ın
> mevcut MCP choke-point + upstream federation'ı üzerine **plugin-ekleme protokolü +
> tool-registry lifecycle + hook framework (gwv2)** inşası.
> **Dil:** TR (kod/komut/dosya-yolu EN). **Yöntem:** her adım TDD (test-önce).
> **Kaynak-doğrulama tarihi:** 2026-07-10 — iddialar `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek koduna karşı Read/Grep ile doğrulandı.

---

## 0. Yönetici Özeti

ollamas'ın MCP katmanı **beklenenden çok daha olgun**. odysseus-parity için "sıfırdan plugin sistemi"
gerekmiyor; gereken üç şey var:

1. **Plugin-ekleme protokolünü formalize et** — bugün üç dağınık yol var (global `tools.json`,
   per-tenant store `upstream_servers`, curated `catalog.ts`). odysseus'ta bunlar tek bir
   "extension manifest + lifecycle" soyutlaması. ollamas'ta bu soyutlama **yok**; endpoint'ler ve
   supervisor doğrudan `UpstreamConfig` ile konuşuyor.
2. **Lifecycle'ı tek durum-makinesine çek** — `superviseUpstream → connected/degraded/down` var
   (supervisor.ts), ama **`installing → validating → registering → active → quarantined → removed`**
   gibi kurulum-anı lifecycle'ı ve **audit trail** yok.
3. **gwv2 Hook Framework'ü doğur** — `server/mcp/hooks.ts` **YOK**. Ama embriyosu VAR:
   `server/tool-interceptors.ts` zaten `pre/post` middleware chain'i ve
   `ToolRegistry.execute` içinde `runPre/runPost` çağrı noktaları. gwv2 = bu chain'i
   **MCP-lifecycle olaylarına** (onRegister, onDiscover, onQuarantine, onRemove) genişletmek.

**odysseus'un extensibility sırrı** (MCP-as-extension + modular-services + config-driven .env) →
ollamas'ta **%70 hazır**: config-driven .env toggle'lar mevcut (`MCP_EXPOSE_TIERS`, `MCP_SCAN_CMD`,
`MCP_SAMPLING`, `MCP_REDACT`, `MCP_CACHE_TTL_MS`, `MCP_HEALTH_INTERVAL_MS`, `MCP_UPSTREAM_ALLOW_ANY`…).
Eksik olan **modüler plugin-manifest + genişletilebilir hook noktaları**.

---

## 1. Mevcut Durum (koda karşı doğrulanmış)

### 1.1 VAR — güçlü temel

| Yetenek | Dosya | Not |
|---|---|---|
| **Consume-side client** (upstream bağlan, tools/list, `mcp__<srv>__<tool>` namespace merge) | `server/mcp/client.ts` | `connectUpstream()` — never-throws, manifest-pin (sha256), sanitize-output, tenant-owner scope (Faz 24) |
| **Choke-point** (tek dispatch path) | `server/tool-registry.ts` | `ToolRegistry.execute` — tier-gate, owner-gate, scope-gate, abort, `runPre/runPost` |
| **Pre/Post interceptor chain** (gwv2 embriyosu) | `server/tool-interceptors.ts` | `registerInterceptor`, `runPre`, `runPost`; hazır 2 interceptor: `redact`, `cache` |
| **Curated katalog** (one-click add) | `server/mcp/catalog.ts` | 8 vetted MIT server (memory/filesystem/everything/git/fetch/time/sequential-thinking/playwright); `decorateCatalog()` availability+installed |
| **Güvenlik guard** (tenant upstream validation) | `server/mcp/upstream-guard.ts` | positive-allowlist (npx/uvx), dangerous-flag deny, package-prefix pin, SSRF host-classify |
| **Federation supervisor** (lifecycle) | `server/mcp/supervisor.ts` | health-check + exp-backoff + circuit-breaker + collision-surfacing; `owner` reconnect-safe |
| **Persistence** (per-tenant upstream) | `server/store/index.ts` | `upstream_servers` tablosu + `addUpstreamServer/listUpstreamServers/allUpstreamServers/deleteUpstreamServer` |
| **Expose-side server** (/mcp HTTP) | `server/mcp/server.ts` | tools/resources/prompts/completions/logging/roots; `SubscriptionRegistry` fs.watch push |
| **Discovery** | `server/mcp/discovery.ts` | `/.well-known/mcp.json` (SEP-1649 şekli) |
| **Prompts** | `server/mcp/prompts.ts` | architect/coder/reviewer 3-stage pipeline MCP-prompt olarak |
| **REST API yüzeyi** | `server.ts` | `GET/POST/DELETE /api/saas/upstreams`, `GET /api/saas/catalog`, `GET /api/saas/upstreams/status`, `GET /api/mcp/upstreams` |
| **Boot-time fan-out** | `server.ts:616-645` | global `tools.json` (ownerless) + per-tenant store (owner) paralel `superviseUpstream` |
| **Env toggles** | `.env.example` | `MCP_EXPOSE_TIERS`, `MCP_AUTO_APPLY`, `MCP_LOG_LEVEL`, `MCP_PUBLIC_URL`, `MCP_HEALTH_INTERVAL_MS` |

### 1.2 YOK — odysseus-parity boşlukları

| Eksik | Kanıt (Grep) | odysseus karşılığı |
|---|---|---|
| **`server/mcp/hooks.ts`** (gwv2 hook framework) | `find server -iname '*hook*'` → **boş**; "hook" sadece interceptor+registry yorumlarında | mcp_manager plugin-hook API |
| **Plugin/Extension manifest soyutlaması** | Kod doğrudan `UpstreamConfig`'e bağlı; `interface Plugin`/`ExtensionManifest` yok | `mcp_servers` extension descriptor (name, version, capabilities, policy) |
| **Kurulum-anı lifecycle durum-makinesi** | supervisor'da yalnız runtime state (`connected/degraded/down`); `installing/validating/registering/quarantined` yok | extension install FSM |
| **Hook audit trail** | Hiçbir hook olayı persist edilmiyor; `upstream_servers` tablosunda sadece config | extension event log |
| **Per-plugin policy config** | Yalnız global `.env` + per-upstream `allowedTools`; per-plugin tier/rate/scope policy yok | admin/non-admin tool-policy (2FA/RBAC modülü ile kesişir) |
| **Katalog dinamik/uzak** | `CATALOG` **hard-coded 8 entry**, derleme-anı sabit | uzaktan güncellenebilir extension registry |
| **Tool-registry değişim-eventi** | `register/unregisterByPrefix` sessiz; "tools changed" bildirimi yok (expose `listChanged:false`) | `notifications/tools/list_changed` |
| **Test kapsaması** | `tests/upstream-guard.test.ts` VAR; `catalog/supervisor/interceptors/hooks` testi **YOK** | — |

---

## 2. odysseus Referansı (hedef-desen)

odysseus'ta bir MCP-extension eklemek = **tek manifest + lifecycle**:

```
ExtensionManifest {
  id, version, transport, command/url, capabilities[],
  policy { tier, allowedTools[], rateLimit, adminOnly },
  hooks { onRegister, onToolCall, onError, onRemove }
}
    │
    ▼  mcp_manager.install(manifest)
[ validate → spawn/connect → discover tools → apply policy → register hooks → active ]
    │                                                          │
    │  hata → quarantine (audit)                               ▼
    └──────────────────────────────────────────────  ToolRegistry (choke-point)
```

**Anahtar farklar (odysseus → ollamas eşleme):**

| odysseus | ollamas bugün | Eşleme aksiyonu |
|---|---|---|
| `mcp_manager` | dağınık: `client.ts` + `supervisor.ts` + `server.ts` endpoints | **`server/mcp/manager.ts`** ince fasad — mevcutları sarar, yeni dispatch AÇMAZ |
| `ExtensionManifest` | `UpstreamConfig` (transport/command/args/url/allowedTools) | manifest = UpstreamConfig **+ policy + hooks** üst-kümesi (backward-compat) |
| plugin hooks | `ToolInterceptor.pre/post` (yalnız tool-call) | **lifecycle hook'ları** ekle (register/discover/quarantine/remove) |
| extension registry (uzak) | `CATALOG` (statik) | `MCP_CATALOG_URL` opsiyonel uzak-merge (fail-soft, statik fallback) |
| tool-policy (RBAC) | tier + allowedTools + scopes | per-plugin policy → `ToolCtx.allowedTiers` ile birleş |

---

## 3. Hedef Plan — TDD Adımlı

> **Scope Law (MCP_LANE.md):** sadece `server/mcp/**`, `server/tool-registry.ts`,
> `server/tool-interceptors.ts`, ilgili `tests/`. **İkinci dispatch path AÇMA** —
> her şey `ToolRegistry.execute` choke-point'inden geçer.
> **Sıra:** her adımda ÖNCE test yaz (kırmızı), SONRA implement (yeşil), SONRA refactor.

### Faz A — gwv2 Hook Framework (`server/mcp/hooks.ts`)

**Amaç:** interceptor chain'i (tool-call) **lifecycle olaylarına** genişletmek. Interceptor'ı BOZMA;
hooks onun üst-kümesi. Şef-3 gwv2 = bu dosya.

**A1. Test-önce** — `tests/mcp-hooks.test.ts`
- `registerHook({ id, on, run })` → kayıt olur, `hooks("onRegister")` döner.
- `emitHook("onRegister", ctx)` → tüm eşleşen hook'ları **sıra** ile çağırır, biri throw ederse **atlanır+loglanır** (interceptor sözleşmesiyle simetri), diğerleri koşar.
- `emitHook` **never-throws** (choke-point invariant).
- Hook `veto: true` dönerse → `emitHook` `{ vetoed: true, by: id }` döner (registration'ı reddetme yolu).
- `_resetHooks()` test-helper.

**A2. Implement** — `server/mcp/hooks.ts`
```ts
export type HookEvent = "onRegister" | "onDiscover" | "onToolCall" | "onError" | "onQuarantine" | "onRemove";
export interface HookCtx { plugin: string; event: HookEvent; data?: any; tenantId?: string; }
export interface Hook { id: string; on: HookEvent; run(ctx: HookCtx): void | { veto?: boolean; reason?: string }; }
export function registerHook(h: Hook): void;
export function emitHook(event: HookEvent, ctx: Omit<HookCtx,"event">): { vetoed: boolean; by?: string; reason?: string };
export function _resetHooks(): void;  // test
```
- Yorum-disiplini: WHY-only (interceptor.ts stiliyle uyumlu).
- **Not:** `onToolCall` hook'u interceptor chain'i DUPLE ETMEZ — interceptor tool-call'un *veri*sini
  (redact/cache) dönüştürür; hook lifecycle *olayını* (audit/policy) gözler. İki farklı sorumluluk.

**A3. Kabul:** `npx vitest run tests/mcp-hooks.test.ts` yeşil; `tsc --noEmit` temiz.

---

### Faz B — Extension Manifest + Manager Fasad (`server/mcp/manager.ts`)

**Amaç:** dağınık ekleme yollarını tek `installPlugin(manifest)` altında topla. Mevcut
`superviseUpstream`/`validateUpstreamConfig`/`connectUpstream`'i SAR, yenisini yazma.

**B1. Test-önce** — `tests/mcp-manager.test.ts`
- `manifestFromUpstream(cfg)` → `UpstreamConfig` → `ExtensionManifest` (backward-compat, policy default'lu).
- `installPlugin(manifest)` mutlu-yol: validate → connect (mock) → `emitHook("onRegister")` çağrılır → status `"active"`.
- Guard-fail (kötü command) → status `"rejected"`, hiçbir tool register olmaz, `onQuarantine` hook fire eder.
- Hook `veto` dönerse (Faz A) → install durur, status `"vetoed"`, hiçbir tool register olmaz.
- `removePlugin(id)` → `removeUpstream` çağrılır + `onRemove` hook + status `"removed"`.
- **Owner korunur:** per-tenant manifest → `connectUpstream(cfg, owner)` owner'ı geçirilir (Faz 24 invariant testi).

**B2. Implement** — `server/mcp/manager.ts`
```ts
export interface PluginPolicy { tier?: ToolTier; allowedTools?: string[]; adminOnly?: boolean; rateLimitPerMin?: number; }
export interface ExtensionManifest {
  id: string; version?: string;
  transport: "stdio" | "http"; command?: string; args?: string[]; url?: string; env?: Record<string,string>;
  policy?: PluginPolicy;
}
export type PluginState = "validating" | "active" | "rejected" | "vetoed" | "quarantined" | "removed";
export function manifestFromUpstream(cfg: UpstreamConfig): ExtensionManifest;
export async function installPlugin(m: ExtensionManifest, owner?: string): Promise<{ id: string; state: PluginState; tools: number; error?: string }>;
export async function removePlugin(id: string, owner?: string): Promise<void>;
export function listPlugins(owner?: string): { id: string; state: PluginState; tools: number }[];
```
- `installPlugin` iç sırası: `validateUpstreamConfig` → `emitHook("onRegister")` (veto kapısı) →
  `superviseUpstream` → tool-sayısı → state. Hata → `emitHook("onQuarantine")`.
- **İkinci dispatch AÇMAZ:** tool çağrısı hâlâ `ToolRegistry.execute`.

**B3. Kabul:** `tests/mcp-manager.test.ts` yeşil; mevcut `tests/upstream-guard.test.ts` + supervisor davranışı bozulmadı (regression).

---

### Faz C — Lifecycle Audit Trail (persist)

**Amaç:** her plugin-olayı iz bırakır (odysseus extension event log). `upstream_servers` tablosu
config tutuyor; olaylar için yeni tablo.

**C1. Test-önce** — `tests/mcp-audit.test.ts` (store adapter mock/temp-db)
- `logPluginEvent({ pluginId, tenantId, event, detail })` → satır yazar.
- `listPluginEvents(pluginId)` → kronolojik döner.
- Tenant-scope: bir tenant başka tenant'ın olaylarını GÖRMEZ.

**C2. Implement**
- `server/store/index.ts` migration: `plugin_events(id, plugin_id, tenant_id, event, detail, created_at)` + index.
- `server/store/migrations.ts`'e ekle (mevcut migration deseni).
- `emitHook`'a opsiyonel default-audit-hook bağla (`MCP_AUDIT=1` iken; fail-soft).

**C3. Kabul:** migration idempotent (iki kez çalışır); `tests/mcp-audit.test.ts` yeşil.

---

### Faz D — tools/list_changed Bildirimi

**Amaç:** plugin install/remove sonrası bağlı MCP client'lara "araç seti değişti" push'u.
Bugün `server/mcp/server.ts` `tools: { listChanged: false }` — statik.

**D1. Test-önce** — `tests/mcp-list-changed.test.ts`
- `ToolRegistry.register/unregisterByPrefix` sonrası bir **dirty-event** yayınlanır (yeni: `ToolRegistry.onChange(cb)`).
- Manager `installPlugin`/`removePlugin` bu event'i tetikler.

**D2. Implement**
- `server/tool-registry.ts`: küçük `onChange`/`emitChange` (dep-siz, in-proc). `register`/`unregisterByPrefix` sonunda `emitChange()`.
- `server/mcp/server.ts`: capability `tools: { listChanged: true }` + `onChange` → `notifications/tools/list_changed`.
- **Risk-freni:** `listChanged` yalnız `MCP_LIST_CHANGED=1` iken advertise (davranış-değişimi opt-in; conformance testleri kırmasın).

**D3. Kabul:** `tests/mcp-list-changed.test.ts` yeşil; mevcut `tests/mcp-stdio.e2e.test.ts` regresyonsuz.

---

### Faz E — Dinamik/Uzak Katalog (opsiyonel, fail-soft)

**Amaç:** `CATALOG` statik → uzaktan-genişletilebilir (odysseus extension registry). **Güvenlik-korur:**
uzak entry'ler de `validateUpstreamConfig`'ten geçer (npx/uvx allowlist).

**E1. Test-önce** — `tests/mcp-catalog-remote.test.ts`
- `MCP_CATALOG_URL` yoksa → yalnız statik `CATALOG` (bugünkü davranış, regression).
- Uzak fetch başarısız → statik fallback (fail-soft, throw yok).
- Uzak entry allowlist'i ihlal ederse (ör. `command:"bash"`) → **elenir**, statik'lerle merge edilmez.

**E2. Implement** — `server/mcp/catalog.ts`
- `fetchRemoteCatalog(url, fetchImpl)` (inject-edilebilir fetch, test için); merge + de-dup by `id`.
- `decorateCatalog` bunu opsiyonel çağırır (env-gated).

**E3. Kabul:** env-yokken çıktı bit-aynı; uzak-kötü-entry elenmiş.

---

### Faz F — Entegrasyon + Endpoint Cilası

**F1. Test-önce** — `tests/mcp-manager.e2e.test.ts`
- `POST /api/saas/upstreams` → `installPlugin` yoluna girer (endpoint fasadı manager'a delege).
- `GET /api/saas/upstreams/status` → plugin state + son audit olayını içerir.

**F2. Implement** — `server.ts`
- Endpoint gövdelerini `installPlugin/removePlugin/listPlugins`'e delege et (davranış-koruyan refactor).
- **Boot fan-out** (`server.ts:616-645`) `installPlugin`'i kullanır — global ownerless + per-tenant owner ayrımı korunur.

**F3. Kabul:** tam suite (`npx vitest run`) yeşil; `tsc --noEmit` temiz; lint temiz.

---

## 4. gwv2 Hook Framework — Şef-3 Kesişimi (detay)

`tool-interceptors.ts` (VAR) ile `hooks.ts` (YENİ) **iki katman**, çakışmaz:

```
tool çağrısı ──► ToolRegistry.execute
                   │
                   ├─ runPre(interceptors)   ← VERİ katmanı (cache-hit, kısa-devre)
                   ├─ tool.invoke
                   ├─ runPost(interceptors)  ← VERİ katmanı (redact, cache-store)
                   └─ emitHook("onToolCall") ← OLAY katmanı (audit/policy/metrics)   ◄── gwv2 ekler

plugin yaşam-döngüsü ──► manager.installPlugin / removePlugin
                   └─ emitHook("onRegister"|"onDiscover"|"onQuarantine"|"onRemove")   ◄── gwv2
```

**Neden ayrı:** interceptor'lar tool-output'u **dönüştürür** (sözleşme: ToolResult in→out).
Hook'lar lifecycle'ı **gözler/vet'ler** (sözleşme: olay in→ veto?). Birini diğerine yıkmak
choke-point sözleşmesini (never-throws, tek dispatch) kirletir. gwv2 = OLAY katmanı;
mevcut interceptor = VERİ katmanı. İkisi de aynı `ToolRegistry.execute` iskeletine asılır.

**Simetri kuralları (interceptor.ts'ten miras):**
- Hook throw ederse → atla+logla, akış devam.
- Sıra = registration order.
- Config-gate call-time okunur (env yeniden-import gerektirmez).

---

## 5. odysseus-Parity Kabul Kriteri

Aşağıdakiler geçtiğinde bu modül **odysseus-parity** sayılır:

- [ ] **P1 — Tek ekleme protokolü:** yeni MCP server, `installPlugin(manifest)` tek çağrısıyla eklenir; global/per-tenant/katalog üçü de aynı yoldan geçer. (Faz B, F)
- [ ] **P2 — Lifecycle FSM:** `validating → active | rejected | vetoed | quarantined → removed` durumları API'de görünür (`GET /api/saas/upstreams/status`). (Faz B, F)
- [ ] **P3 — Hook framework:** `server/mcp/hooks.ts` `onRegister/onDiscover/onToolCall/onError/onQuarantine/onRemove` yayınlar; veto çalışır; interceptor chain bozulmaz. (Faz A)
- [ ] **P4 — Audit trail:** her plugin-olayı `plugin_events`'e tenant-scope'lu yazılır ve listelenir. (Faz C)
- [ ] **P5 — list_changed:** install/remove sonrası bağlı client `notifications/tools/list_changed` alır (opt-in). (Faz D)
- [ ] **P6 — Config-driven genişleme:** yeni plugin **kaynak-kopyalamadan** (npx/uvx binary-invoke veya http) eklenir; uzak katalog merge fail-soft. (Faz E)
- [ ] **P7 — Güvenlik-korunur:** tüm yollar `validateUpstreamConfig` (npx/uvx allowlist + SSRF) + `sanitizeUpstreamOutput` + manifest-pin'den geçer; hiçbir yeni yol guard'ı by-pass etmez. (tüm fazlar)
- [ ] **P8 — Tenant-izolasyon korunur:** `owner` her lifecycle geçişinde (install/reconnect/remove) korunur; cross-tenant invoke `ToolRegistry.execute` owner-gate ile reddedilir. (Faz B regression)
- [ ] **P9 — Tek dispatch:** ikinci tool-dispatch path yok; her şey `ToolRegistry.execute`. (mimari invariant)
- [ ] **P10 — Test yeşil:** `mcp-hooks / mcp-manager / mcp-audit / mcp-list-changed / mcp-catalog-remote / mcp-manager.e2e` + mevcut `upstream-guard / mcp-stdio.e2e` → `npx vitest run` tam yeşil, `tsc --noEmit` temiz.

**Kasıtlı NON-parity (kapsam-dışı, gerekçeli):**
- odysseus'un yerleşik email/image/RAG MCP server'ları → bunlar **ayrı feature dosyaları** (04-modules); bu dosya yalnız *extension mekanizması*.
- Uzak extension registry'nin *imzalı/versiyonlu* dağıtımı → v2; şimdilik allowlist+fail-soft yeterli.
- 2FA/RBAC per-plugin `adminOnly` **enforce**'u → policy alanı manifest'e konur (Faz B) ama enforce, RBAC feature dosyasında (kesişim noktası işaretlendi).

---

## 6. Kör-Nokta Ledger

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| K1 | **Varsayım** | `server/mcp/hooks.ts` "Şef-3 gwv2" olarak KODDA YOK; gwv2 = tasarlanan yeni framework. "gwv2" adı grep'te bulunmadı (docs+server temiz). | Terminoloji: kullanıcı "gwv2 hooks framework" ile *mevcut* bir dosyayı kastettiyse, o dosya interceptors.ts olabilir. | Plan interceptors.ts'i gwv2-embriyosu kabul edip üstüne inşa ediyor; isim çakışması yok. Emre onayı ile "gwv2" = `hooks.ts` sabitlenmeli. |
| K2 | **Risk** | `tools/list_changed` advertise etmek (`listChanged:true`) bazı MCP conformance testlerini/istemci beklentilerini kırabilir. | Faz D davranış-değişimi. | `MCP_LIST_CHANGED=1` opt-in gate; default kapalı. |
| K3 | **Bilinmeyen** | Uzak katalog (`MCP_CATALOG_URL`) — Emre'nin böyle bir registry'i host edip etmeyeceği belirsiz; SSRF yüzeyi açar. | Faz E net değeri düşük olabilir. | Faz E **opsiyonel** işaretli; env-yokken bit-aynı; uzak fetch guard'dan geçer. Emre "gerekmez" derse atlanır. |
| K4 | **Varsayım** | `manifestFromUpstream` backward-compat: mevcut `tools.json`/`upstream_servers` şeması policy alanı içermez; default policy türetilir. | Eski config'ler policy'siz akar. | Default policy = mevcut davranış (tier=host_upstream, allowedTools=config'ten). Şema değişmez; yalnız üst-küme eklenir. |
| K5 | **Risk** | `plugin_events` tablosu büyüyebilir (audit trail unbounded). | Disk/perf. | Migration'da retention yok; C-fazına "opsiyonel `MCP_AUDIT_RETENTION_DAYS` purge" not düşüldü (v2). |
| K6 | **Bilinmeyen** | Per-plugin `rateLimitPerMin`/`adminOnly` **enforce** noktası bu dosyada değil (RBAC feature'ında). | Policy alanı tanımlı ama yarı-fonksiyonel. | Manifest'te alan var, enforce RBAC dosyasına devredildi; kesişim P-list'te işaretli. Yanıltıcı "tam RBAC" iddiası YOK. |
| K7 | **Varsayım** | SSRF residual (client.ts:169 yorumu): DNS-rebind connect-anında pin'lenmiyor. Bu plan onu ÇÖZMÜYOR. | Mevcut bilinen açık, plan-dışı. | Ledger'da açıkça taşınıyor; Faz-dışı, ayrı güvenlik-lane işi. |
| K8 | **Risk** | Boot fan-out'u (`server.ts:616-645`) `installPlugin`'e taşımak (Faz F) global-ownerless vs per-tenant-owner ayrımını yanlış yaparsa Faz-24 izolasyonu kırılır. | Kritik güvenlik regresyonu. | Faz B'de owner-preservation testi zorunlu (P8); Faz F yalnız davranış-koruyan refactor, önce test yeşil. |
| K9 | **Bilinmeyen** | `tests/` dizininde `catalog/supervisor/interceptors` testi YOK — bu modüllerin mevcut davranışı test-korumasız. | Refactor kör-nokta. | Faz A-F yeni test ekliyor; ama Faz F refactor öncesi supervisor/catalog için **characterization test** (mevcut davranışı kilitleyen) yazılması ledger-notu. |

---

## 7. Uygulama Sırası (özet)

```
A (hooks.ts)  →  B (manager.ts + manifest)  →  C (audit persist)
                        │
                        ├─► D (list_changed, opt-in)
                        ├─► E (remote catalog, opsiyonel)
                        └─► F (endpoint delege + boot fan-out refactor)  →  P1..P10 kabul
```

**Her fazda değişmez:** test-önce (kırmızı→yeşil→refactor) · tek-dispatch (choke-point) ·
never-throws · owner-preservation · guard-by-pass yok · WHY-only yorum.
