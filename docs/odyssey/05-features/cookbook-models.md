# ODYSSEY — Feature O7: Local-Models Cookbook (donanım-farkında öneri)

> **Hedef:** ollamas'ı odysseus `cookbook/local-models` modülü kalitesine taşımak: donanımı
> algılayan (RAM/chip/core), o donanıma **en-verimli-doğru** yerel modeli öneren, `qwen3:8b`'yi
> `$0-local` primary olarak kuran (pull-progress ile), ve seçimi **gelir hattına** (Şef-2 revenue →
> `cookbook-monetize`) bağlayan bir "cookbook" katmanı.
> **Referans:** odysseus `cookbook/local-models` = `model_discovery.py` (Ollama/llama.cpp auto-detect)
> + Cookbook (donanım-farkında model önerisi + serving guidance) + `LLM_HOST` + `RESEARCH_LLM_ENDPOINT`
> (dual-model). Qwen3:8b primary, $0-local.
> **Kritik tespit:** ollamas'ta donanım-farkında seçim **MOTORU ZATEN VAR** (`optimize.ts`) ama
> **CLI'ye hapsedilmiş** — server API'sine ve cockpit UI'ına köprülü değil. Bu plan sıfırdan motor
> yazmaz; mevcut `optimize`/`bench`/`council`'ı **bridge + UI + monetize** ile genişletir.
> **Dil:** açıklama TR, kod/komut/dosya-yolu EN.

---

## 1. Mevcut Durum (ollamas — koda karşı doğrulanmış)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **gerçekten okunarak** teyit edildi
(Read/Grep). "VAR" = kodda mevcut, "YOK" = eksik. Sıfırdan sanılan hiçbir şey yok.

### 1.1 VAR olan sağlam temel (yeniden kullanılacak, sıfırdan yazılmayacak)

| Yetenek | Dosya:satır | Ne yapar |
|---|---|---|
| **Donanım-farkında seçim motoru** | `orchestration/bin/lib/optimize.ts:52` `scoreModel` / `:87` `selectBest` | correctness-gate (0.7) → tok/s normalize → VRAM-fit weighted-sum; deterministik, ML-yok |
| Donanım algılama (parse) | `optimize.ts:40` `parseSysctl(memBytes, physCpu, brand)` | sysctl string → `SysInfo{arch,ramGb,cores,chip}` |
| VRAM tahmini + fit | `optimize.ts:25` `modelVramGb` / `:33` `vramFit` | model→GB (bilinen tablo + param-tahmin); RAM×0.8 fit |
| Optimal runtime config | `optimize.ts:95` `optimalConfig(ramGb,cores,model)` | RAM-tier → `num_ctx/num_gpu/num_thread/keep_alive/quant` (Apple-Silicon num_gpu=999) |
| Portable working-prompt | `optimize.ts:111` `buildWorkingPrompt` | XML-tag + Vanderbilt 5-parça self-optimizing prompt |
| Bench agregasyon | `orchestration/bin/lib/bench.ts:95` `aggregate` / `:121` `rankEfficient` | median/p95/MAD (mean değil); invalid-sample (tok/s≤0) hariç; regresyon-tespit `:132` |
| Staleness kapısı | `bench.ts:149` `isStale(ts,maxDays=2)` | bayat bench → re-bench tetikler |
| CLI selection entegrasyonu | `orchestration/bin/benchprompt.ts:108` `selectBest(macAggs, sys.ramGb)` | bench.json tüket → seçim → `MODEL_SELECTION.json` yaz |
| CLI align (config-sweep) | `orchestration/bin/align.ts:164` `selectBestAligned` + `optimalConfig` | Modelfile config-varyant sweep, en-iyi hizalı model |
| Server champion sabiti | `server/ai.ts:35` `MAC_MODEL_CHAMPION="qwen3:8b"` / `:80` seçim | tag varsa champion, yoksa ilk tag |
| Cockpit model-ranking (server) | `server/cockpit-models.ts:11` `rankMacModels(tags, ram, loaded, champion)` | tüm local model → size-fit (RAM×0.7) + champion işareti |
| Cockpit models endpoint | `server.ts:800` `rankMacModels(...)` + `championTokPerSec` | `/api/cockpit` içinde model listesi |
| MODEL_SELECTION okuma | `server.ts:156` + `:1393` `MODEL_SELECTION.json` | CLI'nin yazdığı seçimi server okur (combo champion) |
| Cockpit UI paneli | `src/components/cockpit/ModelsPanel.tsx` | local model kartları, fit/loaded/recommended, RAM göstergesi |
| Council calibrate UI | `src/components/cockpit/CouncilPanel.tsx` | SSE `/api/council/calibrate` → per-model doğruluk + tok/s + policy |
| Council fleet motoru | `orchestration/bin/council.ts` + `lib/council-roster.ts` | yetenek-eşlemeli seat roster, lane-analiz, oracle-denetim |
| Provider yetenek modeli | `server/provider-catalog.ts:259` `capabilitiesFor` / `:264` `capabilityReport` | provider → `[code,fast,tools,long-ctx,vision,embed,...]` |
| Gelir hattı | `server/revenue.ts:38` `runTestgen` (qwen3:8b) / `:69` `runAudit` / `:149` `generateStorefront` | $0 testgen (auto-verify gate) + audit + storefront; PR/Issue teslimi |
| Embedding katalog | `server/embed-catalog.ts` | free-tier embedding provider (PINNED, rotasyon-yasak) |
| optimize testleri | `orchestration/tests/optimize.test.ts` | `parseSysctl/modelVramGb/scoreModel/selectBest/optimalConfig/buildWorkingPrompt` kapsanmış |

### 1.2 YOK olan (cookbook modülünün asıl eksiği — bu planın konusu)

- **`server/cookbook.ts` YOK.** `01-vision-premise.md §5 Faz6`'nın çekirdek GREEN dosyası hiç yazılmamış.
  `grep -rn "cookbook" server/` → 0 eşleşme (yalnız docs). Donanım-farkında öneri motoru CLI'de var
  ama **server tarafında bir cookbook servisi / endpoint yok**.
- **Motor ↔ UI köprüsü YOK.** `optimize.ts` (gerçek hw-aware seçim: score/reason/config) **CLI-only**.
  Cockpit UI (`ModelsPanel.tsx`) yalnızca `rankMacModels`'in **basit size-fit** çıktısını gösteriyor —
  **skor yok, gerekçe yok, tok/s-tabanlı öneri yok, optimal config yok**. Kullanıcı "neden bu model?"
  sorusunun cevabını UI'da göremiyor. `optimize`'ın `Scored{score,reason,config}` zenginliği ekrana hiç ulaşmıyor.
- **Model discovery (llama.cpp) YOK.** odysseus `model_discovery.py` hem Ollama **hem llama.cpp**
  algılar. ollamas yalnız Ollama (`/api/tags`, `ollama list`) tarar; `.gguf` / llama.cpp yerel modelleri
  keşfedilmiyor.
- **`qwen3:8b` primary-pull / pull-progress YOK.** Champion `qwen3:8b` **varsayılıyor** (`ai.ts:35`) ama
  yoksa **kullanıcıya kur-önerisi + canlı pull-progress** akışı yok. odysseus cookbook "primary model
  kurulu değilse rehberli kurulum" verir; ollamas'ta model eksikse UI sessizce champion'ı düşürür.
- **Serving guidance / dual-model config UI YOK.** odysseus `LLM_HOST` + `RESEARCH_LLM_ENDPOINT`
  (ayrı primary + research endpoint) **UI'dan yapılandırılamıyor**. ollamas'ta `OLLAMA_HOST` env var ama
  cockpit'te "primary endpoint / research endpoint" ayrı-ayrı gösteren/set-eden bir panel yok.
- **`/api/cookbook/*` endpoint ailesi YOK.** "bu donanıma öner", "config öner", "working-prompt üret",
  "primary kur" için HTTP yüzeyi yok. `optimize` çıktısı yalnız dosyaya (`MODEL_SELECTION.json`) yazılıyor.
- **Cookbook ↔ gelir bağı YOK.** `revenue.ts` `qwen3:8b`'yi **hardcode** kullanıyor (`:42`). Cookbook'un
  "bu donanımda en-verimli-doğru model" seçimi ile revenue op'larının model seçimi **bağlı değil** —
  donanım güçlüyse revenue daha iyi bir modelle koşabilir, cookbook bunu bilmiyor. Ayrıca "bu model saatte
  ~N doğru-testgen üretir → gelir potansiyeli" gibi bir **monetize-projeksiyon** yok.

**Özet:** ollamas'ta odysseus-üstü bir **seçim motoru** (`optimize.ts`) ve **fleet council** zaten var;
eksik olan (a) motoru **server servisi + API + UI**'a köprüleyen `cookbook` katmanı, (b) **llama.cpp
discovery** + **qwen3:8b guided-pull**, (c) **dual-model serving UI**, ve (d) seçim→**revenue** bağı.

---

## 2. Odysseus Referansı (parity hedefi)

odysseus `cookbook/local-models` modülünün ollamas'ta karşılığını üreteceğimiz alt-yetenekler:

1. **`model_discovery.py` → discovery servisi:** Ollama **+ llama.cpp** yerel modelleri auto-detect;
   isim, boyut, kaynak (ollama/gguf), yüklü-mü.
2. **Cookbook (hardware-aware recommendation):** donanım (RAM/chip/core) → o donanıma uygun model +
   **serving guidance** (config). ollamas'ta bu **zaten `optimize.ts`** — sıfırdan yazılmaz, servise sarılır.
3. **`LLM_HOST` + `RESEARCH_LLM_ENDPOINT` (dual-model):** primary inference + ayrı research endpoint.
   ollamas'ta `providers.ts` `ProviderRouter` + `OLLAMA_HOST` var; eksik olan **UI'dan iki endpoint set/göster**.
4. **Qwen3:8b primary, $0-local:** champion olarak `qwen3:8b`; kurulu değilse **guided pull**.

**odysseus → ollamas eşleme tablosu:**

| odysseus (Python) | ollamas karşılığı (VAR/YENİ) | Neden |
|---|---|---|
| `model_discovery.py` Ollama detect | `council.ts:57 liveModels` + `cockpit-models.ts rankMacModels` (**VAR**) → `cookbook.ts`'e sar | ikisi de `/api/tags`+`ollama list` okuyor; DRY |
| `model_discovery.py` llama.cpp detect | `cookbook.ts scanGgufModels()` (**YENİ, ince**) | `~/.cache`/`models/*.gguf` tara; ollamas yalnız Ollama tarıyor |
| Cookbook hw-aware recommend | `optimize.ts selectBest/optimalConfig` (**VAR**) → `cookbook.ts recommend()` sarar | motor hazır; server+UI'a taşınacak |
| Cookbook serving guidance | `optimize.ts optimalConfig` + `buildWorkingPrompt` (**VAR**) | config zaten üretiliyor |
| `LLM_HOST` | `OLLAMA_HOST` env + `ai.ts` (**VAR**) → cookbook UI'da göster/set | isim farklı, kavram aynı |
| `RESEARCH_LLM_ENDPOINT` | **YENİ** `RESEARCH_LLM_ENDPOINT` env + `ProviderRouter` research-route | dual-model ayrımı yok |
| Qwen3:8b primary | `MAC_MODEL_CHAMPION="qwen3:8b"` (`ai.ts:35`, **VAR**) + guided-pull (**YENİ**) | varsayılı; kurulum akışı yok |

> **Kanonik sınır:** `optimize.ts` **taşınmaz/kopyalanmaz** — server `cookbook.ts` onu `import` eder
> (orchestration lib server'dan import edilebilir; `benchprompt.ts` deseni). Yeni skorlayıcı YAZILMAZ.

---

## 3. Hedef Plan (TDD-adımlı — mevcut motoru genişletme)

Her faz **RED (test önce) → GREEN (minimal implement) → REFACTOR** sırasında. Faz'lar birbirine
bağımlı-sıra: O7.1 (discovery+recommend servisi) diğerlerinin zemini.

### O7.1 — `server/cookbook.ts` servisi (motoru server'a köprüle) — ÇEKİRDEK

- **RED:** `server/__tests__/cookbook.test.ts`
  - `detectHardware()` → sysctl mock → `SysInfo` (yeniden-kullanım: `optimize.parseSysctl`).
  - `recommend(models, sys)` → `optimize.selectBest` + `optimalConfig` sarar → `{model, score, reason,
    config, fits, alternatives[]}`; correctness-gate altı model önerilmez.
  - `recommend` bench-verisi yoksa **graceful**: champion (`qwen3:8b`) fallback + "bench yok, --refresh öner".
- **GREEN:** `server/cookbook.ts` — `optimize.ts` + `bench.ts` **import** (yeni motor YOK); `detectHardware`
  (canlı sysctl), `discoverModels` (`/api/tags` + `ollama list` reuse), `recommend` (motor sarmalı).
- **REFACTOR:** `cockpit-models.ts rankMacModels` ile örtüşen size-fit mantığını `cookbook`'a delege et
  (tek doğruluk-kaynağı); `rankMacModels` cookbook'un `fits` alanını çağırsın.
- **Kabul:** test GREEN; `recommend` çıktısı `reason` + `config` içerir (CLI'deki zenginlik server'da).

### O7.2 — `/api/cookbook/*` endpoint ailesi + `MODULE_COOKBOOK` toggle

- **RED:** `server/__tests__/cookbook-api.test.ts`
  - `GET /api/cookbook/recommend` → `{sys, recommended, alternatives, config}` (owner-guard'lı).
  - `GET /api/cookbook/discover` → local models (ollama + gguf) birleşik liste.
  - `POST /api/cookbook/working-prompt` → `optimize.buildWorkingPrompt` çıktısı (indir/kopyala).
  - `MODULE_COOKBOOK=0` → 404/disabled (02-architecture P2 `moduleEnabled` deseni).
- **GREEN:** endpoint'ler `server.ts`'e (ya da `server/modules/cookbook/` — strangler-fig, 02-arch P1)
  mount; standart `authMiddleware`+owner-guard. İş yükü `cookbook.ts`'e delege.
- **Kabul:** owner-guard test GREEN; toggle-off 404; endpoint `optimize`'ı bypass etmez.

### O7.3 — Cockbook UI paneli (Claude Design → Claude Code handoff)

> **Handoff (01-vision §6 sözleşmesi):** UI önce **Claude Design**'da tasarlanır (HTML + screenshot +
> mock data), sonra Claude Code `src/components/cockpit/`'e implemente eder. Bundle localhost'a bağlanmaz.

- **RED:** `src/components/cockpit/__tests__/CookbookPanel.test.tsx` — mock `/api/cookbook/recommend`
  → önerilen model + **score + reason + config** render; correctness-gate düşen model "reddedildi" rozeti;
  llama.cpp/ollama kaynak ikonu.
- **GREEN:** `CookbookPanel.tsx` — `ModelsPanel.tsx`'i **genişletir** (yeni panel yazmak yerine mevcut
  panele "neden bu model?" detay-drawer'ı ekler): score bar, `optimalConfig` satırı (`num_ctx/num_gpu/...`),
  "working-prompt kopyala" butonu. `ProviderLeaderboard` deseninde tablo.
- **Kabul:** `optimize` zenginliği (score/reason/config) ekranda; a11y (scrollable-region-focusable) korunur.

### O7.4 — llama.cpp discovery + `qwen3:8b` guided-pull + pull-progress

- **RED:** `cookbook.test.ts` — `scanGgufModels(dirs)` mock FS → `.gguf` model listesi; `primaryStatus()`
  → champion kurulu-mu; `POST /api/cookbook/pull` SSE frame şekli (`{type:"progress",pct}` / `{type:"done"}`).
- **GREEN:** `scanGgufModels` (zero-dep FS tara), `primaryStatus` (`discoverModels`'te qwen3:8b var mı),
  `POST /api/cookbook/pull` → `ollama pull qwen3:8b` stream proxy (SSE; `council.ts` HTTP-fallback deseni).
- **UI:** `CookbookPanel` — champion eksikse "Install qwen3:8b ($0 primary)" butonu + progress bar
  (`CouncilPanel` SSE deseni).
- **Kabul:** SSE progress test GREEN; primary kuruluysa buton "resident ✓".

### O7.5 — Dual-model serving UI (`LLM_HOST` + `RESEARCH_LLM_ENDPOINT`)

- **RED:** `server/__tests__/cookbook-serving.test.ts` — `getServingConfig()` → `{primaryHost, researchEndpoint}`
  (env okuma, `OLLAMA_HOST` + yeni `RESEARCH_LLM_ENDPOINT`); `providers.ts` research-route seçimi.
- **GREEN:** `cookbook.ts getServingConfig`; `providers.ts`'te `RESEARCH_LLM_ENDPOINT` set-ise
  research-lane onu kullansın (mevcut `ProviderRouter` chain'e ince ekleme, yeni router YOK).
  `.env.example`'a `RESEARCH_LLM_ENDPOINT` bloğu (02-arch P5).
- **UI:** `CookbookPanel`'de primary + research endpoint göster/set (read-only sonra editable).
- **Kabul:** research-endpoint set → research çağrısı oraya; boşsa primary'e düşer (regresyon yok).

### O7.6 — Cookbook → Revenue köprüsü (gelir-monetize bağı) — Şef-2 kesişimi

- **RED:** `server/__tests__/revenue-cookbook.test.ts`
  - `revenue.ts runTestgen` model'i **cookbook önerisinden** türetilebilsin (env/param override kalır):
    `input.model ?? cookbookRecommend().model ?? "qwen3:8b"` (hardcode `:42` yerine).
  - `cookbook.ts monetizeProjection(sel)` → `{model, tokS, estTestgensPerHour, note}` (tok/s → saatlik
    doğru-testgen kaba tahmini; **abartısız**, "potansiyel" etiketli).
- **GREEN:** `revenue.ts`'te qwen3:8b hardcode'unu **cookbook fallback zinciri** ile değiştir (default
  davranış aynı kalır: cookbook yoksa qwen3:8b); `cookbook.ts monetizeProjection` (pure, tok/s tabanlı).
  `/api/cookbook/monetize` (owner-guard) → projeksiyon.
- **UI:** `CookbookPanel`'de "bu donanım gelir potansiyeli: ~N testgen/saat · $0 maliyet" satırı +
  `revenue` tab'ına derin-link.
- **Kabul:** revenue default davranış regresyonsuz; projeksiyon pure+test-edilebilir; abartı-yok (§5 ledger).

---

## 4. Gelir-Monetize Bağlantısı (Şef-2 revenue → cookbook-monetize)

**Neden:** ollamas'ın nihai hedefi (MEMORY: HR content engine / sürdürülebilir gelir) $0-local modelle
gelir üretmek. Cookbook "bu donanımda en-verimli-doğru model"i seçer; revenue op'ları o modeli kullanır.

- **Bağ 1 — model seçimi:** `revenue.ts runTestgen` (`:42` hardcode `qwen3:8b`) → `cookbook.recommend().model`
  fallback zinciri. Güçlü donanım → daha iyi model → daha yüksek testgen doğruluk-oranı, hâlâ **$0**.
- **Bağ 2 — projeksiyon:** `cookbook.ts monetizeProjection(sel)` — seçilen modelin `tokS`'undan **kaba**
  "saatlik doğru-testgen" tahmini + $0 maliyet vurgusu. **Satılabilir deliverable** (testgen/audit) hacim-görünürlüğü.
- **Bağ 3 — storefront besleme:** `revenue.ts generateStorefront` cookbook'un seçtiği model + tok/s'u
  landing-page'de "powered by $0-local qwen3:8b @ N tok/s" olarak gösterebilir (opsiyonel placeholder).
- **Sınır (değişmez):** Şef-2 dosya-yüzeyi izole (`ollamas-revenue-wt`, `feat/revenue-first-payment`).
  Cookbook **yalnız `revenue.ts`'in model-seçim satırına** dokunur (izole diff); para-hareketi/outreach YOK.
  Kesişim O8 RBAC ile koordineli (00-MASTER Şef-2 notu).

---

## 5. Kör-Nokta Ledger (CRITICAL gizleme yasak — ilk sıra)

| # | Risk / kör-nokta | Etki | Azaltma |
|---|---|---|---|
| **KN-1** | `optimize.ts` **CLI-only**; server'dan `import` teknik olarak orchestration→server sınırı geçiyor | build/circular-dep riski | `benchprompt.ts` zaten lib import ediyor; tek-yön import (server→orch-lib), circular değil. Build-test ile doğrula. |
| **KN-2** | `revenue.ts:42` qwen3:8b **hardcode**'unu değiştirmek gelir-regresyonu riski | testgen kırılabilir | Fallback zinciri: cookbook YOKSA **aynen qwen3:8b**; default davranış bit-identik. Test: cookbook-mock-null → qwen3:8b. |
| **KN-3** | `bench.json` **bayat/yok** → `recommend` boş dönebilir | UI "öneri yok" | `isStale` (VAR) uyarır; champion fallback + "--refresh öner". `selectBest` null → UI graceful. |
| **KN-4** | llama.cpp `.gguf` tarama yol-varsayımı (`~/.cache`, `models/`) makineye göre değişir | discovery eksik | Yollar env-configurable (`GGUF_MODEL_DIRS`); bulunamazsa sessiz-boş (ollama listesi yeterli). |
| **KN-5** | `monetizeProjection` **abartı** riski (satış-vaadi gibi durması) | güven kaybı / yanıltma | "potansiyel/kaba tahmin" etiketi zorunlu; tok/s→testgen çevrimi muhafazakâr sabit; test sınır-değer. |
| **KN-6** | `RESEARCH_LLM_ENDPOINT` eklenince `ProviderRouter` chain karmaşası | dual-model regresyon | Boşsa **primary'e düş** (opt-in); mevcut chain'e tek `if`, yeni router yok (02-arch P3 sözleşme). |
| **KN-7** | `rankMacModels` (size-fit) ↔ `optimize` (score-fit) **iki fit-mantığı** | UI tutarsızlık (0.7 vs 0.8) | O7.1 REFACTOR: tek `fits` kaynağı (cookbook); `rankMacModels` delege. RAM-oranı tek sabit. |
| **KN-8** | `cockpit-models.ts` `isCloudOrEmbed` cloud modelleri eler; cookbook cloud'u da önerebilmeli | kapsam farkı | Cookbook `recommend` **yalnız local** (odysseus cookbook local-models); cloud katalog ayrı (provider-catalog). Sınır net. |
| **KN-9** | `MODEL_SELECTION.json` (CLI) vs `/api/cookbook/recommend` (canlı) **iki seçim-kaynağı** çakışabilir | tutarsız öneri | Canlı `recommend` = doğruluk-kaynağı; `MODEL_SELECTION.json` combo-champion (farklı amaç, çakışmaz). Docs'ta ayrım. |

---

## 6. Parity-Kabul Kriteri (odysseus cookbook ile eşdeğerlik)

Bu feature **DONE** sayılır ancak ve ancak:

- [ ] **K1 — Discovery:** `GET /api/cookbook/discover` Ollama **ve** llama.cpp (`.gguf`) yerel modelleri
      birleşik listeler (odysseus `model_discovery.py` parity). Test: mock FS + mock `/api/tags` → birleşik.
- [ ] **K2 — Hardware-aware recommend:** `GET /api/cookbook/recommend` donanımı algılar ve **score +
      reason + optimalConfig** ile model önerir (odysseus Cookbook parity). CLI `optimize` ile **aynı**
      seçimi verir (motor tek). Test: aynı bench girdisi → CLI `selectBest` == API `recommend`.
- [ ] **K3 — Qwen3:8b primary $0-local:** champion `qwen3:8b`; kurulu değilse UI'dan **guided-pull +
      progress**; kuruluysa "resident ✓". Test: primary-absent → pull-button + SSE progress frame.
- [ ] **K4 — Dual-model serving:** `LLM_HOST`(=`OLLAMA_HOST`) + `RESEARCH_LLM_ENDPOINT` UI'da görünür/set;
      research-endpoint set → research-lane oraya, boşsa primary'e düşer. Test: env-varyant → route seçimi.
- [ ] **K5 — UI parity:** cockpit'te "neden bu model?" (score/reason/config) görünür; `optimize`'ın hiçbir
      zenginliği CLI'de hapis kalmaz. a11y regresyon yok.
- [ ] **K6 — Monetize bağı:** `revenue.ts` model'i cookbook'tan türetilebilir (default davranış regresyonsuz);
      `/api/cookbook/monetize` "potansiyel testgen/saat · $0" projeksiyonu döner (abartısız, test-edilebilir).
- [ ] **K7 — Kalite kapısı:** `typecheck ✓ lint ✓ vitest (cookbook*.test) fresh ✓` → conventional commit.
      Yeni skorlayıcı/router yazılmadı (motor reuse doğrulandı: `optimize`/`bench`/`ProviderRouter` import'lu).
- [ ] **K8 — Toggle:** `MODULE_COOKBOOK=0` → tüm `/api/cookbook/*` disabled (02-arch P2 parity).

**Kanıt-first (CLAUDE.md §2):** her kriter için komut çıktısı gösterilir ("çalışıyor" iddiası = test çıktısı).
