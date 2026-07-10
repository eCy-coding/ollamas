# ODYSSEY — Feature 05: Research + SearXNG Modülü

> **Hedef:** ollamas'ın tek-atışlık `web_search` aracını, odysseus-kalitesinde bir **çok-adımlı
> deep-research** modülüne evrimleştirmek: self-host **SearXNG** meta-search backend + **fetch →
> summarize → report** pipeline + **research-LLM routing** (local `qwen3:8b` vs cloud) + bir
> **Research UI paneli**. Sıfırdan değil — sağlam bir tek-sorgu temeli VAR; eksik olan *iteratif
> döngü + yapılandırılmış rapor + izole search backend*.
> **Referans:** odysseus `research` modülü — `deep_research.py` (40KB, çok-adımlı web araştırma +
> rapor) + `research_handler` (fetch+summarize pipeline) + self-host **SearXNG** (docker :8080) +
> `topic_analyzer` (iteratif sorgu) + ayrı `RESEARCH_LLM_ENDPOINT`.
> **Dil:** açıklama TR, kod/komut/dosya-yolu EN.

---

## 1. Mevcut Durum (ollamas — koda karşı doğrulanmış)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **gerçekten okunarak** teyit edildi
(Read/Grep). "VAR" = kodda mevcut, "YOK" = eksik.

> **KRİTİK AYRIM (kör-noktayı ilk sıraya koyuyoruz):** `scripts/ecysearcher-*` lane'i bir
> **threat-intel platformudur** (domain/IP/CVE göstergesi arama; ayrı Flask+Postgres+Redis docker
> stack, `ECYSEARCHER_DIR`), odysseus'un **web-research** modülü DEĞİL. İkisi karıştırılmamalı. Bu
> planın araştırma temeli `ecysearcher` değil, aşağıdaki **`web_search`** aracıdır.

### 1.1 VAR olan sağlam temel (yeniden kullanılacak, sıfırdan yazılmayacak)

| Yetenek | Dosya / Konum | Not |
|---|---|---|
| Agent `web_search` tool şeması | `server/tool-registry.ts:536` | `query` / `url` / `render` / `deep` / `top`; deep=default |
| CLI arama motoru | `bin/host-bridge/tools/web_search.mjs` (131 LOC) | `search` / `deep` / `fetch` modları; stdout JSON |
| Arama backend | `web_search.mjs:43` `ddgSearch()` | **DuckDuckGo HTML-scrape** (anahtarsız, bloklanabilir) |
| Deep pipeline (fetch+extract) | `web_search.mjs:92` `runDeep()` | top-N kaynağı `mapLimit(conc=4)` ile paralel fetch |
| İçerik çıkarımı (pure, testli) | `bin/host-bridge/tools/lib/web-extract.mjs` | `extractReadable()` jsdom main-content; `maxText=6000` |
| Snippet-yeterlilik heuristiği | `web-extract.mjs:137` `snippetSufficient()` | uzun snippet varsa fetch'i atlar |
| Render tetiği | `web-extract.mjs:129` `needsRender()` + `web_search.mjs:50` `renderHtml()` | JS-shell tespiti → puppeteer render fallback |
| Disk cache (content-addressed) | `web_search.mjs:24` `cacheGet/Set` | `~/.cache/ollamas-web`, 24h TTL |
| Deep-result birleştirici | `web-extract.mjs:146` `buildDeepResult()` | snippet + tam metin füzyonu |
| Host-bridge çağrı yolu | `tool-registry.ts:544` `deps.execOnHost(...web_search.mjs...)` | agent → host köprüsü |
| Tool birim testleri | `tests/web-search-tool.test.ts` | parse/extract/deep golden |
| Model routing altyapısı | `server/ai.ts:35` `MAC_MODEL_CHAMPION="qwen3:8b"` + `:64` coder-tuned seçici | local şampiyon + `AiProvider` union |
| RSS/feed fetch+cache deseni | `server/threatfeed.ts:156` `fetchFeed()` + `:178` `getFeedItems()` | 15dk TTL, fail-soft stale-cache — pipeline için emsal |
| Docker-compose (ana stack) | `docker-compose.yml` | `mission-control` servisi + `--profile postgres`; SearXNG buraya profil olarak eklenir |
| Canlı besleme UI kalıbı | `src/components/ECySearcherPanel.tsx:188` "Canlı Tehdit Akışı" | Research paneli UI deseni için emsal (liste/kart/refresh) |

### 1.2 YOK olan (research modülünün asıl eksiği — bu planın konusu)

- **SearXNG backend YOK.** Grep: `SEARXNG` / `SEARX_` / `SEARCH_BACKEND` env'i kodun HİÇBİR yerinde
  yok. Tek arama yolu DuckDuckGo HTML-scrape (`web_search.mjs:44`) — bloklanabilir, yapısal-değil,
  fallback'siz. `RESEARCH_web-tool.md` (canlı-ölçümlü araştırma) tam da bunu SearXNG'e taşımayı
  öneriyor ama **kodda uygulanmamış**.
- **Çok-adımlı research döngüsü YOK.** `runDeep()` **tek** sorgu → top-N fetch → düz JSON döndürür.
  odysseus `deep_research.py` gibi *plan → alt-sorgular üret → tur-tur topla → boşluk analiz et →
  yeni sorgu → sentezle* iteratif bir orkestrasyon YOK. İterasyon şu an tümüyle ReAct-agent'ın
  el-yordamına bağlı (`orchestration/AUTONOMOUS_RESEARCH.md` bunu belgeliyor: agent 2-3 `web_search`
  çağrısı yapıyor ama yapılandırılmış plan/rapor yapısı yok).
- **Rapor sentezi YOK.** `topic_analyzer` karşılığı (alt-başlıklara ayır, kaynak-atıflı bölümler,
  yönetici-özeti) yok. Çıktı ham `results[]` — atıflı Markdown/rapor üretimi yok.
- **Ayrı research-LLM routing YOK.** odysseus'un `RESEARCH_LLM_ENDPOINT`'i gibi araştırma-özel model
  seçimi yok. `web_search` tamamen deterministik (LLM'siz) çalışır; özetleme/sentez adımı için model
  seçen bir katman (`local qwen3:8b` ucuz-yerel vs `cloud gpt-oss:120b` derin-sentez) YOK.
- **Research UI paneli YOK.** Tehdit-Intel (`ECySearcherPanel`) paneli var ama "araştırma sorusu →
  ilerleyen adımlar → atıflı rapor" gösteren bir Research sekmesi YOK. UI **Claude Design**'da
  tasarlanıp buraya implemente edilecek (frontend-only araç → Claude Code implementasyonu).
- **Research server route/persist YOK.** `server.ts`'te `/api/research*` yok; oturum/geçmiş
  saklama yok. Şu an her şey stateless host-tool çağrısı.

**Özet:** ollamas'ta **tek-sorgu deep-fetch** motoru sağlam (paralel fetch + cache + render +
readability). Eksik olan **(a)** izole/güvenilir search backend (SearXNG), **(b)** iteratif
research-orkestratörü, **(c)** LLM-destekli atıflı rapor sentezi + research-model routing, **(d)**
Research UI paneli + server route.

---

## 2. Odysseus Referansı (parity hedefi)

odysseus `research` modülünün karşılığını üreteceğimiz alt-yetenekler:

1. **SearXNG (self-hosted meta-search, docker :8080)**: 276 motoru tek JSON API'de birleştiren,
   izli-takipsiz meta-search. `GET /search?q=…&format=json`. DDG-scrape'in yerini alan **birincil**
   backend; DDG **fallback** olur.
2. **`research_handler` (fetch+summarize pipeline)**: arama → kaynak seç → tam-metin çıkar → **özetle**
   → tur biriktir. ollamas'ta fetch+extract VAR; eksik halka **summarize** (LLM adımı).
3. **`deep_research.py` (çok-adımlı orkestrasyon)**: soru → alt-sorgu planı → N tur (her tur: ara,
   getir, özetle, boşluk-tespit) → durma kriteri → **atıflı rapor** sentezi.
4. **`topic_analyzer` (iteratif sorgu üretimi)**: mevcut bulgulardan bir sonraki sorgu setini üretir
   (kapsam boşluğunu kapatır). LLM-destekli sorgu genişletme.
5. **Ayrı `RESEARCH_LLM_ENDPOINT`**: özet/sentez için araştırmaya-özel model. ollamas eşleniği:
   `RESEARCH_MODEL` env + `server/ai.ts` router (local `qwen3:8b` varsayılan; `deep` seviyede cloud).

**Python → Node/ollamas eşleme tablosu:**

| İşlev | odysseus (Py) | ollamas (Node/mevcut) | Karar |
|---|---|---|---|
| Meta-search | SearXNG (docker) | **SearXNG** (aynı imaj, compose `--profile research`) | Birebir; DDG fallback korunur |
| HTTP fetch + extract | `research_handler` + readability | `web_search.mjs` + `web-extract.mjs` (VAR) | **Reuse** — sıfırdan yazma |
| Özetleme | `RESEARCH_LLM_ENDPOINT` | `server/ai.ts` + `RESEARCH_MODEL` | Yeni ince katman `server/research/summarize.ts` |
| İteratif sorgu | `topic_analyzer` | Yeni `server/research/planner.ts` | LLM sorgu-genişletme |
| Orkestrasyon | `deep_research.py` | Yeni `server/research/engine.ts` | Tur döngüsü + durma kriteri |
| Rapor | rapor üretici | Yeni `server/research/report.ts` | Atıflı Markdown |
| Cache/paralel | (kütüphane) | `mapLimit(4)` + disk cache (VAR) | **Reuse** |

> **Mimari karar:** search backend **docker-izole** (SearXNG), ama research-orkestratörü **ollamas
> server-side TypeScript** (Python değil) — `server/research/*`. Neden: ollamas Node/SEA (single
> executable) hedefliyor; `web-extract`/`ai`/`threatfeed` altyapısı zaten TS ve reuse edilebilir.
> SearXNG'i ana stack'e ayrı bir compose **profile** olarak ekliyoruz (`postgres` profili gibi) —
> `docker compose --profile research up -d`. Böylece opsiyonel, ana :3000'i etkilemez.

---

## 3. Hedef Plan (TDD-adımlı — her adım: önce test, sonra implementasyon)

> **Disiplin:** her Faz'da (1) failing test yaz → (2) minimal implementasyon → (3) yeşil → (4)
> refactor. Runner: `vitest` (`npm run test`, VAR). E2E: `@playwright/test` (VAR).
> **Kapı:** her Faz sonu `tsc --noEmit` + `npm run test` temiz.

### FAZ 0 — SearXNG servisi + backend soyutlaması (kapı: compose up + JSON döner)

**Test önce** — `tests/research/searxng-client.test.ts`:
- `buildSearxUrl(base, {q, categories, format})` → `…/search?q=…&format=json&categories=general` (pure).
- `parseSearxResults(json, max)` → normalize `{title, url, snippet}[]` (fixture JSON'dan).
- `searchBackend` seçici: `SEARCH_BACKEND=searxng` → SearXNG; `=ddg` veya SearXNG erişilemez →
  DDG fallback (mock `fetch` ile; SearXNG 5xx → DDG çağrılır).

**Implementasyon:**
- `docker-compose.yml`'e **`searxng`** servisi, `profiles: ["research"]` ile (ana stack'i etkilemez).
  İmaj `searxng/searxng`, host portu **`127.0.0.1:8888:8080`** (AirPlay/ecypro-safe; 8080=eCySearcher
  nginx'iyle çakışmasın), `settings.yml` volume + `search.formats: [json]` etkin.
- `SEARXNG_URL` (default `http://localhost:8888`), `SEARCH_BACKEND` (`searxng`|`ddg`, default `searxng`),
  `.env.example`'a ekle.
- `bin/host-bridge/tools/lib/web-extract.mjs`'e **saf** `buildSearxUrl` + `parseSearxResults` ekle
  (testli, ağsız). `web_search.mjs`'e `searxSearch(q)` (thin IO) + `ddgSearch`'ü koru; `runSearch`/
  `runDeep` başında backend seç: SearXNG dene → başarısız/kapalıysa DDG'ye düş (fail-soft, asla throw).
- **Reuse:** cache/`mapLimit`/`fetchReadable` aynen kullanılır; yalnız sonuç-**kaynağı** değişir.

### FAZ 1 — Summarize katmanı (fetch → özet halkası)

**Test önce** — `tests/research/summarize.test.ts`:
- `chunkForSummary(text, maxChars)` → `maxText` sınırını aşan metni parçalar (pure).
- `summarizeSource(source, deps)`: `deps.chat` mock → özet + **kaynak URL atıfı** korunur.
- LLM erişilemez → özet yerine ham snippet'e **fail-soft** düşer (araştırma kesilmez).

**Implementasyon** — yeni `server/research/summarize.ts`:
- `summarizeSource({title,url,text}, {model, chat})` → `{url, title, summary, keyPoints[]}`.
- Model: `RESEARCH_MODEL` env → yoksa `server/ai.ts` router (`MAC_MODEL_CHAMPION` local qwen3:8b).
- **Reuse:** `server/ai.ts` chat çağrısı; yeni provider yazma. Deterministik, düşük-sıcaklık prompt.
- Config: `RESEARCH_MODEL`, `RESEARCH_MAX_SOURCE_CHARS` (default 6000, `web-extract` `maxText` ile hizalı).

### FAZ 2 — İteratif planner + engine (çok-adımlı orkestrasyon)

**Test önce** — `tests/research/engine.test.ts`:
- `planInitialQueries(question, deps)`: `deps.chat` mock → 2-4 alt-sorgu (pure sınır: min 1, max
  `RESEARCH_MAX_QUERIES`).
- `nextQueries(question, gatheredSummaries, deps)`: boşluk-tespit → yeni sorgu **veya** boş (durma).
- `runResearch(question, deps)` (tam döngü, tümü mock): `maxRounds` turda durur; her tur
  ara→getir→özetle; `gathered` birikir; `nextQueries` boş dönünce **erken durur**; sonuç
  `{question, rounds[], sources[], report}`.
- Durma kriterleri: `maxRounds` (default 3), sorgu-tekrarı (aynı sorguyu iki kez üretme), boş `nextQueries`.

**Implementasyon:**
- `server/research/planner.ts`: `planInitialQueries` + `nextQueries` (LLM sorgu genişletme;
  `topic_analyzer` karşılığı). Deps-injected (test için pure).
- `server/research/engine.ts`: tur döngüsü. Her tur: `searchBackend(q)` (Faz 0) → seç → `fetchReadable`
  (reuse) → `summarizeSource` (Faz 1) → `gathered.push`. `nextQueries` ile devam/dur.
- Config: `RESEARCH_MAX_ROUNDS` (3), `RESEARCH_MAX_QUERIES` (4), `RESEARCH_TOP_PER_QUERY` (3),
  `RESEARCH_DEEP_MODEL` (cloud, opsiyonel — `deep` istekte sentez için).
- **Reuse:** `mapLimit` paralel fetch; disk cache tur-tekrarında ~0ms.

### FAZ 3 — Atıflı rapor sentezi (topic_analyzer + report)

**Test önce** — `tests/research/report.test.ts`:
- `buildReport(question, sources, deps)`: `deps.chat` mock → Markdown; her iddia `[n]` atıflı,
  sonda numaralı **kaynak listesi** (url). Atıfsız cümle yok (regex denetimi).
- Kaynak yoksa → "yeterli kaynak bulunamadı" honest boş-durum (halüsinasyon yasağı).
- `RESEARCH_DEEP_MODEL` set + `deep=true` → cloud model; değilse local (routing testi, mock).

**Implementasyon** — `server/research/report.ts`:
- `buildReport(question, gatheredSummaries, {model, chat})` → `{markdown, citations[]}`.
- Prompt: yönetici-özeti + tematik bölümler + **her bölüm kaynak-atıflı** + kaynak-listesi.
- Model routing: `deep` → `RESEARCH_DEEP_MODEL` (cloud gpt-oss:120b) yoksa local `qwen3:8b`.
- **Anti-halüsinasyon:** yalnız `gathered` özetlerinden yaz; atıf zorunlu; boşsa üretme.

### FAZ 4 — Server route + persist (entegrasyon)

**Test önce** — `server/__tests__/research-route.test.ts` (supertest/inject):
- `POST /api/research { question, deep? }` → 200 + `{report, sources, rounds}` (engine mock).
- SSE/stream (opsiyonel): `GET /api/research/stream` tur-tur ilerleme yayar (odysseus-tarzı canlı).
- `permissions.webSearch` (veya mevcut ilgili kapı) kapalı → 403.
- demo mode → deterministik fixture rapor (ağsız).
- SearXNG kapalı + DDG fallback → yine 200 (backend fail-soft).

**Implementasyon** — `server.ts` (mevcut route blokları deseni):
- `app.post("/api/research", localOwnerGuard, ...)` → `runResearch` çağır → JSON.
- (Opsiyonel) SSE ile canlı ilerleme (`threatfeed` fetch deseni + res.write chunk).
- Oturum persist: `db` (node:sqlite, VAR) `research_runs` — geçmiş görüntülensin. `db.logSecurity`/
  telemetry izi (`server/telemetry.ts` deseni).
- OpenAPI'ye ekle (`server/openapi.ts` deseni).

### FAZ 5 — Research UI paneli + agent tool (Claude Design → implementasyon)

**Test önce:**
- `src/components/__tests__/ResearchPanel.test.tsx` (`@testing-library/react`, VAR): soru gir →
  "Araştır" → adım-adım ilerleme render → atıflı rapor + tıklanır kaynak listesi. Boş/hata durumu.
- `deep_research` agent tool (`tool-registry.ts` deseni): question → `runResearch` → rapor döner.
  Tool schema testi.
- E2E (Playwright): bir happy-path (mock backend) — soru → rapor + kaynaklar görünür.

**Implementasyon:**
- `src/components/ResearchPanel.tsx`: **UI Claude Design'da tasarlanır**, buraya implemente.
  `ECySearcherPanel.tsx:188` "Canlı Akış" liste/kart/refresh desenini emsal al; sorgu input +
  tur-tur ilerleme (SSE veya poll) + Markdown rapor (`marked`+`dompurify`, documents.md Faz 4 ile
  aynı sanitize kararı) + numaralı kaynak listesi (dış-link).
- `src/App`/tab kaydı + `src/locales/en.ts`+`tr.ts` string (lingui deseni, VAR).
- `server/tool-registry.ts`'e `deep_research` tool ekle (mevcut `web_search` bloğu, satır 536 deseni)
  → ReAct agent "derin araştırma yap" diyebilsin (tek `web_search`'ten farklı: iteratif+rapor).
- **Reuse:** `src/lib/apiClient.ts` (soft/error deseni), mevcut notify.

---

## 4. Parity Kabul Kriteri (odysseus-parity — "bitti" tanımı)

Aşağıdakilerin **hepsi** yeşil olduğunda research modülü odysseus-parity sayılır:

- [ ] **P1** SearXNG servisi `docker compose --profile research up -d` ile ayağa kalkar; `GET
      /search?...&format=json` sonuç döner; ana :3000 etkilenmez.
- [ ] **P2** `SEARCH_BACKEND=searxng` birincil; SearXNG kapalı/5xx → **DDG fallback** (araştırma
      kesilmez). Backend-seçim testleri yeşil.
- [ ] **P3** Summarize halkası: her kaynak LLM ile özetlenir, **URL atıfı korunur**; LLM yoksa
      snippet'e fail-soft düşer.
- [ ] **P4** Çok-adımlı engine: soru → alt-sorgu planı → ≤`maxRounds` tur → boşluk-temelli yeni
      sorgu → durma kriteri. Engine testleri yeşil (tümü deps-mock).
- [ ] **P5** Atıflı rapor: `[n]` atıflı Markdown + numaralı kaynak listesi; atıfsız iddia yok;
      kaynak yoksa honest boş-durum (halüsinasyon üretmez).
- [ ] **P6** Research-LLM routing: `RESEARCH_MODEL` (local qwen3:8b varsayılan) + `deep` istekte
      `RESEARCH_DEEP_MODEL` (cloud). Routing testi yeşil.
- [ ] **P7** `POST /api/research` çalışır (rapor+kaynak+tur); permission-guard + demo-mode fixture +
      persist (`research_runs`). Route testleri yeşil.
- [ ] **P8** Research UI paneli: soru → adım ilerleme → atıflı rapor + tıklanır kaynaklar; sanitize
      (XSS yok). UI testleri yeşil. (Tasarım Claude Design'dan geldi.)
- [ ] **P9** Agent `deep_research` tool ReAct döngüsünde iteratif araştırma + rapor döndürüyor.
- [ ] **P10** Config-driven: `SEARXNG_URL`/`SEARCH_BACKEND`/`RESEARCH_MODEL`/`RESEARCH_MAX_ROUNDS`
      env toggle'ları etkili (odysseus config-driven ruhu).
- [ ] **P11** Regresyon yok: mevcut `web_search` (tek-sorgu) tool + `tests/web-search-tool.test.ts`
      hâlâ yeşil; ana `docker-compose up` (research profili olmadan) değişmedi.
- [ ] **P12** Build kapısı: `tsc --noEmit` + `npm run build` (vite+esbuild+SEA) temiz; yeni native
      binding girmedi.

**Odysseus'ta olup bu planda BİLEREK dışarıda bırakılan** (parity-dışı, ayrı feature):
academic/PDF-kaynak özel pipeline (documents modülüyle kesişir), gerçek-zamanlı işbirlikçi araştırma,
kalıcı vektör-indeks (bu ollamas'ta `rag.ts`+`sqlite-vec` kapsamı — ayrı iş), Tor üzerinden anonim
arama (SearXNG destekler ama kapsam-dışı), ödemeli arama API'leri (Brave/Serp — `RESEARCH_web-tool.md`
öneriyor ama SearXNG+DDG anahtarsız temeli önce; ödemeli backend opsiyonel Faz).

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| K1 | **Karışıklık** | `ecysearcher` lane'i araştırma sanılabilir; aslında threat-intel platformu (ayrı Flask stack) | Yüksek — yanlış temel seçilirse tüm plan sapar | §1 başında ilk-sıra ayrım notu; research temeli = `web_search.mjs`, `ecysearcher` DEĞİL |
| K2 | Varsayım | `searxng/searxng` imajı JSON format'ı `settings.yml`'de açık olmalı (default kapalı olabilir) | Yüksek — kapalıysa P1 çöker | Faz 0'da `search.formats: [html, json]` volume-mount; smoke: `curl …&format=json` |
| K3 | Risk | SearXNG çoğu public motoru rate-limit/CAPTCHA'ya takılabilir; self-host bile bot-blok yer | Orta | DDG fallback (P2); `settings.yml`'de güvenilir motor alt-kümesi; per-host timeout |
| K4 | Bilinmeyen | `server/ai.ts` chat imzası summarize/report için doğrudan çağrılabilir mi (streaming/format) | Orta | Faz 1'de `ai.ts` chat yüzeyini oku; gerekiyorsa ince `chat()` adaptörü; deps-inject ile test |
| K5 | Varsayım | `qwen3:8b` local özet/sentez kalitesi rapor için yeterli (cloud olmadan) | Orta | `AUTONOMOUS_RESEARCH.md` kanıtı: qwen3:8b uçtan-uca research'ü tamamladı; `deep` için cloud opsiyonu (P6) |
| K6 | Risk | Çok-adımlı döngü sonsuza gidebilir / token patlatır (LLM boş-durmuyor) | Yüksek | Sert `maxRounds`+`maxQueries`+sorgu-tekrar guard (Faz 2); toplam char/kaynak tavanı |
| K7 | Bilinmeyen | UI paneli **Claude Design**'da tasarlanacak — tasarım henüz yok; SSE mi poll mi ilerleme | Orta | Faz 5 MVP poll ile başlar; tasarım gelince SSE'ye genişlet; `ECySearcherPanel` deseni köprü |
| K8 | Risk | Port çakışması: SearXNG default 8080 = eCySearcher nginx (8088) + başka container'lar | Orta | Host port **8888** (AirPlay/ecypro-safe), `SEARXNG_URL` overridable (lane port-remap deseni) |
| K9 | Bilinmeyen | `permissions` modelinde araştırma için ayrı kapı mı (`webSearch`) yoksa mevcut mu | Düşük | Faz 4'te mevcut web-tool permission'ına bağla; yeni kapı gerekiyorsa `db.data.permissions`'a ekle |
| K10 | Varsayım | odysseus modül isimleri (`deep_research.py`, `topic_analyzer`, `RESEARCH_LLM_ENDPOINT`) prompt'tan; repo doğrulanmadı | Orta | Parity'yi odysseus *davranışına* değil, listelenen alt-yeteneklere göre tanımladık; imzalar ollamas'a özgü |
| K11 | Risk | `RESEARCH_web-tool.md` p-limit/cache/readability iyileştirmeleri **belge**; kodda uygulanmamış olabilir (`mapLimit`+cache VAR ama `@mozilla/readability` YOK, jsdom var) | Düşük | Extraction reuse (jsdom yeterli, `AUTONOMOUS_RESEARCH.md` kanıtı); readability upgrade opsiyonel ayrı iş |
| K12 | Risk | SEA/Cloud-Run bundling: SearXNG docker-dışı; ama research server-side TS `puppeteer` (render) taşımalı mı | Düşük | Render zaten mevcut `web_search` yolunda opsiyonel; research engine fetch'i reuse eder, yeni binding yok |

---

*Üretici: ODYSSEY planlama üreteci. Kaynak kod okundu: `server/tool-registry.ts` (web_search),*
*`bin/host-bridge/tools/web_search.mjs`, `bin/host-bridge/tools/lib/web-extract.mjs` + `bridge-client.mjs`,*
*`server/ai.ts`, `server/threatfeed.ts`, `server/ecysearcher*.ts` + `scripts/ecysearcher-*.mjs` (ayrım için),*
*`src/components/ECySearcherPanel.tsx`, `docker-compose.yml`, `package.json`,*
*`orchestration/RESEARCH_web-tool.md` + `AUTONOMOUS_RESEARCH.md`. Tarih: 2026-07-10.*
