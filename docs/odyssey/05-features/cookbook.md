# ODYSSEY — Feature O7: Local-Models Cookbook (donanım-farkında model önerisi) — TAM TDD PLANI

> **Hedef:** ollamas'a odysseus `cookbook/local-models` kalitesinde bir modül: donanımı algıla
> (RAM/chip/core/Metal), model kataloğunu donanıma **kural-tabanıyla** eşle (✓/⚠/✗ fit),
> öneriyi **tek-tık pull** (canlı progress) + **per-model ayar köprüsü** (model-overrides) ile
> kuruluma bağla, hızı **bench ile kanıtla** (llama-bench). **DOC ONLY — kod yok.**
> **Format emsali:** `05-features/documents.md`. **Dil:** anlatı TR, kod/komut/dosya-yolu EN.
> **Üretim tarihi:** 2026-07-11 (tüm iddialar koda karşı Read/Grep ile doğrulandı).

> **Kardeş-belge sınırı (çift-implement YASAK):** `05-features/cookbook-models.md` (motor-köprü
> taslağı: `optimize.ts` reuse + revenue/dual-serving uzantıları) bu planla **çelişmez, tamamlar**.
> **Bu dosya (`cookbook.md`) = KN-P1'i kapatan kanonik O7 planıdır** (PROGRESS §1.1 `PLAN.gap`).
> Motor kararı iki belgede AYNI: skorlayıcı **yeniden yazılmaz**, `optimize.ts` import edilir.
> Bu plan, taslağın doğrulamadığı yüzeyleri ekler: `bench_model` tool'u, `/api/pull` NDJSON deseni,
> model-overrides köprüsü, guard-coverage invariant'ı, `/api/health` os bloğu, model-guide kural-tabanı.
> `cookbook-models.md` O7.5 (dual-serving) + O7.6 (revenue köprüsü) **uzantı** olarak oradan yürür.

---

## 1. Mevcut Durum (ollamas — koda karşı doğrulanmış)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **gerçekten okunarak** teyit edildi.
Bu plan **hiçbir şeyi sıfırdan yazmaz** — tamamı entegrasyon + formalizasyon.

### 1.1 VAR olan sağlam temel (REUSE — sıfırdan yazılmayacak)

| Yetenek | Dosya:satır | Ne yapar / nasıl reuse edilir |
|---|---|---|
| **tok/s bench tool'u** | `server/tool-registry.ts:631` `bench_model` (tier `host`) | `llama-bench -m <gguf> -n <N> -o json` → `execOnHost` → `parseLlamaBench` → `{tps, pp_tps, model, runs}` (outputSchema'lı). Cookbook bench'i **UI'dan bu tool'la tetikler** — ikinci dispatch-path YASAK, `ToolRegistry.execute` choke-point'inden geçer |
| Donanım bilgisi (health) | `server.ts:190` `GET /api/health` → `:230` `os:{platform,release,arch,uptime}` + `memoryUsage()` (macOS-doğru free-mem) | hw-kartının temel verisi zaten servisleniyor; cookbook `arch==="arm64"` → Apple-Silicon/Metal unified-memory çıkarımını buna ekler |
| Sysctl→SysInfo parse | `orchestration/bin/lib/optimize.ts:40` `parseSysctl(memBytes, physCpu, brand)` | chip/core/RAM zenginleştirme (brand string → "Apple M4" gibi); saf-fn, testli (`orchestration/tests/optimize.test.ts`) |
| **VRAM tahmini + fit** | `optimize.ts:25` `modelVramGb` / `:33` `vramFit` (RAM×0.8) | model adı → GB (bilinen tablo + param-tahmin); kural-tabanının çekirdeği |
| Skor + seçim + config | `optimize.ts:52` `scoreModel` / `:79` `selectBest` (correctness-gate) / `:95` `optimalConfig` | weighted-sum (correctness .5 / speed .3 / vramFit .2, `:17`); `optimalConfig` → `num_ctx/num_gpu/num_thread/keep_alive/quant` |
| Cockpit size-fit ranking | `server/cockpit-models.ts:11` `rankMacModels(tags, os.totalmem(), loaded, champion)` | RAM×0.7 fit + champion + smallest-fit fallback; cookbook `fits` tek-kaynağına **delege edilecek** (iki-eşik sorunu, K5) |
| Champion sabiti | `server/ai.ts:35` `MAC_MODEL_CHAMPION="qwen3:8b"` | $0-local primary varsayılanı |
| **VRAM kural-tabanı (docs)** | `docs/model-guide.md:9-17` quick-pick tablosu (8–16 / 18–24 / 32–48 / 64+ GB sınıfları) + `≤ total×0.7` notu + `:22` qwen3:8b ≈82 tok/s gerekçesi | cookbook kural-tabanı bu tabloyu **makine-okur** hale getirir; UI metni bu docs ile tutarlı kalmalı |
| **GGUF/BYO rehberi** | `docs/custom-model.md:42-46` (CLI `ollama create` > HTTP `/api/create` gerekçesi) + §5 per-model tuning akışı | cookbook "custom GGUF" yolu yeni akış icat etmez — bu rehbere derin-link + aynı sizing fiziği (≤70%) |
| **Per-model ayarlar (V7)** | `server/model-overrides.ts:21` `sanitizeModelOverride` / `:39` `resolveModelTuning` / `:51` `resolveKeepAlive` / `:57` `withSystemOverride` | saf merge-mantığı; `numCtx/temperature/keepAlive/system` |
| Per-model ayar API | `server.ts:768` `GET /api/model-overrides` / `:769` `POST` (sanitize→`db.data.modelOverrides`) | öneri-config'ini **tek-tık uygula** köprüsünün mevcut ucu |
| Model katalog API | `server.ts:1411` `GET /api/models/:provider` (8s TTL cache `:1408-1410`, demo-listesi, `reachOllama("/api/tags")`) | discover'ın liste kaynağı; yeni tags-okuyucu yazılmaz |
| Ollama tags/ps akışı | `server.ts` `reachOllama("/api/tags"|"/api/ps"|"/api/version", 3000)` (health + models içinde) | kurulu/yüklü model keşfi hazır |
| **Owner-guard + invariant** | `server.ts:278` `localOwnerGuard` → `:289-295` prefix listesi (`/api/models`, `/api/model-overrides`, …) + `tests/localowner-guard.test.ts:9` **M-002 invariant** | yeni `/api/cookbook` prefix'i guard listesine + test prefix envanterine girmek ZORUNDA (girmezse invariant testi RED) |
| Pull-progress deseni | `planlama/17-KAYNAK-KOD-ORNEKLERI.md` **[M-037]**: ollama `POST /api/pull` NDJSON stream `{status,total,completed,digest}` → `completed/total` progress | doğrulanmış (Ollama docs ✅); cookbook pull-proxy'sinin birebir şablonu |
| UI panel emsalleri | `src/components/cockpit/ModelsPanel.tsx` (kart+fit+RAM), `CouncilPanel.tsx` (SSE progress), `ProviderLeaderboard.tsx` (perf tablo) | görsel desen reuse — veri modeli KOPYALANMAZ (`design-execution/panels/cookbook.md` §1.2) |

### 1.2 YOK olan (bu planın konusu)

- **`server/cookbook.ts` YOK** (`grep -rn "cookbook" server/` → 0). Motor CLI'de, kural docs'ta,
  bench tool'da — ama bunları birleştiren **servis + `/api/cookbook/*` yüzeyi yok**.
- **Donanım-farkında öneri UI YOK.** `ModelsPanel` yalnız size-fit (0.7) gösterir; skor/gerekçe/
  config/tok-s-tahmini ekrana ulaşmıyor; `model-guide.md` tablosu insana-okur, makineye değil.
- **Tek-tık pull YOK.** Model eksikse UI sessizce düşürür; `ollama pull` progress akışı (M-037) yok.
- **Bench'i UI'dan tetikleme YOK.** `bench_model` tool'u yalnız agent/MCP yolundan erişilebilir;
  cockpit'te "bu modeli ölç" butonu ve sonucun öneri-skoruna geri beslenmesi yok.
- **Öneri→ayar köprüsü YOK.** `optimalConfig` çıktısı ile `POST /api/model-overrides` birbirinden
  habersiz; "önerilen config'i uygula" tek-tık akışı yok.
- **İki fit-mantığı çelişkisi:** `rankMacModels` RAM×**0.7** ↔ `optimize.vramFit` RAM×**0.8** —
  tek doğruluk-kaynağı yok (K5).

---

## 2. Odysseus Referansı + Kural-Tabanı (parity hedefi)

odysseus `cookbook/local-models`: donanım algıla → uygun modeli öner → kurulum + serving rehberi.
ollamas eşlemesi (tamamı REUSE üstüne):

| odysseus alt-yeteneği | ollamas karşılığı | VAR/YENİ |
|---|---|---|
| hardware detect | `/api/health` os bloğu + `os.totalmem()` + `parseSysctl` zenginleştirme | VAR → ince sarmalayıcı |
| model discovery | `/api/models/:provider` + `reachOllama("/api/tags")` | VAR → reuse |
| hw-aware recommend | `optimize.selectBest` + kural-tabanı (aşağıda) | VAR (CLI) → servise köprü |
| guided install | ollama `POST /api/pull` NDJSON proxy (M-037) | YENİ (ince proxy) |
| serving guidance | `optimize.optimalConfig` → `model-overrides` köprüsü | VAR uçlar → YENİ köprü |
| speed proof | `bench_model` (`tool-registry.ts:631`) UI tetikleme | VAR → route köprüsü |

**Kural-tabanı (deterministik, ML-yok — `model-guide.md` tablosu makine-okur hali):**

```
RAM sınıfı (unified)  →  param sınıfı        →  örnek (quant Q4_K_M/Q5_K_M)
 8–16 GB              →  ≤4B                 →  qwen3:4b, llama3.2:3b
18–24 GB              →  7–9B  (PRIMARY)     →  qwen3:8b (champion, ≈82 tok/s M4)
32–48 GB              →  27–32B              →  qwen3-coder:30b, deepseek-r1:32b
64 GB+                →  70B                 →  llama3.3:70b

fit(model) = modelVramGb(model) ≤ ramGb × FIT_RATIO        (tek sabit, K5)
rozet: ✓ fit ∧ (bench varsa correctness-gate geçti)  ·  ⚠ fit ama eşiğe ≤%15 yakın ya da tok/s<15
      ·  ✗ !fit → ÖNERİLMEZ (gri + line-through)
```

Tek-doğruluk-kaynağı: GB tahmini = `optimize.modelVramGb`; sınıf sınırları `model-guide.md`
tablosundan sabitlenir ve **testle docs'a pinlenir** (tablo değişirse test kırılır → ikisi senkron).

---

## 3. Hedef Plan (TDD-adımlı — her fazda RED → GREEN → REFACTOR)

> Test runner mevcut: `vitest` + `@playwright/test`. **O0 BLOKER:** kalıcılık (bench-cache,
> seçilen primary) O0 store seam'ine yazılır (`server/store/*`, migration **v7+**, global-monoton
> numara O0 registry'den) — O0 GREEN olmadan bu modül **spawn edilmez** (PROGRESS değişmez kuralı).
> FAZ 1–2 stateless çalışabilir; FAZ 3'ün bench-persist'i O0'a bağlıdır.

### FAZ 0 — İskele + toggle + guard-coverage (kapı: invariant yeşil)

**RED** — `server/__tests__/cookbook-api.test.ts` + `tests/localowner-guard.test.ts` genişletmesi:
- `MODULE_COOKBOOK=0` (default) → `GET /api/cookbook/hardware` 404.
- `SAAS_ENFORCE=1` → `/api/cookbook` prefix'i 403 (M-002 invariant: guard listesi `server.ts:289`
  + test prefix envanteri **birlikte** güncellenir; unutulursa test RED).

**GREEN** — `server/cookbook.ts` iskele (boş export); `server.ts` guard listesine `"/api/cookbook"`;
`.env.example`'a `MODULE_COOKBOOK` (default kapalı — config-driven-default-off yasası).

### FAZ 1 — Donanım algılama (`detectHardware`)

**RED** — `server/__tests__/cookbook.test.ts`:
- `detectHardware()` mock: `os.totalmem/platform/arch/cpus` → `{arch,ramGb,cores,chip,metal:boolean}`;
  `arch==="arm64" ∧ platform==="darwin"` → `metal:true` + "unified memory" etiketi.
- sysctl mevcutsa `parseSysctl` zenginleştirmesi (chip adı); sysctl **başarısızsa graceful**
  (os.* değerleriyle döner, throw yok).
- `GET /api/cookbook/hardware` → 200 + şekil; demo-mode'da da çalışır (os.* gerçek makine).

**GREEN** — `cookbook.ts detectHardware()`: `node:os` + opsiyonel `execOnHost("sysctl ...")` →
`optimize.parseSysctl` (**import**, kopya değil — `benchprompt.ts` emsali, tek-yön server→orch-lib).
`/api/health` os bloğu (`server.ts:230`) DEĞİŞMEZ (regresyon yüzeyi değil); cookbook kendi
zengin ucunu sunar.

### FAZ 2 — Katalog + kural-tabanlı öneri (`recommend`)

**RED:**
- `classifyRam(16)→"8-16"` … sınıf sınırları `model-guide.md` tablosuyla birebir (docs-pin testi).
- `fitBadge(model, ramGb)` → ✓/⚠/✗; `modelVramGb` kullanır; `rankMacModels`'in 0.7'siyle **tek
  FIT_RATIO** sabitine indirgenmiş (K5 REFACTOR testi: iki fonksiyon aynı fit döner).
- `recommend(tags, sys)` → `{primary:{model,fit,reason,config,estTokS?}, alternatives[], ruleClass}`;
  champion kuruluysa primary=qwen3:8b + "resident"; kurulu değilse `install:true`.
  bench verisi varsa `optimize.selectBest` skoru; yoksa **kural-tabanı fallback** (honest: `estTokS`
  yalnız bench'ten, uydurma tok/s YOK).
- `GET /api/cookbook/recommend` → 200; ollama down → 503 + honest-empty (`{models:[], reason}`).

**GREEN** — `cookbook.ts` saf-fn'ler + route; liste kaynağı `reachOllama("/api/tags")` /
`/api/models/:provider` deseni (yeni tags-okuyucu YOK). **REFACTOR:** `rankMacModels` fit'i
cookbook `fitBadge`'e delege (tek kaynak; cockpit görünümü bit-identik kalır — snapshot testi).

### FAZ 3 — Bench entegrasyonu (UI'dan `bench_model` tetikleme)

**RED:**
- `POST /api/cookbook/bench {model|ggufPath}` → `ToolRegistry.execute("bench_model", …)` çağrılır
  (mock registry): **tek choke-point yasası** — route doğrudan `execOnHost` ÇAĞIRMAZ (test bunu asserts).
- ollama-managed model (gguf path'i yok) → 422 + açıklama ("bench .gguf path ister; bkz K3") —
  sahte tps üretilmez.
- bench sonucu `{tps,pp_tps,runs}` öneriye geri beslenir: sonraki `recommend` `estTokS` içerir
  (O0 store'a persist — `cookbook_bench` tablosu v7+; O0 yoksa in-memory + `persisted:false` bayrağı).

**GREEN** — ince route: args doğrula → `registry.execute` → sonucu normalize + (O0 varsa) persist.

### FAZ 4 — Tek-tık pull (guided install, M-037 deseni)

**RED** — `server/__tests__/cookbook-pull.test.ts`:
- `POST /api/cookbook/pull {model}` → upstream ollama `POST /api/pull` NDJSON mock'u
  (`{status,total,completed}` satırları) → istemciye **SSE** `{type:"progress",pct}` frame'leri +
  `{type:"done"}`; `status:"success"` gelmeden done YOK (sahte-installed yasak).
- upstream kesilirse `{type:"error",message}` + bağlantı kapanır; pull yarıda → sonraki `discover`
  modeli "installed" GÖSTERMEZ.
- model adı allowlist-sanitize (shell'e gitmiyor ama log-injection/SSRF hijyeni: yalnız
  `[a-zA-Z0-9._:/-]`), yalnız yapılandırılmış `OLLAMA_HOST`'a fetch (harici URL kabul edilmez).

**GREEN** — M-037 şablonu birebir: `fetch(OLLAMA_HOST + "/api/pull", {stream:true})` → reader →
NDJSON satır-parse → `completed/total` → SSE re-emit. UI tarafı `CouncilPanel` EventSource deseni.

### FAZ 5 — Per-model ayar köprüsü (öneri → model-overrides)

**RED** — `server/__tests__/cookbook-config.test.ts`:
- `configFor(sys, model)` → `optimize.optimalConfig` sarmalı → `ModelOverride` şekline map
  (`num_ctx→numCtx`, `keep_alive→keepAlive`; `num_gpu/num_thread` override-dışı → yalnız
  "working-prompt/Modelfile önerisi" metninde, K6).
- `POST /api/cookbook/apply-config {model}` → `sanitizeModelOverride`'dan geçer →
  `db.data.modelOverrides[model]` yazılır → sonraki `GET /api/model-overrides` onu döner.
- geçersiz alanlar sessizce düşer (sanitize sözleşmesi, `model-overrides.ts:21`); mevcut
  el-ile-girilmiş override'ı **onaysız ezmez** (409 + `{current, proposed}` diff döner).

**GREEN** — köprü ince: mevcut `POST /api/model-overrides` semantiği DEĞİŞMEZ; cookbook yalnız
öneri-gövdesi üretip aynı sanitize+persist yolunu kullanır. `custom-model.md` §5 akışıyla tutarlı.

### FAZ 6 — UI sekmesi (`CookbookPanel`) + i18n

> UI sözleşmesi: `design-execution/panels/cookbook.md` (donanım kartı / öneri grid ✓⚠✗ /
> primary kart + score/reason/config / filtre / pull-progress / kurulu-liste). Handoff-bundle
> oradan; bu faz yalnız Claude-Code implementasyon adımlarını bağlar.

**RED** — `src/components/__tests__/CookbookPanel.test.tsx`:
- 4 durum render: taranıyor (skeleton) / öneri-yükleniyor / pull-hatası (amber banner + retry,
  sahte-installed yok) / dolu (✓⚠✗ rozetler metin-tabanlı, renk-only değil).
- "Apply recommended config" → `POST /api/cookbook/apply-config` mock çağrısı; 409'da diff-onay.
- "Benchmark" butonu → `POST /api/cookbook/bench`; sonuç karta `~N tok/s (measured)` olarak düşer
  (`estimated` ↔ `measured` etiket ayrımı — honest).
- pull-progress `role="progressbar"` + `aria-live="polite"`.

**GREEN** — `src/components/CookbookPanel.tsx` (`ModelsPanel` desenini genişletir, veri modeli
kopyalamaz); `App.tsx` `tabs[]`'a `cookbook` + `isTabEnabled` capability-gate; i18n `cookbook.*`
EN+TR (`src/locales/{en,tr}.ts` — Lingui zorunlu çifti).

---

## 4. API Rota Özeti (hepsi `MODULE_COOKBOOK` toggle + `localOwnerGuard` arkasında)

| Rota | İş | Reuse temeli |
|---|---|---|
| `GET /api/cookbook/hardware` | hw kartı verisi | `node:os` + `parseSysctl` (optimize.ts:40) |
| `GET /api/cookbook/recommend` | kural-tabanı + skor önerisi | `optimize.ts` + model-guide tablosu |
| `GET /api/cookbook/discover` | kurulu/yüklü modeller | `reachOllama("/api/tags"/"/api/ps")` |
| `POST /api/cookbook/bench` | tok/s ölçümü | `ToolRegistry.execute("bench_model")` (tool-registry.ts:631) |
| `POST /api/cookbook/pull` | guided install, SSE progress | ollama `/api/pull` NDJSON (M-037) |
| `POST /api/cookbook/apply-config` | öneri→per-model ayar | `sanitizeModelOverride` + `/api/model-overrides` yolu (server.ts:768) |

**Guard-coverage invariant (değişmez):** `/api/cookbook` prefix'i `server.ts:289` listesine VE
`tests/localowner-guard.test.ts` envanterine aynı commit'te girer; `SAAS_ENFORCE=1 → 403` testi
FAZ 0'da RED yazılır. Toggle-off → route'lar 404 (parity kriteri 3, PROGRESS §3).

---

## 5. RED-Test Listesi (toplu — kod öncesi yazılacak sıra)

1. `cookbook-api.test.ts`: toggle-off 404 · guard 403 (M-002 genişletme).
2. `cookbook.test.ts`: `detectHardware` (arm64→metal, sysctl-fail graceful) · `classifyRam`
   docs-pin · `fitBadge` ✓/⚠/✗ · FIT_RATIO tek-kaynak (rankMacModels delege eşitliği) ·
   `recommend` (champion-resident / champion-absent-install / bench-yok-fallback / ollama-down 503).
3. `cookbook-bench.test.ts`: choke-point zorunluluğu (registry.execute mock assert) · gguf-path-yok 422 ·
   bench→estTokS geri-besleme · O0-yok `persisted:false`.
4. `cookbook-pull.test.ts`: NDJSON→SSE frame sözleşmesi · success'siz done-yok · error frame ·
   model-adı sanitize · yarıda-pull installed-görünmez.
5. `cookbook-config.test.ts`: optimalConfig→ModelOverride map · sanitize düşürme · 409 diff-onay ·
   mevcut override ezilmez.
6. `CookbookPanel.test.tsx`: 4-durum · estimated/measured etiketi · a11y (progressbar/aria-live/metin-rozet).
7. E2E (Playwright, ilgili): sekme aç → hw kartı → öneri → (mock) pull progress → config uygula.

---

## 6. Parity Kabul Kriteri ("bitti" tanımı — hepsi GREEN)

- [ ] **P1** Donanım algılama: RAM/chip/cores/Metal doğru; sysctl-fail graceful (test yeşil).
- [ ] **P2** Kural-tabanı `model-guide.md` tablosuyla **docs-pin testli** tutarlı; sınıf→model eşleşir.
- [ ] **P3** Fit tek-kaynak: `rankMacModels` ↔ cookbook aynı FIT_RATIO; cockpit regresyonsuz (snapshot).
- [ ] **P4** Öneri dürüst: tok/s yalnız bench'ten (`measured`) ya da açık `estimated`; ✗ model önerilmez.
- [ ] **P5** Bench UI'dan tetiklenir ve **yalnız** `ToolRegistry.execute` üstünden (choke-point testi).
- [ ] **P6** Tek-tık pull: NDJSON→SSE progress; success'siz installed YOK; hata non-blocking + retry.
- [ ] **P7** Ayar köprüsü: apply-config → `db.data.modelOverrides`; sonraki chat isteği override'ı alır
      (`resolveModelTuning` yolu); el-ayarı onaysız ezilmez.
- [ ] **P8** Guard + toggle: `SAAS_ENFORCE=1→403`, `MODULE_COOKBOOK=0→404` (invariant testleri).
- [ ] **P9** UI: 4-durum + a11y + i18n EN/TR + dark/light token-driven; `panels/cookbook.md` sözleşmesi.
- [ ] **P10** Kalite kapısı: `tsc --noEmit ✓ lint ✓ vitest (fresh) ✓ e2e (ilgili) ✓`; yeni skorlayıcı/
      tags-okuyucu/dispatch-path YAZILMADI (reuse kanıtı: import listesi).

**Bilerek kapsam-dışı (ayrı iş):** dual-serving `RESEARCH_LLM_ENDPOINT` + revenue köprüsü
(`cookbook-models.md` O7.5/O7.6), `.gguf` dizin-tarama discovery (oradaki O7.4), mobil (<768px) UI,
cloud-model önerisi (cookbook **yalnız local**; cloud = provider-catalog alanı).

---

## 7. Efor + Sıra

**M** (03-claude-design-ui §4 + 00-MASTER W2 ile hizalı). Sıra: FAZ 0→1→2 (stateless çekirdek,
~1 oturum) → FAZ 3–5 paralelleşebilir (bağımsız yüzeyler; Tier-1 tek-mesaj kuralı) → FAZ 6 UI
(handoff-bundle sonrası). Ön-koşullar: **O0 GREEN** (persist) + Emre T0 onayı + baseline (KN-M10).

---

## 8. Kör-Nokta Ledger (CRITICAL gizleme yasak — ilk sıra)

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| **K1** | **RİSK (CRITICAL)** | `bench_model` tier=`host` → `execOnHost` gerçek host komutu; UI'dan tetiklenebilir olması kötüye-kullanım yüzeyi büyütür | Yüksek | Route yalnız `ToolRegistry.execute` (ownership→allowedTiers→scope zinciri bedava işler, tool-registry.ts:882-961); guard+toggle zorunlu; rate-limit mevcut middleware'den |
| **K2** | **RİSK** | Çift plan dosyası (`cookbook.md` ↔ `cookbook-models.md`) şef'i iki kaynağa bölebilir | Orta | Başlıktaki kardeş-belge sınırı: **bu dosya kanonik O7**; O7.5/O7.6 uzantıları oradan; çift-implement yasak (00-MASTER §3 sahiplik-notu emsali) |
| **K3** | Bilinmeyen | `bench_model` `.gguf` **mutlak path** ister; ollama-managed modellerin blob path'i (`~/.ollama/models/blobs/sha256-…`) kullanıcı-dostu değil | Orta | FAZ 3: path'siz model → 422 + rehber; blob-path çözümleme (manifest okuma) ayrı iterasyon; alternatif: orchestration `bench.ts` ollama-API benci (VAR) ile ölç |
| **K4** | Varsayım | `optimize.ts` server-import sınırı (orchestration→server tek-yön) build'i kırmaz | Yüksek | `benchprompt.ts` emsali; FAZ 0 kapısında `tsc --noEmit` + `npm run build` kanıtı |
| **K5** | RİSK | İki fit-eşiği (0.7 cockpit / 0.8 optimize) — kullanıcıya iki farklı "fit" | Orta | FAZ 2 REFACTOR: tek `FIT_RATIO`; hangi değer kalacağı **T0 kararı** (muhafazakâr 0.7 öneri — model-guide ile aynı); snapshot testi regresyonu kilitler |
| **K6** | Kapsam | `optimalConfig`'in `num_gpu/num_thread`'i `ModelOverride` şemasında YOK | Düşük | Köprü yalnız `numCtx/keepAlive` uygular; kalanı Modelfile/working-prompt önerisi metni (custom-model.md yolu); şema genişletme ayrı karar |
| **K7** | Bilinmeyen | Pull sırasında disk-dolu / çok-büyük model (70B=42GB) — progress akar ama makine zorlanır | Orta | Pull öncesi `fitBadge` ✗ ise onay-diyaloğu ("bu model donanımına sığmaz — yine de indir?"); disk-alan kontrolü opsiyonel iterasyon |
| **K8** | Varsayım | `os.totalmem()` = unified memory Apple-Silicon'da doğru VRAM vekili | Düşük | Doğru (unified); Intel-mac/dGPU ayrımı `metal:false` + "VRAM ayrı, tablo yalnız rehber" dürüst notu |
| **K9** | RİSK | Docs-pin testi (`model-guide.md` parse) kırılgan olabilir (md formatı değişirse) | Düşük | Pin, tabloyu değil **sabitler modülünü** test eder; docs değişimi = sabitler değişimi PR disiplini; yorum satırıyla çift-yön işaret |
| **K10** | Bilinmeyen | O0 store hazır değilken bench-persist nereye? | Orta | FAZ 3 `persisted:false` in-memory dürüst mod; O0 GREEN sonrası `cookbook_bench` v7+ migration (global-monoton, O0 registry atar); JSON-only regresyon YASAK (parity kriteri 4) |

---

*Üretici: ODYSSEY planlama üreteci (O7 kanonik plan — KN-P1 kapanışı). Koda karşı okunan kaynaklar:*
*`server/tool-registry.ts:631` (bench_model), `server.ts:190/230/278/289/768/1411` (health-os,*
*localOwnerGuard, model-overrides, models-catalog), `server/model-overrides.ts`, `server/cockpit-models.ts`,*
*`server/ai.ts:35`, `orchestration/bin/lib/optimize.ts:25/33/40/52/79/95`, `docs/model-guide.md`,*
*`docs/custom-model.md`, `planlama/17-KAYNAK-KOD-ORNEKLERI.md` [M-037], `tests/localowner-guard.test.ts`,*
*`docs/odyssey/{00-MASTER,03-claude-design-ui,05-features/{documents,cookbook-models}}.md`,*
*`design-execution/panels/cookbook.md`. Tarih: 2026-07-11.*
