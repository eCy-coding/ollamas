# ODYSSEY 02-O0 — Temel Katman (Foundation) Tam TDD Planı

> **Hedef:** O0 = programın **BLOCKER** fazı — her modülün (O1–O8) bağımlı olduğu temel katman:
> **birleşik persistence deseni** (SQLite tablo + opsiyonel sqlite-vec koleksiyonu TEK erişim dikişinden) +
> **modül registry + `.env` toggle** + **route+tab choke-point** + **migration disiplini (v7+)**.
> **Kapsam kaynağı:** `00-MASTER.md §3` (O0 satırı) + `02-architecture.md` (Faz A0–A4 mimari sahibi) +
> `PROGRESS.md §1.2` (O0.vector / O0.registry / O0.migrations). Bu belge o mimariyi **yürütülebilir
> RED→GREEN adım listesine** indirger ve **KN-P3**'ü kapatır.
> **Doğrulama disiplini:** her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` canlı koduna karşı
> Read/Grep/`wc`/`ls` ile doğrulandı (tarih **2026-07-11**, §7 doğrulama günlüğü).
> **Dil:** TR (anlatı) · EN (kod/komut/dosya-yolu). **Yöntem:** her adım TDD (test-önce).
> **Değişmez:** O0 GREEN olmadan hiçbir modül fazı spawn edilmez (00-MASTER §3.1). Kodlama TÜM plan
> bitince başlar (PROGRESS.md kuralı) — bu belge **yalnız plandır**, kod içermez.

---

## 0. TL;DR (tek nefes)

O0 dört iş üretir: (1) **`server/modules/registry.ts`** — `ModuleDef` manifest'i (`id, envFlag, routes,
tab, migrations, tools`) + `mountEnabledModules()`; her modül route'u **tek prefix** `/api/modules/<id>/*`
altına, **`localOwnerGuard` kapsamının İÇİNE** mount edilir (V7 dersi: guard prefix-allowlist'ine girmeyen
her yeni route SAAS modunda **korumasız kalır** — bu artık **testli değişmez**). (2) **`server/store/vector.ts`**
— `VectorStore` arayüzü; `server/rag.ts`'in injektabl-embedder'lı sqlite-vec deseni **koleksiyon-başına ayrı
dosya** olarak sarılır. (3) **Migration v7+** — modül tabloları mevcut `MIGRATIONS` dizisine **global-monoton**
numarayla append edilir; `assertUniqueVersions` (`migrations.ts:211`) birleşik listede de çalışır.
(4) **`GET /api/modules`** + frontend tek-kayıt-yolu — App.tsx statik 21-tab listesine modül tab'ları
**manifest'ten** eklenir; `MODULE_<ID>=0` → route 404 **ve** tab gizli. Kanıt-tabanlı ana karar: **yeni bir
DB katmanı YOK** — `server/store` genişletilir (gerekçe §2.1), `server/modules/_core/store.ts` yalnız
**ince erişim-dikişi** (facade) olur.

---

## 1. Mevcut Durum (koda karşı doğrulanmış, 2026-07-11)

### 1.1 Üç persistence dünyası (birleşme O0'ın varlık sebebi)

| Dünya | Dosya / kanıt | Ne tutar | O0 kararı |
|---|---|---|---|
| **(a) Şifreli JSON vault** | `server/db.ts` — `atomicWriteFileSync`:13, master-key fail-closed:121-156, `encrypt`:323-331 / `decrypt`:336-350 (AES-256-GCM `iv:tag:ciphertext`, authTagLength=16) | API key'ler, sessions, permissions, securityLog (`DBConfig`:60-80) | **Dokunulmaz** — yalnız secret. Modül verisi buraya YAZILMAZ |
| **(b) SQLite/pg tenant store** | `server/store/index.ts` — `initStore()`:85 (adapter + WAL), baseline DDL:92-120, `closeStore`:32, `pingStore`:41, `appliedVersions`:49; `db-adapter.ts` dual-dialekt | tenants, api_keys, usage, invoices, audit, oauth, webhooks | **Modül tablolarının evi** (v7+ migration) |
| **(c) sqlite-vec RAG store** | `server/rag.ts` — dedike `DatabaseSync{allowExtension:true}`:82, `RagStore` arayüzü:66-70 (`index/search/close`), dim-kilit `ensureVec`:115-123, provider-kilit `ensureProvider`:100-113, injektabl `Embedder`:13, `resolveEmbedder`:38-62, süreç-tekil `ragIndex/ragSearch`:175-176 | `rag_docs` + `rag_vec` (tek global koleksiyon, `RAG_DB_PATH`:79) | **`VectorStore` arkasına alınır** — modüller doğrudan `rag.ts` açmaz |

**Kritik gözlem (kod):** `rag.ts` **tek** global koleksiyondur — `doc_id` üzerinde modül-filtresi yok
(`search`:142-157 tüm dokümanlarda KNN yapar). İki modül aynı store'a yazarsa arama sonuçları karışır →
koleksiyon kavramı O0'da eklenmek **zorunda** (§3 Faz 3).

### 1.2 Route kaydı + guard (V7 dersinin kanıtı)

- `server.ts` = **3267 satır** (`wc -l`, canlı; 00-MASTER'ın 3191 sayımından beri +76 — monolit **büyümeye devam ediyor**, O0 aciliyet kanıtı).
- **121 inline route** (`grep -c "app\.(get|post|put|delete|patch)"`). Tek kayıt-yolu yok; her route elle eklenir.
- Raw-body seam'leri `server.ts:253-265` (billing/ingest/github/upload/transcribe) **global JSON parser'dan (:268) ÖNCE** — modül mount'u bu sırayı bozamaz.
- **`localOwnerGuard`** fonksiyonu `server.ts:278-284` (SAAS_ENFORCE=1 → 403 fail-closed); **prefix-allowlist** `app.use([...], localOwnerGuard)` **`server.ts:285-296`**: `/api/terminal, /api/macos-terminal, /api/pipeline, /api/workspace, /api/backup, /api/cluster, /api/security, /api/generate, /api/ai, /api/agent, /api/keys, /api/models, /api/revenue, /api/notify, /api/ecysearcher, /api/threatfeed, /api/model-overrides, /api/github/actions, /api/github/search, /api/integrations`.
- **V7 dersi (yapısal açık):** guard **opt-in allowlist**'tir — listeye girmeyen her yeni prefix SAAS_ENFORCE=1 altında **korumasız** kalır. Bugün bunu yakalayan hiçbir test yok (`ls server/__tests__` → guard-coverage testi YOK). O0 bunu **değişmez + test** yapar (§3 Faz 2).

### 1.3 Frontend tab kaydı (dağınık, statik)

- `src/App.tsx` — **21 statik tab** nesnesi `{ id: "..." }` (:110-130, `grep -c '{ id: "'` → 21; 00-MASTER "22" ve PROGRESS "23" sayımları gevşek grep'ten — ledger notu KN-O9). `activeTab` state:64; her tab **ayrı** `activeTab === "..."` bloğuyla render (:282+) — ikinci dağınık kayıt-yolu.
- `src/lib/capabilities.ts` — `TAB_CAPABILITY` **statik** map:17-31, `isTabEnabled`:43-47 **deny-by-default**; perms `/api/health` telemetrisinden (App.tsx:67). Modül tab'ları için dinamik kaynak YOK → `/api/modules` gerekli (§3 Faz 4).

### 1.4 Migration + toggle + registry envanteri

- `server/store/migrations.ts` — `MIGRATIONS` **v1..v6**:50-205, append-only sözleşme:48-49, **`assertUniqueVersions`:211-219 modül-yükleme anında assert**, `runMigrations` advisory-lock (`withLock(778124)`):223-244, `rollbackTo`:252-272, `addColumnIfMissing`:40.
- `.env.example` = **21 anahtar** (`grep -cE '^[A-Z_]+='`); `MODULE_*` ailesi **YOK**. Toggle emsalleri: `SAAS_ENFORCE=0`, `MCP_AUTO_APPLY=1`, `MCP_EXPOSE_TIERS="safe,host,privileged"` (0/1 + CSV desenleri).
- `server/modules/` ve `server/module-registry.ts` **YOK** (`ls` teyit) — O0 sıfırdan kurar.
- `server/mcp/` = **12 dosya** (catalog, client, discovery, host-guard, oauth-metadata, oauth-provider, prompts, server, subscriptions(+test), supervisor, upstream-guard); `hooks.ts`/`manager.ts` YOK (O1 hedefi, bu belge kapsamı dışı).
- `server/tool-registry.ts` — `ToolTier`:43, **`register(name, def, owner?)`:852-855** (runtime tool ekleme VAR), `execute()` choke-point:882. Modül tool'ları bu mevcut API'yle kaydolur — **yeni dispatch yolu açılmaz**.

---

## 2. Mimari Kararlar (kanıta dayalı; 02-architecture ile hizalı)

### 2.1 K1 — Store dikişi: `server/store` GENİŞLETİLİR; `server/modules/_core/store.ts` yalnız ince facade

**Soru:** modül tabloları için `server/store`'u mu genişletmeli, yoksa yeni `server/modules/_core/store.ts`
DB katmanı mı kurmalı? **Karar: genişlet.** Kod-kanıtı:

1. `server/store/index.ts:85` `initStore()` zaten bir **`DbClient`** döndürür — dual-dialekt (SQLite↔pg,
   `db-adapter.ts`) + `withLock` + `closeStore` yaşam döngüsü **hazır**. İkinci bir DB katmanı bunların
   hepsini kopyalar (DRY ihlali) ve pg-moda geçişte modül verisini geride bırakır.
2. `migrations.ts:211-219 assertUniqueVersions` **tek** migration defterini modül-yükleme anında doğrular.
   İkinci bir defter (modül-lokal migration) bu assert'in **dışında** kalır → iki modül aynı v7'yi alır,
   taze DB'de şema ıraksar (KN-A7'nin ta kendisi).
3. `runMigrations`'ın advisory-lock'u (`:223-244`) çok-replika boot'ta **tek** defter varsayar.

**Facade'ın rolü (ince):** `server/modules/_core/store.ts` modüllere **daraltılmış** bir yüzey verir —
`getModuleDb(): DbClient` (initStore'dan) + `getVectorCollection(name): VectorStore` (§2.2). Modül kodu
`server/store/index.ts`'in tenant/billing fonksiyonlarını **import edemez** (lint import-guard, notes-K2
deseni). Böylece "TEK erişim dikişi" = `_core/store.ts`; altındaki gerçek katman = mevcut `server/store`.

### 2.2 K2 — VectorStore: koleksiyon-başına ayrı sqlite-vec dosyası (`server/store/vector.ts`)

`rag.ts`'in kanıtlanmış desenleri **aynen korunur**: injektabl `Embedder` (:13 — testler ollama'sız koşar),
dim-kilit (:115-123), provider-kilit (:100-113), lazy vec0 tablo (:117). Tek eksik **koleksiyon** kavramı
(§1.1 gözlemi). İki seçenek değerlendirildi:

- (a) *Paylaşılan `rag.db` + `doc_id` prefix'i:* `search`:142-157 SQL'ine modül-filtresi eklemek gerekir
  (KNN alt-sorgusuna `LIKE` → vec0 MATCH+LIMIT semantiği bozulma riski, `:148-149` yorumu bunu belgeler)
  ve dim/provider kilidi **global** kalır (bir modül farklı embed modeli kullanamaz).
- (b) **Koleksiyon = ayrı dosya** (`~/.llm-mission-control/vec/<collection>.db`): `createRagStore({dbPath})`
  (`rag.ts:78-79`) **zaten** dbPath parametreli — sıfır SQL değişikliği; kilitler koleksiyon-başına doğal
  izole; silme = dosya sil. **Karar: (b).**

`server/store/vector.ts` `VectorStore` arayüzünü (`upsert/query/delete/close`) tanımlar; sqlite-vec impl
`createRagStore`'u sarar (`delete` için `rag_docs/rag_vec` satır silme eklenir — `index()`:132-135'teki
upsert-silme deseni yeniden kullanılır). Mevcut `rag_index/rag_search` tool'ları ve global `rag.db`
**değişmez** (regresyon-yok); onlar "default" koleksiyon olarak arayüze sonradan bağlanabilir (O2 işi).
KN-A3/A4 mirası aynen geçerli: sqlite-vec tek-node/local-öncelik; `node:sqlite` kırılırsa impl-swap.

### 2.3 K3 — Guard-kapsamı değişmezi (V7 dersi → testli invariant)

**Değişmez (INV-O0-1):** *Express'e kayıtlı her modül route'u, `localOwnerGuard` prefix-allowlist'i
(`server.ts:285-296`) tarafından kapsanan bir prefix altında yaşamak ZORUNDADIR — ya da manifest'te
açıkça `authPolicy:"tenant"` bildirir (o zaman `authMiddleware` zinciri uygulanır).*

Uygulama: tüm modül route'ları **tek prefix** `/api/modules` altına mount edilir; bu prefix allowlist'e
**bir kez** eklenir (tek-satır diff). Böylece "her yeni modülde listeyi güncellemeyi unutma" riski sınıf
olarak ölür — unutulacak şey kalmaz. Test iki katmanlı (§3 Faz 2): (i) davranışsal — `SAAS_ENFORCE=1`
iken modül route'u 403; (ii) yapısal — router-stack taraması: `/api/modules` dışında path kaydeden
`ModuleDef` → test FAIL. Mount **sırası** `localOwnerGuard` `app.use`'undan SONRA (KN-A9 kararı; raw-body
seam'leri `:253-265` ve JSON parser `:268`'den de sonra — mevcut sıra korunur).

### 2.4 K4 — Manifest şeması (02-arch P2 iskeletinin bağlayıcı hali)

```ts
// server/modules/registry.ts (HEDEF — O0'da implement edilecek sözleşme)
export interface ModuleDef {
  id: string;                    // "demo" | "notes" | ... (^[a-z][a-z0-9-]*$)
  envFlag: string;               // "MODULE_DEMO" — tek okuma noktası moduleEnabled()
  tab?: { labelKey: string; icon: string; requiresCap?: Capability }; // frontend manifesti
  authPolicy?: "local-owner" | "tenant";     // default "local-owner" (INV-O0-1)
  mountRoutes(router: express.Router): void; // registry /api/modules/<id> altına mount eder
  tools?: { name: string; tier: ToolTier; schema: ToolSchema; invoke: ToolDef["invoke"] }[];
  migrations?: Migration[];      // numara GLOBAL-monoton (aşağıda defter), modül-lokal DEĞİL
}
export function moduleEnabled(id: string, env?: NodeJS.ProcessEnv): boolean;
export function mountEnabledModules(app: express.Express): void;
export function enabledModules(): { id: string; tab?: ModuleDef["tab"] }[]; // GET /api/modules
export function allModuleMigrations(): Migration[]; // birleşik defter → runMigrations
```

`mountRoutes` **raw `app` değil scoped `Router`** alır (02-arch iskeletinden bilinçli sapma): modül fiziksel
olarak kendi prefix'i dışına route yazamaz → INV-O0-1 yapısal garanti. Tool'lar yalnız modül **açıkken**
`registry.register()` (`tool-registry.ts:852`) ile kaydolur; kapalıyken `tools/list`'te görünmez.

### 2.5 K5 — Migration numara defteri (global-monoton, merkezi)

`ModuleDef.migrations` numaraları **bu belgede rezerve edilir** ve registry dosyasındaki yorum-defteriyle
senkron tutulur (KN-A7 azaltması). Boot akışı: `initStore()` → `runMigrations(db)` çekirdek v1-v6 →
`runMigrations` **birleşik** listeyle (çekirdek + `allModuleMigrations()`) — `assertUniqueVersions`
birleşik listede çağrılır. Rezervasyon:

| Versiyon | Sahip | İçerik |
|---|---|---|
| **v7** | O0 (bu plan) | `modules_registry` tablosu (id, enabled_snapshot, installed_at — audit/teşhis) + `module_demo_items` (örnek modül) |
| v8–v9 | O5 notes/tasks | notes, tasks, cron tabloları |
| v10 | O6 calendar | events/reminders |
| v11 | O8 security | `tenants.role` + `totp_secrets` |
| v12+ | serbest havuz | registry yorum-defterinden sırayla alınır |

---

## 3. Hedef Plan (TDD-adımlı — her Faz: önce RED test listesi, sonra GREEN kriteri)

> **Disiplin:** RED (failing test) → GREEN (minimal implement) → REFACTOR → `tsc --noEmit ✓ eslint ✓
> vitest run (fresh) ✓` → commit `feat(o0-<faz>): ...`. Implementer ≠ verifier. Test runner: `vitest`
> (mevcut `server/__tests__/` deseni, in-process `app` + `OLLAMAS_NO_AUTOBOOT=1` — `server.ts:298-301`
> yorumundaki M-050 emsali).

### FAZ 0 — Baseline + iskele (kapı: mevcut suite yeşil-taban)

- **T0.1** Baseline: `npx vitest run` + `npx playwright test` koş, sonucu PROGRESS'e yaz (KN-M10 kapanışı;
  flaky/live-gated testler `skipIf(!LIVE)` ile işaretlenir). **O0 kodu bu taban alınmadan yazılamaz.**
- **T0.2** İskele: `server/modules/` dizini + boş `registry.ts`/`_core/store.ts` + `server/store/vector.ts`
  boş export'lar. Yeni dep YOK (O0 tamamen mevcut bağımlılıklarla — `sqlite-vec@0.1.9` zaten var).
- **Kapı:** `tsc --noEmit` + `npm run build` yeşil; baseline sayısı kayıtlı.

### FAZ 1 — Modül registry + `.env` toggle (O0.registry; 02-arch A0)

**RED — `server/modules/__tests__/registry.test.ts`:**
1. `moduleEnabled("demo", {MODULE_DEMO:"1"})` → true; `{MODULE_DEMO:"0"}` → false; **env yokken → false**
   (default-OFF, KN-A5); bilinmeyen id → false.
2. Geçersiz id (`"Demo!"`, boşluk) ile `defineModule` → throw (regex `^[a-z][a-z0-9-]*$`).
3. Aynı id iki kez register → throw (çakışma erken yakalanır).
4. `mountEnabledModules(app)` (fake `ModuleDef`, supertest): `MODULE_DEMO=1` → `GET /api/modules/demo/ping`
   **200**; `MODULE_DEMO=0` → **404** (route hiç mount edilmemiş — 403 değil).
5. `ModuleDef.tools` kapalı modülde `ToolRegistry.has("demo_echo")` → false; açıkken true.

**GREEN:** `server/modules/registry.ts` — §2.4 sözleşmesi; `mountRoutes(router)` scoped-Router;
tool'lar mount-anında `registry.register()` (`tool-registry.ts:852`).
**Kapı:** 5 test PASS; mevcut suite yeşil (regresyon-yok).

### FAZ 2 — Guard-kapsamı değişmezi INV-O0-1 (V7 dersi; CRITICAL)

**RED — `server/__tests__/module-guard.test.ts`:**
1. `SAAS_ENFORCE=1` + `MODULE_DEMO=1` → `GET /api/modules/demo/ping` → **403** (localOwnerGuard
   fail-closed; `server.ts:278-284` davranışı modül yüzeyine uzanmış).
2. `SAAS_ENFORCE` unset → aynı route **200** (lokal-owner UX bozulmaz).
3. **Yapısal tarama:** `mountEnabledModules` sonrası express router-stack'te `/api/modules` dışına path
   kaydetmiş modül-route araması → **boş** (kötü niyetli/fake `ModuleDef` ile "sızma" denemesi FAIL etmeli).
4. **Sıra testi (KN-A9):** guard `app.use`'u modül mount'undan ÖNCE kayıtlı — middleware-stack index
   karşılaştırması (order-snapshot; `06-extensibility` KN-4 deseni).
5. `authPolicy:"tenant"` bildiren fake modül → route'u `authMiddleware` zincirinden geçer (401 anahtar-sız).

**GREEN:** `server.ts:285-296` listesine `"/api/modules"` **tek-satır** eklenir + `server.ts` sonuna (mevcut
route'lardan sonra, Vite middleware'den önce) `mountEnabledModules(app)` **tek-satır** çağrı. `git diff
server.ts` = **2 satır** (02-arch parity-1 kanıt biçimi).
**Kapı:** 5 test PASS; `SAAS_ENFORCE=1` altında hiçbir modül route'u guard'sız değil.

### FAZ 3 — Store dikişi + VectorStore + migration v7 (O0.vector + O0.migrations; 02-arch A1)

**RED — `server/store/__tests__/vector.test.ts`:**
1. Injektabl fake-embedder ile `col=openVectorCollection("t1")` → `upsert("a",text)` → `query(text,1)`
   en-yakın komşu `"a"` döner (ollama'sız, deterministik — `rag.ts:13` Embedder deseni).
2. Boş koleksiyonda `query` → `[]` (`rag.ts:144` davranış paritesi).
3. `delete("a")` sonrası `query` `"a"`'yı döndürmez.
4. **Koleksiyon izolasyonu:** `t1`'e yazılan, `t2.query`'de görünmez (ayrı dosya kanıtı).
5. **Dim-kilit paritesi:** aynı koleksiyona farklı boyutlu vektör → throw (`rag.ts:121` mesaj eşleşmesi);
   provider-kilit → throw (`rag.ts:108-111`).

**RED — `server/store/__tests__/module-migrations.test.ts`:**
6. v7 iki kez `runMigrations` → ikinci koşu `[]` döner (idempotent; `schema_migrations`'ta v7 tekil).
7. `assertUniqueVersions([...MIGRATIONS, ...allModuleMigrations()])` — çakışan v7 tanımlayan fake modül → throw.
8. `rollbackTo(db, 6)` v7'yi geri alır; tekrar `runMigrations` yeniden uygular (`migrations.ts:252` sözleşmesi).
9. `_core/store.ts` import-guard: `server/modules/**` içinden `server/store/index`'in tenant fonksiyonlarını
   import eden dosya → lint FAIL (eslint `no-restricted-imports` kuralı; notes-K2 deseni).

**GREEN:** `server/store/vector.ts` (VectorStore + sqlite-vec impl, §2.2) + `server/modules/_core/store.ts`
(facade, §2.1) + `migrations.ts`'e **v7 append** (§2.5) + eslint kuralı.
**Kapı:** 9 test PASS; global `rag.db`/`rag_index`/`rag_search` davranışı değişmedi (mevcut rag testleri yeşil).

### FAZ 4 — `/api/modules` + frontend tab choke-point (O0.tab)

**RED — `server/__tests__/modules-api.test.ts`:**
1. `GET /api/modules` → `{ modules: [{id:"demo", tab:{...}}] }` yalnız **açık** modülleri listeler;
   `MODULE_DEMO=0` → boş liste.
2. `SAAS_ENFORCE=1` → `/api/modules` **403** (guard kapsamında; frontend deny-by-default'a düşer).

**RED — `src/components/__tests__/module-tabs.test.tsx`** (`@testing-library/react`, mevcut desen):
3. `/api/modules` mock `[{id:"demo",tab:{labelKey:"tabs.demo",icon:"Box"}}]` → sidebar'da demo tab
   **görünür**; boş liste → **görünmez** (toggle-off = hidden-tab).
4. Fetch hata/403 → tab yok + konsol hatası yok (honest-empty; `capabilities.ts:4` deny-by-default paritesi).
5. Modül tab'ı `tab.requiresCap` bildirmişse `isTabEnabled` (`capabilities.ts:43-47`) ile AND'lenir.

**GREEN:** registry'ye `enabledModules()` + `server/modules/registry.ts` içinde `/api/modules` route'u
(kendi mount'u da `/api/modules` prefix'inde — guard otomatik kapsar); `src/lib/modules.ts` (fetch + tip) +
`App.tsx`'te statik TABS listesine `...moduleTabs` append (**tek** ekleme noktası; her modül için ayrı
`activeTab === "..."` bloğu YAZILMAZ — tek generic `<ModulePanel id={...}>` yuvası).
**Kapı:** 5 test PASS; App.tsx diff'i tek-yuva + tek-append ile sınırlı.

### FAZ 5 — Örnek no-op modül `demo` (şablon kanıtı; 02-arch A3'ün minimal öncüsü)

**RED — `server/modules/demo/__tests__/demo.test.ts`:**
1. `MODULE_DEMO=1`: `GET /api/modules/demo/ping` → `{ok:true}`; `POST /api/modules/demo/items {text}` →
   store'a yazar (v7 `module_demo_items`); `GET /api/modules/demo/items` → restart-persist okur
   (closeStore→initStore arası kalıcılık — `store/index.ts:32` idempotent-close sözleşmesi).
2. `POST /api/modules/demo/search {q}` → `VectorStore("demo")` üstünden komşu döner (fake embedder).
3. `MODULE_DEMO=0`: **tüm** demo route'ları 404 + `demo_echo` tool `tools/list`'te yok + tab gizli
   (Faz 4 testinin e2e teyidi).
4. `demo_echo` tool çağrısı `ToolRegistry.execute` **üzerinden** çalışır (choke-point bypass'ı yok —
   grep-testi: `server/modules/**` içinde `invoke` doğrudan çağrısı yok).

**GREEN:** `server/modules/demo/{index,router,service,store,schema}.ts` — ilk komple `ModuleDef`;
sonraki tüm O-modülleri (O2/O3/O5/O6) **bu dizini kopyalar**.
**Kapı:** 4 test PASS = **modular-service şablonu uçtan-uca kanıtlı**.

### FAZ 6 — Belge borcu + parity ölçümü (02-arch A4)

- **T6.1** `.env.example`'a `MODULE_*` bloğu (`MODULE_DEMO=0` + gelecek modüller yorumlu) — 21→22+ anahtar.
- **T6.2** `docs/odyssey/`'ye değil koda: `server/modules/registry.ts` başına migration numara-defteri
  yorumu (§2.5 tablosu) + INV-O0-1 metni (WHY-yorum kuralına uygun).
- **T6.3** Parity matrisi koş: `MODULE_DEMO={0,1} × SAAS_ENFORCE={unset,1}` 4 hücre × (route/tool/tab)
  beklenen-durum tablosu tek `vitest run`'da (`describe.each`).
- **Kapı:** §4 P1–P10 çeklisti işaretlenir; PROGRESS'e `O0.* DONE` satırları.

### Sıra kilidi + paralellik

```
FAZ 0 → FAZ 1 → FAZ 2 ─┬─→ FAZ 4 ─┐
              FAZ 3 ───┴─→ FAZ 5 ──┴─→ FAZ 6
```
FAZ 1↔3 paraleldir (registry ↔ vector bağımsız); FAZ 2 FAZ 1'e, FAZ 4 FAZ 1-2'ye, FAZ 5 hepsine bağlı.
**Ortak scheduler notu:** 00-MASTER §3 O0 başlığı "ortak scheduler" içerir ama PROGRESS §1.2 O0'ı 3 görevle
izler ve `cron.ts` sahibi O5'tir (notes-tasks.md). **Karar:** O0 scheduler **implement etmez**; yalnız
`webhooks/outbound.ts` claim/drain deseni O5 için emsal olarak işaretlenir (çelişki-çözümü, ledger KN-O8).

---

## 4. Parity Kabul Kriteri + Convergence + Efor

### 4.1 "Bitti" tanımı — hepsi GREEN olmadan O0 kapanmaz

- [ ] **P1** Registry: `ModuleDef` + `moduleEnabled` + `mountEnabledModules` testli çalışır (Faz 1, 5 test).
- [ ] **P2 (CRITICAL)** INV-O0-1 guard-kapsamı: `SAAS_ENFORCE=1` → modül route 403; yapısal tarama + sıra
  testi yeşil; `server.ts` diff'i 2 satır (Faz 2).
- [ ] **P3** Toggle-off tam karartma: `MODULE_X=0` → route 404 ∧ tool `tools/list`'te yok ∧ tab gizli (Faz 1/4/5).
- [ ] **P4** VectorStore: koleksiyon-izole `upsert/query/delete` ollama'sız yeşil; dim+provider kilit paritesi (Faz 3).
- [ ] **P5 (CRITICAL)** Migration v7 idempotent + birleşik `assertUniqueVersions` + `rollbackTo` (Faz 3).
- [ ] **P6** Store dikişi: modüller yalnız `_core/store.ts`'ten erişir; import-guard lint FAIL testi (Faz 3).
- [ ] **P7** `/api/modules` → frontend tab tek-kayıt-yolu; deny-by-default (Faz 4).
- [ ] **P8** Örnek `demo` modülü uçtan-uca (route+tool+persistence+vektör+tab) — şablon kanıtı (Faz 5).
- [ ] **P9** Regresyon-yok: baseline suite (T0.1 sayısı) + mevcut rag/store/guard testleri yeşil; global
  `rag.db` davranışı ve `server.ts` mevcut route'ları değişmedi.
- [ ] **P10** Kalite kapısı: `tsc --noEmit ✓ eslint ✓ vitest run (fresh) ✓ npm run build ✓`; yeni dep = 0.

**Bilerek kapsam-dışı (parity-dışı):** eski route'ların `server/modules/*`'a taşınması (strangler-fig,
KN-A1), ortak scheduler implementasyonu (O5), MCP hooks/manager (O1), `role` RBAC (O8, v11 rezerve),
pgvector (KN-A3), ⌘K nav refactor (NAV.refactor).

### 4.2 Convergence katkısı

09-testing §5 tablosunda **O0 = 4 kapı, 2 CRITICAL** (bugün 0 GREEN). Eşleme: kapı-1 registry+toggle
(P1+P3), kapı-2 **CRITICAL** guard-invariant (P2), kapı-3 vector+store-dikişi (P4+P6), kapı-4 **CRITICAL**
migration disiplini (P5). O0 GREEN → `convergence_score` +4/~75 **ve** 7 modül fazının spawn kilidi açılır
(00-MASTER §3.1) — programın kritik-yol ilk halkası (`O0 → O1 → O4/O6 → O8`).

### 4.3 Efor tahmini

00-MASTER §3.2 W0 sınıflaması **M** doğrulanır: yeni dep yok, tüm desenler kodda hazır (registry=YENİ ~250
satır; vector=`rag.ts` sarmalı ~150; testler ~600). Tahmin: **paralel 3 ajan-oturumu** (Faz1-2 ∥ Faz3 ∥
Faz4-frontend) + 1 birleştirme oturumu (Faz5-6) ≈ **4 oturum paralel / 6-8 seri**, ±%30. Riskli kalem:
Faz 2 yapısal router-stack taraması (express iç API'sine dayanır — KN-O3).

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| KN-O1 | R (CRITICAL) | INV-O0-1 tek-prefix stratejisi `/api/modules`'ü guard'a bir kez ekler; ama gelecek bir modül "kendi prefix'im olsun" derse (ör. webhook-alıcı raw-body ihtiyacı) allowlist-unutma riski geri döner | Guard'sız route | Faz 2 yapısal tarama testi **kalıcı** — prefix-dışı kayıt her zaman FAIL; raw-body isteyen modül için manifest'e `rawBodyPaths` alanı ANCAK ayrı T0 kararıyla (şimdilik yasak) |
| KN-O2 | R | `mountEnabledModules` boot-anı okur; `.env` değişikliği restart ister (hot-toggle yok) | UX: toggle → restart | Kabul (odysseus da restart'lı); `modules_registry` v7 tablosu `enabled_snapshot` ile teşhis edilebilirlik verir |
| KN-O3 | B | Faz 2 yapısal tarama `app._router.stack` **iç** API'sine dayanır; Express 5 geçişinde kırılabilir | Test kırılganlığı | Davranışsal testler (403/404) birincil kanıt; yapısal test ikincil savunma — kırılırsa yalnız o test revize edilir |
| KN-O4 | V | Koleksiyon-başına dosya (K2) çok koleksiyonda dosya çoğalması (n×WAL handle) | fd/disk baskısı (uzak) | O0'da ≤3 koleksiyon; `VectorStore.close()` yaşam-döngüsü + LRU-kapatma gerekirse O2+'da |
| KN-O5 | B | `_core/store.ts` facade'ının `initStore()` çağrı-zamanı: modül testi in-process `app` + `OLLAMAS_NO_AUTOBOOT=1` yolunda store init edilmemiş olabilir (`store/index.ts:26` throw) | Test-boot sıralaması | Facade lazy-init yapar (`initStore()` idempotent `:86`); Faz 5 restart-persist testi bunu doğrular |
| KN-O6 | R | `GET /api/modules` guard'lı (SaaS'ta 403) — SaaS-tenant'a modül-tab hiç sunulamaz | SaaS'ta modül UI yok | Bilinçli: O0 kapsamı lokal-owner dashboard; SaaS-yüzeyli modül `authPolicy:"tenant"` + ayrı karar (O8-RBAC sonrası) |
| KN-O7 | V | Migration rezervasyon tablosu (§2.5) belge-içi; şefler farklı sırada ship ederse numara çarpışır | Migration çakışma | Kaynak-of-truth = `registry.ts` yorum-defteri (kod-içi, merge-çakışması görünür) + Faz 3 test-7 birleşik-assert her PR'da yakalar |
| KN-O8 | K | "Ortak scheduler" 00-MASTER O0 başlığında var, PROGRESS §1.2'de yok — çelişki | Kapsam belirsizliği | **Karar (§3):** O0 scheduler yapmaz; O5 `cron.ts` sahibi. 00-MASTER'a düzeltme-notu T0 sweep'inde |
| KN-O9 | G | Tab sayısı sayım-çelişkisi: canlı `grep -c '{ id: "'` → **21**; 00-MASTER "22", PROGRESS "23" (gevşek grep `id:` state satırını sayıyor) | Envanter tutarlılığı | Bu belge 21'i kanonik alır (App.tsx:110-130 elle sayıldı); zararsız, kod-etkisi yok |
| KN-O10 | G | `server.ts` canlı 3267 satır (plan-seti 3191 der) — plan-yazımından beri trunk büyüdü; satır-referanslı iddialar kayabilir | file:line kayması | O0 implementasyon-öncesi `localOwnerGuard`/raw-seam satırlarını yeniden grep'le (bugün :278-296 teyitli); satır yerine desen-arama kullan |

---

## 6. KN-P3 Kapanış Notu

PROGRESS §5 **KN-P3** ("O0 detay planı `02-o0-foundation.md` YOK — program-blocker") bu belgeyle
**KAPANDI**: O0'ın üç görevi (O0.registry / O0.vector / O0.migrations) + tab-choke-point artık Faz 0–6
RED-listeli, GREEN-kriterli, parity-kabul-kriterli (P1–P10) tam TDD planına sahip. Persistence-uçurumu
kararı netleşti (§2.1-2.2: `server/store` genişletilir, vektör = koleksiyon-başına sqlite-vec dosyası,
vault dokunulmaz). 00-MASTER §10-1'deki "`02-o0-foundation` işlevini `02-architecture` üstlendi" notu
artık şöyle okunmalı: `02-architecture` **mimari sahibi** kalır; bu belge onun A0–A4 fazlarını
**yürütme-hazır** teste indirger — çift-implement yok (sahiplik: iskelet/karar=02-arch, RED-listesi=bu belge).
Kodlamanın kalan ön-koşulları (değişmedi): KN-M10 baseline (Faz 0 T0.1'e gömüldü) + T0 kararları
(KN-M3/M6/M7) + payda-dondur.

---

## 7. Doğrulama Günlüğü (bu belgenin kanıt tabanı, 2026-07-11)

| İddia | Kanıt | Sonuç |
|---|---|---|
| `server.ts` satır | `wc -l` → **3267** | ⚠️ plan-setinin 3191'inden büyüdü → KN-O10 |
| `localOwnerGuard` fn + allowlist | Read `server.ts:278-284` (fn) + `:285-296` (`app.use([...20 prefix], localOwnerGuard)`) | ✅ prefix-allowlist, fail-closed 403 |
| Inline route sayısı | `grep -c "app\.(get\|post\|put\|delete\|patch)"` → 121 | ✅ tek kayıt-yolu yok |
| Raw-body seam sırası | Read `server.ts:253-265` (raw) → `:268` (`express.json 50mb`) | ✅ mount-sıra kısıtı |
| store `initStore→DbClient` | Read `server/store/index.ts:85-92`; `closeStore`:32; throw-if-uninit:26 | ✅ K1 gerekçesi |
| migrations v1..6 + assert | Read `migrations.ts:50-205` (v6 son) + `assertUniqueVersions`:211-219 + `withLock`:223-244 + `rollbackTo`:252 | ✅ v7+ append hedefi |
| rag.ts desenleri | Read `server/rag.ts` tam: `Embedder`:13, `createRagStore(dbPath)`:78-79, `DatabaseSync{allowExtension}`:82, provider-kilit:100-113, dim-kilit:115-123, KNN-LIMIT notu:148-149, tekil-store:167-176 | ✅ K2 gerekçesi; koleksiyon-filtresi YOK teyit |
| db.ts vault | Read `db.ts:13` atomicWrite, `:121-156` master-key fail-closed, `:323-350` encrypt/decrypt AES-256-GCM | ✅ vault dokunulmaz kararı |
| App.tsx tab kaydı | `grep -c '{ id: "'` → **21** (`:110-130`); `activeTab`:64; render blokları:282+ | ⚠️ 22/23 sayımlarıyla çelişki → KN-O9 |
| capabilities gate | Read `src/lib/capabilities.ts:17-31` statik map, `:43-47` isTabEnabled deny-by-default | ✅ Faz 4 parite hedefi |
| `.env.example` | `grep -cE '^[A-Z_]+='` → 21; `MODULE_*` yok; emsaller `SAAS_ENFORCE`/`MCP_AUTO_APPLY` | ✅ Faz 6 hedefi |
| `server/modules` + registry | `ls` → **YOK** (ikisi de) | ✅ sıfırdan inşa |
| `server/mcp/*` | `ls` → 12 dosya; `hooks.ts`/`manager.ts` yok | ✅ O1 sınırı korunur |
| tool-registry register | Read `tool-registry.ts:852-855` (`register(name,def,owner?)`) + `execute`:882 | ✅ Faz 1/5 kayıt-akışı mevcut API'yle |

---

*Üretici: ODYSSEY planlama üreteci (O0 foundation, KN-P3 kapanışı). Kaynak: `docs/odyssey/{00-MASTER,
02-architecture,PROGRESS}.md` + `05-features/documents.md` (format emsali) + canlı kod (`server.ts:3267`,
`server/store/{index,migrations}.ts`, `server/rag.ts`, `server/db.ts`, `server/tool-registry.ts`,
`src/App.tsx`, `src/lib/capabilities.ts`, `.env.example`, `server/mcp/` ls). Doğrulama tarihi: 2026-07-11.*
