# ODYSSEY — O2: Research Modülü (deep_research + SearXNG) — KANONİK TAM TDD PLANI

> **Hedef:** ollamas'ın sağlam tek-atışlık `web_search` temelini, odysseus-parity bir **deep-research**
> modülüne evrimleştirmek: self-host **SearXNG** meta-search + **query-decompose → multi-search →
> fetch → rag-ingest → cited-synthesize** pipeline'ı + `/api/research` rotaları + Research UI tab'ı +
> MCP `deep_research` tool expose. **Yeniden-inşa DEĞİL** — 00-MASTER kritik gerçeği: mevcut
> search/fetch/extract/RAG/model-routing altyapısı **entegre + formalize** edilir.
> **Referans:** odysseus `research` modülü (`deep_research.py` + `research_handler` + SearXNG docker
> + `topic_analyzer` + `RESEARCH_LLM_ENDPOINT`).
> **Kanoniklik notu:** Bu belge PROGRESS `PLAN.gap` / 00-MASTER **KN-M2**'nin kapanışıdır.
> Eş-zamanlı taslak `05-features/research-searxng.md` (2026-07-10) buraya **absorbe** edildi;
> çelişkide **bu belge** geçerlidir. UI sözleşmesi `design-execution/panels/research.md` ile birebir.
> **Dil:** açıklama TR, kod/komut/dosya-yolu EN. **Doğrulama:** 2026-07-11, koda karşı (Read/Grep).

---

## 1. Mevcut Durum — VAR/YOK Envanteri (koda karşı doğrulanmış, file:line)

> **KRİTİK AYRIM (kör-nokta ilk sıra):** `server/ecysearcher*.ts` = **threat-intel** platformu
> (ayrı Flask+Postgres+Redis stack), odysseus web-research modülü DEĞİL. Research'ün temeli
> `web_search` zinciridir; `ecysearcher-proxy` yalnız **proxy/fail-soft deseni** olarak emsal alınır.

### 1.1 VAR — yeniden kullanılacak (sıfırdan yazılmayacak)

| Yetenek | Dosya:satır | Not / reuse kararı |
|---|---|---|
| Agent `web_search` tool (query/url/render/deep/top) | `server/tool-registry.ts:536` | deep=default; choke-point'ten geçer — **korunur, regresyon yasak** |
| Arama CLI (search/deep/fetch) | `bin/host-bridge/tools/web_search.mjs` (`ddgSearch:43`, `runDeep:92`, cache `:24`, `renderHtml:52`) | tek-sorgu motor; engine'in **fetch katmanı** olur |
| İçerik çıkarımı (pure, testli) | `bin/host-bridge/tools/lib/web-extract.mjs` (`extractReadable`, `mapLimit`, `snippetSufficient`, `needsRender`) | readability + paralel fetch — **aynen reuse** |
| **Tavily pure mapping (BAĞLANMAMIŞ)** | `bin/host-bridge/tools/lib/tavily.mjs:7` `buildTavilyRequest` / `:19` `parseTavilyResults` + `tests/web-search-tavily.test.ts` | lib + test VAR ama `web_search.mjs` **import ETMİYOR** (grep: 0 çağrı) → Faz 0'da **formalize edilir** |
| Tavily key altyapısı | `server/key-doctor.ts:58` (`TAVILY_API_KEY`) + `:193` `tavilyValidate`; redaction `server/telemetry.ts:69` | key-health/validate hazır — yeni key-yönetimi yazılmaz |
| **RAG vektör-store (sqlite-vec)** | `server/rag.ts:66` `RagStore{index,search,close}` · `:78` `createRagStore` (dedicated DB, dim + embed-provider guard) · `:17` `embedText` (ollama `nomic-embed-text`) · `:38` `resolveEmbedder` (EMBED_PROVIDER→local fallback) | research kaynakları **buraya ingest edilir** — yeni vektör-store YAZILMAZ (O0.vector bunu formalize eder) |
| RAG agent tool'ları | `server/tool-registry.ts:745` `rag_index` (tier host) · `:766` `rag_search` (tier safe) · import `:14` | cross-run retrieval hazır |
| Model routing | `server/ai.ts:35` `MAC_MODEL_CHAMPION="qwen3:8b"` · `:198` `pickEngine(task)` · `:122` `generateText` | summarize/synthesize LLM çağrıları **bu API'den** — yeni provider yazılmaz |
| localOwnerGuard + prefix listesi | `server.ts:278` guard · `:284-295` `app.use([...prefixler])` · test `tests/localowner-guard.test.ts` | **V7 dersi:** yeni `/api/research` prefix'i bu listeye + bu teste GİRMELİ |
| Proxy fail-soft emsali | `server/ecysearcher-proxy.ts:47` `ecysearcherProxy` (502 honest, asla throw) · `:39` offline-gate · mount `server.ts:650` | SearXNG proxy'sinin **davranış emsali** (200-offline-body + breaker) |
| MCP expose (choke-point) | `server/mcp/server.ts:93` `tools/list` = `ToolRegistry.list` · `:152` `ToolRegistry.execute` | registry'ye eklenen tool **otomatik** `/mcp`'de görünür — ikinci dispatch-path YASAK |
| MCP upstream federation | `server/mcp/supervisor.ts:135` `startSupervisor` · `:151` `getCollisions` | isim-çakışması denetimi `deep_research` için de geçerli |
| docker-compose profil deseni | `docker-compose.yml:83` `profiles: ["postgres"]` | SearXNG aynı desenle **opsiyonel** profil olur |
| Test altyapısı | `vitest` + `@playwright/test` + `tests/web-search-tool.test.ts` | RED→GREEN döngüsü hazır |

### 1.2 YOK — bu planın konusu

- **SearXNG YOK.** `SEARXNG`/`SEARCH_BACKEND` env'i kodda hiçbir yerde yok (grep: yalnız docs).
  Tek canlı arama yolu DDG HTML-scrape (`web_search.mjs:43`) — bloklanabilir, fallback'siz.
- **Tavily zinciri bağlı DEĞİL.** Pure lib + test var; `web_search.mjs` çağırmıyor (formalizasyon açığı).
- **Çok-adımlı döngü YOK.** `runDeep()` tek sorgu → top-N fetch → düz JSON. plan→alt-sorgu→tur→
  boşluk-analiz→sentez orkestrasyonu yok.
- **Atıflı rapor sentezi YOK.** `[n]` atıflı Markdown + kaynak listesi üretimi yok.
- **RAG-ingest köprüsü YOK.** Fetch edilen kaynaklar `rag.ts`'e yazılmıyor (agent manuel `rag_index`
  çağırmadıkça) — araştırma bilgisi kalıcı değil.
- **`/api/research*` rotası YOK** (`grep server.ts`: 0); `research_runs` persist yok
  (migrations son sürüm **v6** — `server/store/migrations.ts:194`).
- **Research UI YOK.** `src/App.tsx` `tabs[]`'ta `research` yok; `ResearchPanel.tsx` yok.
- **`deep_research` MCP/agent tool YOK**; `MODULE_RESEARCH`/`ENABLE_RESEARCH` toggle yok
  (`.env.example`: 46 anahtar, research-ilgili 0).

---

## 2. Odysseus Referansı → ollamas Eşlemesi (entegrasyon kararları)

| İşlev | odysseus (Py) | ollamas karşılığı | Karar |
|---|---|---|---|
| Meta-search | SearXNG (docker :8080) | compose `--profile research`, host `127.0.0.1:8888` | **Yeni servis** (opsiyonel); zincir: SearXNG → Tavily → DDG |
| fetch+extract | `research_handler` | `web_search.mjs` + `web-extract.mjs` | **REUSE** — sıfırdan yazma |
| Özetleme | `RESEARCH_LLM_ENDPOINT` | `server/ai.ts` `generateText`/`pickEngine` + `RESEARCH_MODEL` | **REUSE** + ince katman `server/research/summarize.ts` |
| İteratif sorgu | `topic_analyzer` | yeni `server/research/planner.ts` | Yeni (LLM sorgu-genişletme, deps-injected) |
| Orkestrasyon | `deep_research.py` | yeni `server/research/engine.ts` | Yeni (tur döngüsü + durma kriteri) |
| Kalıcı bilgi | ChromaDB | `server/rag.ts` sqlite-vec (`RagStore.index`) | **REUSE** — O0.vector seam'i; ChromaDB kurulmaz |
| Rapor | rapor üretici | yeni `server/research/report.ts` | Yeni (atıflı Markdown, anti-halüsinasyon) |
| Araç expose | modül API | `ToolRegistry` `deep_research` → otomatik `/mcp` | **REUSE** choke-point (`mcp/server.ts:95/152`) |

**Mimari karar:** search backend docker-izole (SearXNG, opsiyonel); orkestratör **server-side TS**
(`server/research/*`) — SEA/Cloud-Run hedefi + mevcut TS altyapısı reuse. Pipeline adım-vokabüleri
UI ile kilitli: **plan → fetch → summarize → verify → synthesize** (`panels/research.md` §2).
RAG-ingest, `fetch/summarize` adımlarının yan-etkisidir (aşağıda Faz 3).

---

## 3. TDD Plan — Faz 0–7 (her faz: RED test önce → minimal GREEN → refactor)

> **Kapı (her faz sonu):** `tsc --noEmit` ✓ `eslint` ✓ `vitest run` (fresh) ✓.
> **O0 BLOKER:** Faz 3 (rag-ingest persist) ve Faz 5 (`research_runs` migration v7+) **O0 GREEN
> olmadan yazılamaz** (PROGRESS §1.2: O0.vector `persistence-vector.test.ts` + O0.migrations +
> O0.registry). Faz 0–2 saf/mock olduğu için O0'a paralel hazırlanabilir; merge O0 sonrası.

### FAZ 0 — SearXNG servisi + search-backend zinciri (Tavily formalizasyonu dahil)

**RED — `tests/research/searxng-client.test.ts`:**
- `buildSearxUrl(base, {q, categories})` → `…/search?q=…&format=json` (pure, ağsız).
- `parseSearxResults(fixtureJson, max)` → normalize `{title,url,snippet}[]`; boş/bozuk → `null`.
- Backend zinciri (mock fetch): `SEARXNG_URL` set + 200 → SearXNG sonuçları; SearXNG 5xx/timeout →
  `TAVILY_API_KEY` varsa Tavily (`buildTavilyRequest` **artık çağrılıyor** — mevcut açığı kapatır);
  o da yoksa/boşsa DDG. Zincir asla throw etmez (fail-soft), kullanılan backend `source` alanında raporlanır.

**GREEN:**
- `docker-compose.yml`'e `searxng` servisi `profiles: ["research"]` (`:83` postgres deseni);
  imaj `searxng/searxng`, host portu **`127.0.0.1:8888:8080`** (8080/8088 = eCySearcher çakışması),
  `settings.yml` volume ile `search.formats: [html, json]` açık (JSON default kapalı — K2).
- `web-extract.mjs`'e saf `buildSearxUrl`+`parseSearxResults`; `web_search.mjs`'e `searchBackend()`
  seçici (searxng→tavily→ddg) — `ddgSearch` korunur, `runSearch/runDeep` girişinde zincir.
- `.env.example`: `SEARXNG_URL` (default `http://localhost:8888`), `SEARCH_BACKEND` (`auto|searxng|tavily|ddg`, default `auto`).
- **Reuse:** cache/`mapLimit`/render aynen; yalnız sonuç-kaynağı değişir. `tests/web-search-tool.test.ts` yeşil kalır.

### FAZ 1 — Summarize katmanı (`server/research/summarize.ts`)

**RED — `tests/research/summarize.test.ts`:**
- `chunkForSummary(text, maxChars)` pure parçalama.
- `summarizeSource({title,url,text}, deps)` (mock `deps.generate`) → `{url, title, summary, keyPoints[]}`; **URL atıfı korunur**.
- LLM erişilemez → ham snippet'e **fail-soft** düşer (araştırma kesilmez).

**GREEN:** model = `RESEARCH_MODEL` env → yoksa `ai.ts` `MAC_MODEL_CHAMPION` (local qwen3:8b).
Çağrı `ai.ts:122 generateText` üzerinden (yeni provider YOK). Config: `RESEARCH_MAX_SOURCE_CHARS` (6000, `web-extract maxText` hizalı).

### FAZ 2 — Planner + Engine (query-decompose + tur döngüsü)

**RED — `tests/research/engine.test.ts`:**
- `planInitialQueries(question, deps)` → 2–4 alt-sorgu (min 1, max `RESEARCH_MAX_QUERIES`).
- `nextQueries(question, gathered, deps)` → boşluk-tespit → yeni sorgu **veya** boş (durma).
- `runResearch(question, deps)` (tümü mock): ≤`RESEARCH_MAX_ROUNDS` tur; her tur ara→getir→özetle;
  sorgu-tekrar guard'ı; boş `nextQueries` → erken durur; sonuç `{question, rounds[], sources[], report}`.
- `onProgress(step, meta)` callback'i **plan/fetch/summarize/verify/synthesize** adımlarını sırayla yayar (UI/SSE sözleşmesi).

**GREEN:** `server/research/planner.ts` + `engine.ts` (deps-injected; `searchBackend` Faz 0 +
`fetchReadable` reuse + `summarizeSource` Faz 1). Config: `RESEARCH_MAX_ROUNDS=3`,
`RESEARCH_MAX_QUERIES=4`, `RESEARCH_TOP_PER_QUERY=3`.

### FAZ 3 — RAG-ingest köprüsü (persistence — **O0.vector seam**) ⛔ O0 GREEN şart

**RED — `tests/research/rag-ingest.test.ts`:**
- Engine her özetlenen kaynağı `deps.ragIndex("research:<runId>:<n>", summaryText)` ile yazar (mock spy).
- `RESEARCH_RAG_INGEST=0` → hiç yazmaz (toggle).
- Sentez öncesi `deps.ragSearch(question, k)` ile geçmiş-araştırma bağlamı çekilir; boş index'te sorunsuz (honest-empty).

**GREEN:** `server/rag.ts` `ragIndex/ragSearch` **reuse** (`tool-registry.ts:14` importuyla aynı yüzey);
doc-id şeması `research:<runId>:<sourceIdx>` (upsert idempotent — `RagStore.index` `:66`).
Yeni vektör-store YAZILMAZ; O0.vector'un `persistence-vector.test.ts`'i temel garanti.

### FAZ 4 — Atıflı rapor sentezi (`server/research/report.ts`)

**RED — `tests/research/report.test.ts`:**
- `buildReport(question, gathered, deps)` (mock) → Markdown: yönetici-özeti + tematik bölümler;
  her iddia `[n]` atıflı + numaralı kaynak listesi; **atıfsız cümle yok** (regex denetimi).
- Kaynak yoksa → "yeterli kaynak bulunamadı" **honest-empty** (uydurma rapor YASAK — panels KN3 ortak kural).
- Routing: `deep=true` + `RESEARCH_DEEP_MODEL` set → derin model; değilse local (mock ile assert).

**GREEN:** yalnız `gathered` özetlerinden yaz (anti-halüsinasyon); `citations[] = {n, title, url, domain, date}`.

### FAZ 5 — Server route + guard + persist ⛔ O0 GREEN şart (migration v7)

**RED — `server/__tests__/research-route.test.ts`:**
- `POST /api/research {question, deep?}` → 200 `{report, sources, rounds}` (engine mock).
- **Guard-coverage invariant (V7 dersi):** `SAAS_ENFORCE=1` iken `/api/research` → **403**;
  `tests/localowner-guard.test.ts` prefix-listesine `/api/research` eklenir — liste testte assert edilir.
- `MODULE_RESEARCH=0` (O0.registry toggle) → route **404** (module-toggle deseni).
- SearXNG down → yine 200 (zincir fail-soft, `source:"ddg"`); demo mode → deterministik fixture.
- `GET /api/research/runs` → persist edilmiş geçmiş; migration **v7 `research_runs`** idempotent (G7).

**GREEN:** `server.ts` `app.use` guard listesine (`:284-295`) `/api/research` ekle; route kaydı
O0 `module-registry` üzerinden. SSE `GET /api/research/stream` (onProgress → `res.write`).
`server/openapi.ts`'e şema; `db.logSecurity`/telemetry izi.

### FAZ 6 — Research UI tab (`src/components/ResearchPanel.tsx`) — panels/research.md sözleşmesi

**RED — `src/components/__tests__/ResearchPanel.test.tsx`:**
- 4 durum: boş (örnek-soru çipleri) / araştırıyor (5 adım kartı: plan→fetch→summarize→verify→synthesize,
  running vurgulu) / hata (SearXNG-down amber banner **veya** honest-empty + retry; sessiz-boş YASAK) /
  dolu (solda `[n]` atıflı rapor, sağda numaralı kaynak listesi; çip↔kaynak çift-yönlü vurgu).
- `ENABLE_RESEARCH` kapalı → tab görünmez. ⌘↵ araştır / esc iptal. a11y: `role="list"` + `aria-live="polite"`.
- E2E (Playwright, mock backend): soru → rapor + kaynaklar happy-path.

**GREEN:** Claude Design handoff-bundle'dan implement (`panels/research.md` §7 — mock→real map:
`rounds[]`→adım kartları, `report`→`marked`+`dompurify` sanitize [documents Faz 4 ile aynı karar],
`sources[]`→kaynak listesi). `App.tsx tabs[]`'a `research`; i18n `research.*` EN+TR
(`src/locales/{en,tr}.ts`). `ECySearcherPanel`'den yalnız liste/kart/input/durum-pill **iskeleti**
(içerik/endpoint KOPYALANMAZ — panels KN1).

### FAZ 7 — MCP + agent tool expose (`deep_research`)

**RED — `tests/research/deep-research-tool.test.ts`:**
- `ToolRegistry`'de `deep_research {question, deep?, maxRounds?}` şeması; invoke → `runResearch` (mock) → `{report, sources}`.
- `/mcp tools/list`'te `deep_research` görünür (`mcp/server.ts:95` yolu — otomatik, ayrı MCP kodu YOK).
- Upstream federation çakışma denetimi: `getCollisions()` (`supervisor.ts:151`) `deep_research` adı
  bir upstream'le çakışırsa yüzeye çıkar (assert).

**GREEN:** `tool-registry.ts`'e tool (web_search `:536` bloğu deseni; tier: `host` — ağ+LLM maliyeti).
ReAct agent "derin araştırma" isteyebilir; tek `web_search`'ten farkı iteratif+atıflı-rapor.

---

## 4. Parity Kabul Kriteri (odysseus research modülüne karşı — "bitti" tanımı)

| # | Kriter | CRITICAL |
|---|---|---|
| **P1** | SearXNG `docker compose --profile research up -d` ayakta; `GET /search?…&format=json` döner; ana :3000 etkilenmez | — |
| **P2** | Backend zinciri: SearXNG → Tavily (key varsa) → DDG; hiçbir katman throw etmez; Tavily artık **canlı bağlı** | ✓ (fail-soft) |
| **P3** | Summarize: her kaynak LLM-özetli, URL atıfı korunur; LLM yoksa snippet fail-soft | — |
| **P4** | Engine: soru → alt-sorgu planı → ≤maxRounds tur → boşluk-temelli yeni sorgu → durma; sorgu-tekrar guard | ✓ (token patlaması) |
| **P5** | Atıflı rapor: `[n]` + kaynak listesi; atıfsız iddia yok; kaynak yoksa honest-empty | ✓ (anti-halüsinasyon) |
| **P6** | RAG-ingest: kaynaklar `rag.ts` store'a `research:<runId>:<n>` ile yazılır; `rag_search` cross-run bulur; `RESEARCH_RAG_INGEST=0` kapatır | ✓ (O0 persistence) |
| **P7** | `POST /api/research` + SSE + `research_runs` persist (migration v7 idempotent) + demo-fixture | — |
| **P8** | **Guard invariant:** `/api/research` localOwnerGuard listesinde; `SAAS_ENFORCE=1` → 403; `localowner-guard.test.ts` genişletildi | ✓ (V7) |
| **P9** | UI tab: 4 durum + 5 adım kartı + atıflı rapor + kaynak listesi + dark/light + i18n EN/TR + a11y | — |
| **P10** | `deep_research` ToolRegistry'de; `/mcp tools/list`'te otomatik görünür; federation çakışması denetli; ikinci dispatch-path YOK | ✓ (choke-point) |
| **P11** | Config-driven: §5 env toggle'ları etkili; `MODULE_RESEARCH=0` → 404 + tab gizli | — |
| **P12** | Regresyon yok: `web_search` tool + `tests/web-search-tool.test.ts` + ana compose (profil'siz) değişmedi; `tsc`+`eslint`+`vitest` fresh yeşil | ✓ |

**Bilerek kapsam-dışı** (ayrı iş): akademik/PDF-pipeline (documents kesişimi), gerçek-zamanlı işbirliği,
Tor-üzerinden arama, ödemeli ek arama API'leri (Brave/Serp), mobil <768px detay tasarımı.

---

## 5. `.env` Toggle Envanteri (config-driven — odysseus ruhu)

| Anahtar | Default | Etki | Durum |
|---|---|---|---|
| `MODULE_RESEARCH` | `1` | O0.registry: `0` → route 404 + tab gizli + `/mcp`'de tool yok | YENİ |
| `ENABLE_RESEARCH` | `MODULE_RESEARCH` alias (UI-gate) | tab görünürlüğü | YENİ |
| `SEARXNG_URL` | `http://localhost:8888` | SearXNG base | YENİ |
| `SEARCH_BACKEND` | `auto` | `auto\|searxng\|tavily\|ddg` zincir pini | YENİ |
| `TAVILY_API_KEY` | — | Tavily katmanı (key-doctor `:58` zaten yönetiyor) | **VAR** (bağlanacak) |
| `RESEARCH_MODEL` | `MAC_MODEL_CHAMPION` (qwen3:8b) | summarize/plan modeli | YENİ |
| `RESEARCH_DEEP_MODEL` | — | `deep=true` sentez modeli (cloud opsiyonel) | YENİ |
| `RESEARCH_MAX_ROUNDS` / `RESEARCH_MAX_QUERIES` / `RESEARCH_TOP_PER_QUERY` | `3/4/3` | döngü tavanları (P4) | YENİ |
| `RESEARCH_MAX_SOURCE_CHARS` | `6000` | kaynak-metin tavanı | YENİ |
| `RESEARCH_RAG_INGEST` | `1` | kaynakları RAG'e yaz (P6) | YENİ |
| `RAG_DB_PATH` / `OLLAMA_EMBED_MODEL` / `EMBED_PROVIDER` | (mevcut) | `rag.ts:17/38/79` — aynen reuse | **VAR** |

**docker-compose notu:** `searxng` servisi **opsiyonel profil** — `docker compose --profile research
up -d`; profil'siz `docker compose up` davranışı değişmez (P1/P12). Ana kurulum SearXNG'siz de çalışır
(zincir Tavily/DDG'ye düşer) — KN-P8 "opsiyonel + toggle-off default" ilkesi.

---

## 6. MCP Extension Bölümü (expose + federation)

- **Expose:** `deep_research` yalnız `ToolRegistry`'ye eklenir → `/mcp` `tools/list`
  (`server/mcp/server.ts:95`) ve `tools/call` (`:152` `ToolRegistry.execute`) **otomatik** kapsar.
  Ayrı MCP server/dispatch yazmak YASAK (O1 "ikinci-dispatch-path yasak" kuralıyla aynı).
- **Tenant görünürlüğü:** `ToolRegistry.list(allowed, tenantId)` mevcut tier/tenant filtresinden geçer;
  `deep_research` tier=`host` → SaaS tenant'larına default kapalı (localOwner işi) — P8 ile tutarlı.
- **Federation:** upstream'lerden gelen aynı-isimli tool `supervisor.getCollisions()` (`:151`) ile
  yüzeye çıkar; RED testi Faz 7'de.
- **İleri iş (O1 kesişimi):** research pipeline'ının upstream MCP search-tool'larını (ör. tavily-mcp)
  backend-zincirine katması O1 `hooks.ts` sonrası ayrı iterasyon — bu planda kapsam-dışı.

---

## 7. Konsolide RED-Test Listesi (yazılış sırası)

1. `tests/research/searxng-client.test.ts` — URL-build/parse pure + searxng→tavily→ddg zinciri (Faz 0)
2. `tests/research/summarize.test.ts` — chunk + özet + URL-atıf + LLM fail-soft (Faz 1)
3. `tests/research/engine.test.ts` — decompose + tur döngüsü + durma + onProgress vokabüleri (Faz 2)
4. `tests/research/rag-ingest.test.ts` — ragIndex spy + toggle + honest-empty retrieval (Faz 3, O0 sonrası)
5. `tests/research/report.test.ts` — `[n]` atıf regex + honest-empty + model routing (Faz 4)
6. `server/__tests__/research-route.test.ts` — 200/403(SAAS_ENFORCE)/404(toggle)/demo + persist v7 (Faz 5)
7. `tests/localowner-guard.test.ts` **genişletme** — `/api/research` prefix assert (Faz 5, V7)
8. `src/components/__tests__/ResearchPanel.test.tsx` + Playwright e2e (Faz 6)
9. `tests/research/deep-research-tool.test.ts` — registry şema + /mcp görünürlük + collision (Faz 7)

---

## 8. Effort Tahmini

| Faz | İş | Boyut | Not |
|---|---|---|---|
| 0 | SearXNG + zincir + Tavily bağlama | **M** | compose + 2 saf fn + seçici; Tavily lib hazır |
| 1 | summarize | **S** | ince katman, ai.ts reuse |
| 2 | planner + engine | **M** | en yüksek mantık yoğunluğu; tümü mock-testli |
| 3 | rag-ingest | **S** | rag.ts reuse; ⛔ O0 |
| 4 | report | **S–M** | prompt + regex denetim |
| 5 | route + guard + persist | **M** | migration v7 + SSE; ⛔ O0 |
| 6 | UI panel | **M–L** | handoff-bundle'a bağlı (Claude Design ön-koşul) |
| 7 | MCP tool | **S** | registry bloğu + 1 test |
| **Toplam** | | **M–L** (≈ documents ile aynı sınıf) | Faz 0–2 O0'a paralel hazırlanabilir |

---

## 9. Kör-Nokta Ledger

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| K1 | Karışıklık | `ecysearcher` = threat-intel; research temeli sanılırsa plan sapar | Yüksek | §1 ilk-sıra ayrım; yalnız proxy-fail-soft deseni emsal |
| K2 | Varsayım | SearXNG JSON format default kapalı olabilir | Yüksek (P1 çöker) | Faz 0 `settings.yml` `formats:[html,json]` + curl smoke |
| K3 | Risk | Public motorlar rate-limit/CAPTCHA; self-host bile bloklanır | Orta | 3-katman zincir (P2); güvenilir motor alt-kümesi |
| K4 | Bilinmeyen | `ai.ts generateText` sentez için format/stream yeterli mi | Orta | Faz 1'de yüzeyi Read; gerekiyorsa ince adaptör (deps-inject) |
| K5 | Risk | Döngü token patlatır / durmaz | Yüksek | sert maxRounds/maxQueries + tekrar-guard + char tavanı (P4) |
| K6 | Bilinmeyen | RAG ingest hacmi: her kaynak mı, yalnız özet mi embed edilir | Orta | Özet embed (küçük+aranabilir); ham metin disk-cache'te zaten var |
| K7 | Risk | Guard-listesi elle — yeni prefix unutulursa SaaS sızıntısı (V7 tekrarı) | Yüksek | P8 CRITICAL + `localowner-guard.test.ts` liste-assert (test unutmayı yakalar) |
| K8 | Risk | Port çakışması (8080 SearXNG default ↔ eCySearcher/AirPlay) | Orta | host 8888 + `SEARXNG_URL` override |
| K9 | Bilinmeyen | O0.registry API'si henüz tasarlanmadı (`02-o0-foundation.md` YOK — KN-P3) | Yüksek | Faz 5 route-kaydı O0 planına bağlanır; O0 önce yazılır |
| K10 | Varsayım | odysseus modül isimleri prompt'tan; repo fetch-doğrulanmadı (KN-P6) | Orta | Parity alt-yetenek listesine göre; imzalar ollamas-native |
| K11 | Bilinmeyen | UI handoff-bundle henüz üretilmedi (panels/research.md yalnız brief) | Orta | Faz 6 bundle-sonrası; sözleşme (`{report,sources,rounds}`) şimdiden kilitli |
| K12 | Risk | SEA/Cloud-Run: SearXNG docker-dışı bağımlılık | Düşük | opsiyonel profil + zincir fallback; engine'e yeni native binding girmez |

---

*Üretici: ODYSSEY planlama üreteci (PLAN.O2). Koda karşı doğrulama (2026-07-11): `server/rag.ts`,*
*`server/tool-registry.ts:536/745/766`, `bin/host-bridge/tools/web_search.mjs` + `lib/{web-extract,tavily}.mjs`,*
*`server/key-doctor.ts:58/193`, `server.ts:278/284-295/650`, `server/ecysearcher-proxy.ts`,*
*`server/ai.ts:35/122/198`, `server/mcp/{server.ts:93-152,supervisor.ts:135-151}`, `server/store/migrations.ts:194`,*
*`docker-compose.yml:83`, `tests/{localowner-guard,web-search-tavily,web-search-tool}.test.ts`, `.env.example`.*
*Kaynak planlar: `00-MASTER.md` (O2 + KN-M2), `01-vision-premise.md §5 Faz1`, `03-claude-design-ui.md §3.2`,*
*`design-execution/panels/research.md`, `05-features/research-searxng.md` (absorbe edilen taslak), `PROGRESS.md`.*
