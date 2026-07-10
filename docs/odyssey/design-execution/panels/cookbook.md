# ODYSSEY-DESIGN — Panel: Cookbook / Local-Models (donanım-farkında model öneri) (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/cookbook.md`
> **Odak:** Cookbook paneli — odysseus `cookbook/local-models` parity. Donanımı algıla (RAM/GPU/VRAM/chip) → o donanıma **en-verimli-doğru** yerel modeli **fit-score + gerekçe + serving-config** ile öner → `qwen3:8b`'yi `$0-local` primary olarak **guided-pull + pull-progress** ile kur → seçimi **gelir hattına** (revenue → monetize) köprüle.
> **Kritik ayrım (kör-noktayı ilk sıraya koyuyoruz):** ollamas'ta donanım-farkında **seçim MOTORU ZATEN VAR** (`orchestration/bin/lib/optimize.ts` → `scoreModel/selectBest/optimalConfig`) ama **CLI'ye HAPSEDİLMİŞ**; cockpit UI (`ModelsPanel`) yalnız `rankMacModels`'in **basit size-fit** çıktısını gösteriyor — **skor yok, gerekçe yok, tok/s-tabanlı öneri yok, optimal-config yok**. Ayrıca model-UI cockpit'te **DAĞINIK** (`ModelsPanel` + `ProviderLeaderboard` + `CouncilPanel` üç ayrı yer). Bu panel motoru **sıfırdan yazmaz**; `optimize`'ın `Scored{score,reason,config}` zenginliğini ekrana taşıyan + dağınık paneli birleştiren bir **cookbook** katmanı tasarlar.
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** (backend/API/localhost/SSE YOK, mock-veri). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Durum (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10) — `src/components/cockpit/ModelsPanel.tsx`, `src/components/cockpit/ProviderLeaderboard.tsx`, `src/components/cockpit/CouncilPanel.tsx`, `docs/odyssey/05-features/cookbook-models.md`, `docs/odyssey/03-claude-design-ui.md` §3.7.

### 1.1 Cookbook-UI durumu: **KISMİ** — motor var, dağınık, zenginlik ekrana ulaşmıyor

- **Cookbook paneli YOK.** `03-claude-design-ui.md` §3.7: donanım-kartı + fit-score'lu öneri-grid gösteren bir `cookbook` sekmesi mevcut değil. `src/App.tsx` `tabs[]` içinde `cookbook` **yok** (model-ilgili yüzey yalnız `telemetry`/cockpit içinde gömülü).
- **Motor CLI'ye hapis.** `optimize.ts` (gerçek hw-aware seçim: `scoreModel:52` correctness-gate 0.7 → tok/s normalize → VRAM-fit weighted-sum; `selectBest:87`; `optimalConfig:95` → `num_ctx/num_gpu/num_thread/keep_alive/quant`) **CLI-only**; çıktısı yalnız `MODEL_SELECTION.json` dosyasına yazılıyor, HTTP yüzeyi + UI yok.
- **UI yalnız basit size-fit gösteriyor.** `ModelsPanel.tsx` `rankMacModels`'in çıktısını render eder: model adı + boyut (GB) + `fitsRam`/`loaded`/`recommended` + `championTokPerSec`. **Score yok, reason yok, optimalConfig yok, tok/s-tahmini kart-başına yok, quant yok** — "neden bu model?" sorusunun cevabı ekranda yok (`optimize.Scored` zenginliği hiç ulaşmıyor).
- **`qwen3:8b` guided-pull / pull-progress YOK.** Champion `qwen3:8b` **varsayılıyor** (`ai.ts:35 MAC_MODEL_CHAMPION`); kurulu değilse UI **sessizce champion'ı düşürür** — kur-önerisi + canlı `ollama pull` progress akışı yok.
- **Serving-config / dual-model UI YOK.** `OLLAMA_HOST` env var ama cockpit'te "primary endpoint / research endpoint" ayrı gösteren/set-eden panel yok (odysseus `LLM_HOST` + `RESEARCH_LLM_ENDPOINT`).
- **Cookbook ↔ gelir bağı YOK.** `revenue.ts:42` `qwen3:8b`'yi **hardcode** kullanıyor; cookbook'un donanım-seçimi ile revenue op'larının model-seçimi bağlı değil; "bu model saatte ~N doğru-testgen → gelir potansiyeli" projeksiyonu yok.

### 1.2 Dağınık model-UI = **birleştirme hedefi** (üç ayrı panel emsal, kopyalanmaz)

| Boyut | `ModelsPanel.tsx` | `ProviderLeaderboard.tsx` | `CouncilPanel.tsx` | Cookbook'a katkı |
|---|---|---|---|---|
| Amaç | Local model listesi (size-fit) | Provider perf tablosu (60s pencere) | Council calibrate (SSE doğruluk) | — |
| Yeniden-kullanılacak desen | Kart grid + fit/loaded/recommended rozet + RAM göstergesi (`:47-85`) + a11y scroll-region (`:47-52`) | tok/s / p95 / success **tablo** deseni (`:18-38`) | **SSE progress** akış deseni (`calibrate:34`, `EventSource`, `onmessage`/`onerror`) + running/stop butonları (`:88-113`) | Kart grid → model öneri grid; tablo → alternatifler; SSE → **pull-progress** |
| Kopyalanmayacak | `ModelInfo` veri modeli (score/reason yok) | `byProvider` telemetri modeli | `/api/council/calibrate` semantiği (calibrate ≠ pull) | Cookbook kendi `Recommendation` modelini kullanır |

> **Not (K1 ilk-sıra):** Cookbook bu üç panelin **veri modelini kopyalamaz** — yalnız görsel desenleri emsal alır: `ModelsPanel` **kart-grid + RAM göstergesi**, `ProviderLeaderboard` **perf-tablo**, `CouncilPanel` **SSE-progress + running/stop**. İçerik = donanım-farkında öneri (score/reason/config/pull), size-fit listesi değil.

### 1.3 Backend bağımlılığı (bu UI panelinin arkasındaki iş — ayrı plan)

Cookbook paneli **frontend-only** Claude Design işidir; gerçek veri için `05-features/cookbook-models.md`'deki backend gerekir. UI, o backend'in **API sözleşmesine** göre mock'lanır:

- `GET /api/cookbook/recommend` → `{sys, recommended, alternatives[], config}` (O7.2, henüz YOK; owner-guard'lı).
- `GET /api/cookbook/discover` → local models (Ollama + `.gguf` birleşik) (O7.4).
- `POST /api/cookbook/pull` → SSE `{type:"progress",pct}` / `{type:"done"}` (`ollama pull qwen3:8b` proxy, O7.4).
- `POST /api/cookbook/working-prompt` → `optimize.buildWorkingPrompt` çıktısı (indir/kopyala, O7.2).
- `GET /api/cookbook/monetize` → `{model, tokS, estTestgensPerHour, note}` projeksiyon (O7.6).
- **Kanonik sınır:** `recommend`/`config` motoru = **mevcut `optimize.ts`** (server `cookbook.ts` onu `import` eder); yeni skorlayıcı yazılmaz. Backend hazır değilken UI **mock-veri** ile tasarlanır; Claude Code handoff'ta bu sözleşmeye bağlanır (K3, K7).

---

## 2. Hedef Cookbook Paneli — odysseus `cookbook/local-models` parity

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır; gerçek hw-detect (`detectHardware` → sysctl), `optimize.selectBest` çağrısı, `ollama pull` SSE **Claude Code handoff** aşamasında `server/cookbook.ts` + `src/components/CookbookPanel.tsx`'e implemente edilir. Claude Design yalnız **görsel iskeleti + 4 mock durumu** üretir.

**Panel anatomisi (üç-bölge, boğmayan düzen — `03-ui` §2 kriter 1):**

```
┌─ ÜST: donanım kartı ("senin makinen") ───────────────────────
│  [chip: Apple M-serisi]  RAM 16GB  ·  GPU/VRAM (unified)  ·  cores
│  fit-eşiği rozeti: "≤70% RAM = rahat" · [Yeniden tara]
├─ ANA: model öneri grid (donanıma göre skorlu) ───────────────
│  ★ PRIMARY kart (qwen3:8b, $0-local, vurgulu, geniş)
│     score-bar + reason + optimalConfig satırı + [kopyala working-prompt]
│  grid kartları (her biri):
│     model adı · boyut(GB) · quant · ~tok/s · uyum rozeti (✓/⚠/✗)
│     kaynak ikonu (ollama / gguf) · [pull] veya [resident ✓]
│  filtre bandı: görev [chat|code|embed] + boyut + kaynak
├─ ALT: kurulu modeller + serving + gelir köprüsü ─────────────
│  kurulu-model listesi + RAM kullanımı (mevcut ModelsPanel deseni)
│  serving-config: primary endpoint (OLLAMA_HOST) · research endpoint
│  [gelir] "bu donanım gelir potansiyeli: ~N testgen/saat · $0 maliyet" → revenue
```

**Uyum-rozeti mantığı (odysseus fit-score → ✓/⚠/✗ eşlemesi — `optimize.vramFit` RAM×0.8 + correctness-gate 0.7):**
`✓ rahat çalışır` (fit + correctness-gate geçti) · `⚠ sınırda` (fit ama tok/s düşük ya da RAM yakın-eşik) · `✗ yetersiz` (RAM'e sığmaz / correctness-gate altı → **önerilmez**, gri + line-through). Bu 3 durum kart-renklendirmenin birebir kaynağıdır (`ModelsPanel:56-60` fit rengi deseni genişletilir).

**Adım-vokabüleri (donanım → öneri akışı — `05-features/cookbook-models.md` O7.1 eşlemesi):**
`detectHardware (sysctl parse)` → `discoverModels (ollama /api/tags + .gguf scan)` → `recommend (selectBest + optimalConfig)` → `pull (qwen3:8b guided, SSE progress)`. Donanım kartı + öneri grid + pull-progress bu akışın görsel karşılığıdır.

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul). Backend olmadığı için **tüm veri mock**tur.

```
[GOAL]
Design a "cookbook / local-models" panel for a self-hosted, local-first AI
workspace ("ollamas", odysseus-parity). The panel is HARDWARE-AWARE: it detects
the user's machine (RAM / GPU / VRAM / chip / cores), then RECOMMENDS the most
efficient-yet-correct local model for THAT hardware, with a fit score, a plain
reason ("why this model?"), and a ready-to-use serving config. It highlights
"qwen3:8b" as the $0-local PRIMARY model (guided pull + live progress if not
installed). This is NOT a flat model list — every card is scored and explained
against the detected hardware, and the panel ends with a $0-cost revenue hook.

[LAYOUT]
- Full-height panel, three logical zones stacked.
- HARDWARE CARD (top): a "this-is-your-machine" card — chip name (e.g. "Apple
  M-series"), unified RAM (e.g. 16 GB), GPU/VRAM note (unified memory on Apple
  Silicon), CPU cores. A fit-threshold pill ("≤70% RAM = comfortable"), and a
  "Rescan hardware" ghost button. Feels like a diagnostic readout, mono.
- RECOMMENDATION GRID (main): the core.
  • A PRIMARY card, wider & emphasized: "qwen3:8b · $0-local PRIMARY". It shows a
    horizontal SCORE BAR (0..1), a one-line REASON ("best correctness-per-token on
    16 GB unified memory"), an OPTIMAL-CONFIG row in mono
    (num_ctx / num_gpu / num_thread / keep_alive / quant), and a "Copy
    working-prompt" button. If installed → "resident ✓"; if not → "Install
    qwen3:8b ($0 primary)" button.
  • A grid of other model cards. Each card: model name · size (GB) · quant ·
    estimated tok/s · a FIT BADGE colored by hardware:
      ✓ "runs comfortably" (green)   ⚠ "borderline" (amber)
      ✗ "insufficient" (rose, greyed + line-through — NOT recommended)
    plus a source icon (ollama vs local .gguf) and a per-card action
    ([Pull] or [resident ✓]).
  • FILTER BAND above the grid: task [Chat | Code | Embed] + size + source
    (ollama / gguf).
- INSTALLED + SERVING + REVENUE (bottom):
  • Installed-models list with a RAM-usage meter (reuse the existing models-list
    pattern).
  • Serving config: PRIMARY endpoint (OLLAMA_HOST) + a separate RESEARCH endpoint
    field (dual-model), read-only display with an edit affordance.
  • A REVENUE hook line: "This hardware's earning potential: ~N correct
    testgens/hour · $0 cost" with a subtle link to the Revenue panel. Label it
    "potential / rough estimate" — never a sales promise.

[CONTENT]
Mock a fully-scanned machine and a recommendation set.
Hardware card: chip "Apple M-series", RAM "16 GB unified", GPU "unified memory",
cores "10". Fit threshold "≤70% RAM comfortable".
Primary card: "qwen3:8b" · size 5.2 GB · quant Q4_K_M · ~48 tok/s · score 0.91 ·
reason "best correctness-per-token that fits 16 GB comfortably" · config
"num_ctx 8192 · num_gpu 999 · num_thread 8 · keep_alive 30m · quant Q4_K_M" ·
status "resident ✓".
Model grid — EXACTLY 6 cards (3 comfortable, 2 borderline, 1 insufficient):
  1. qwen3:8b    · 5.2 GB · Q4_K_M · ~48 t/s · ✓ comfortable · ollama · resident
  2. phi4        · 9.1 GB · Q4_K_M · ~31 t/s · ✓ comfortable · ollama · [Pull]
  3. qwen3:4b    · 2.6 GB · Q4_K_M · ~72 t/s · ✓ comfortable · ollama · resident
  4. gemma2:9b   · 10.4 GB · Q5_K_M · ~22 t/s · ⚠ borderline · ollama · [Pull]
  5. mistral-nemo (gguf) · 12.1 GB · Q5_K_M · ~18 t/s · ⚠ borderline · gguf · [Pull]
  6. llama3.3:70b · 42 GB · Q4_K_M · — · ✗ insufficient (needs ~60 GB) · ollama · disabled
Filter default: task = Chat, size = all, source = all.
Serving: primary "http://127.0.0.1:11434" (OLLAMA_HOST) · research "(not set →
falls back to primary)".
Revenue hook: "~12 correct testgens/hour · $0 cost (potential estimate)".

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Model names, sizes, tok/s, quant, and config rows are mono. Score bar + primary
card use accent-indigo; ✓ uses ok-green, ⚠ uses warn-amber, ✗ uses err-rose
(greyed). The $0-local PRIMARY badge is a proud, quiet emerald. Dark is primary;
ALSO produce a light variant (token-driven, no dark: prefixes). Motion: fade-in
0.25s; pull-progress bar animates; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR states:
  1. SCANNING (hardware detecting) — hardware card shows a pulsing "Detecting
     hardware…" skeleton; recommendation grid ghosted/skeleton cards; no scores yet.
  2. RECOMMENDING (loading recommendation) — hardware card filled, but the grid
     shows skeleton shimmer while "Scoring models for your machine…"; primary card
     placeholder.
  3. PULL ERROR — the primary/pull flow failed: a non-blocking amber banner
     "Pull failed — qwen3:8b download interrupted" with a retry, the pull bar
     stopped mid-way at e.g. 43%; the rest of the panel still usable (last-known
     recommendations shown). NEVER a fabricated "installed" state.
  4. FILLED (recommendation ready) — hardware card populated, primary card with
     score/reason/config, 6 model cards with fit badges, installed list + serving +
     revenue hook. Happy-path reference.
Responsive:
  • DESKTOP (≥1024px): hardware card full-width; recommendation grid 2–3 columns;
    installed/serving/revenue in a bottom row.
  • TABLET (768–1023px): grid collapses to single column (cards stack); primary
    card stays on top full-width; serving + revenue stack below the installed list.
Keyboard-first: Enter on a card = pull/select, esc cancels a running pull.
Accessibility: hardware card role="status", recommendation grid role="list" with
each card a list item, fit badges have text (not color-only), the score bar has
aria-valuenow/min/max, pull-progress uses role="progressbar" aria-live="polite",
scrollable model region keyboard-reachable, focus-visible rings, contrast AA.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Panel görünümü | Kritik detay (honest / anti-halüsinasyon) |
|---|---|---|
| **1. Donanım taranıyor** | Donanım kartı `Detecting hardware…` pulse skeleton; öneri grid hayalet/skeleton kart; skor yok | Henüz hiçbir öneri yok — sahte skor gösterme |
| **2. Öneri yükleniyor** | Donanım kartı dolu; grid shimmer + `Scoring models for your machine…`; primary kart placeholder | hw biliniyor, öneri hesaplanıyor (mock skeleton) |
| **3. Pull hatası** | Amber non-blocking banner `Pull failed — qwen3:8b download interrupted` + retry; pull-bar %43'te durmuş; panel geri kalanı **kullanılabilir** (last-known öneri) | **Asla sahte "installed ✓"** — pull bitmediyse resident işareti yok; non-blocking |
| **4. Dolu öneri** | Donanım kartı dolu; primary kart (score/reason/config); 6 model kartı (3✓ 2⚠ 1✗); kurulu-liste + serving + gelir-hook | happy-path referans; her kart donanıma-göre skorlu, ✗ kart önerilmez (line-through) |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema).

---

## 5. Responsive (desktop + tablet)

| Viewport | Öneri grid | Donanım + primary kart | Alt (kurulu/serving/gelir) |
|---|---|---|---|
| **Desktop (≥1024px)** | 2–3 kolon kart grid | Donanım kartı tam-genişlik; primary kart geniş/vurgulu | Tek satırda yan-yana |
| **Tablet (768–1023px)** | Tek-kolon (kartlar dikey yığılır) | Primary kart üstte tam-genişlik | Serving + gelir kurulu-liste altına yığılır |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` §2.8 "mobil bozulmayan grid" genel kriteri geçerli; detay tasarımı ayrı iş (Kör-Nokta KN-M).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk iskeleti üretir (muhtemel: düz model listesi, donanım-kartı zayıf, skor yok).
2. **İnline-comment #1:** "Üste 'senin makinen' donanım kartı ekle: chip + RAM 16GB + GPU/VRAM (unified) + cores + fit-eşiği rozeti (≤70% RAM) + Yeniden-tara butonu."
3. **Chat iterasyon #2:** "Her model kartına donanıma-göre uyum rozeti (✓ rahat / ⚠ sınırda / ✗ yetersiz) + boyut(GB) + quant + ~tok/s + kaynak ikonu (ollama/gguf) ekle. ✗ kartı gri + line-through (önerilmez)."
4. **İnline-comment #3:** "qwen3:8b'yi PRIMARY vurgulu kart yap: score-bar (0..1) + tek-satır reason + optimalConfig satırı (num_ctx/num_gpu/num_thread/keep_alive/quant) + 'Copy working-prompt' butonu + '$0-local PRIMARY' rozeti."
5. **Chat iterasyon #4:** "Primary kart kurulu değilse 'Install qwen3:8b ($0 primary)' butonu + pull-progress bar; kuruluysa 'resident ✓'. Grid üstüne filtre bandı (görev chat/code/embed + boyut + kaynak)."
6. **İnline-comment #5:** "Alt bölge: kurulu-model listesi + RAM kullanım göstergesi + serving-config (primary OLLAMA_HOST + ayrı research endpoint) + '[gelir] bu donanım ~N testgen/saat · $0 (potansiyel tahmin)' satırı → revenue link."
7. **Chat iterasyon #6:** "4 durumu ayrı frame üret: taranıyor (skeleton) / öneri-yükleniyor (shimmer) / pull-hatası (amber banner + %43 durmuş bar, sahte-installed YOK) / dolu (6 kart 3✓2⚠1✗)."
8. **İnline-comment #7:** "Light varyantı token-driven üret (dark: prefix yok). Tablet: grid tek-kolon, primary üstte, serving+gelir kurulu-liste altına."
9. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (K1 azaltma; shell paneli export'u varsa onunla hizala).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/cookbook/` altına:

```
cookbook/
  PROMPT.md              # §3'teki tam brief (token + mock + 4-state)
  cookbook.html          # Claude Design export (self-contained, inline CSS)
  screenshot-scanning.png   # 4 durum × dark
  screenshot-recommending.png
  screenshot-pullerror.png
  screenshot-filled.png
  screenshot-*-light.png # her durumun light varyantı
  screenshot-tablet.png  # tek-kolon grid + primary üstte
  HANDOFF.md             # ↓ zorunlu içerik
  tokens.snippet.css     # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  MODEL_CARD.spec.md     # model kartı prop imzası (name/size/quant/tokS/fit/source/action)
  HW_BADGE.spec.md       # donanım kartı prop imzası (chip/ram/vram/cores/fitThreshold)
  PULL_PROGRESS.spec.md  # SSE pull-progress prop imzası + progress/done/error frame
```

**HANDOFF.md zorunlu içeriği:**
- Component ağacı: `CookbookPanel` → `HardwareCard` / `RecommendationGrid(models[])` → `PrimaryModelCard` + `ModelCard` / `FilterBand` / `InstalledList` + `RamMeter` / `ServingConfig` / `RevenueHook`.
- **Mock→real map:** her mock alanı hangi `/api/cookbook/*` sözleşme alanına bağlanır:
  - donanım kartı → `GET /api/cookbook/recommend` `sys` (`detectHardware` → `optimize.parseSysctl`; RAM/cores/chip).
  - primary + grid kartları → `recommended` + `alternatives[]` (`optimize.selectBest`; her kart `{model,score,reason,tokS,fits}`).
  - optimalConfig satırı → `config` (`optimize.optimalConfig`; num_ctx/num_gpu/num_thread/keep_alive/quant).
  - "Copy working-prompt" → `POST /api/cookbook/working-prompt` (`optimize.buildWorkingPrompt`).
  - pull-progress → `POST /api/cookbook/pull` SSE (`{type:"progress",pct}`/`{type:"done"}`; `CouncilPanel` EventSource deseni).
  - kaynak ikonu (ollama/gguf) → `GET /api/cookbook/discover` `source` alanı (`scanGgufModels` + `/api/tags`).
  - serving → `getServingConfig()` (`OLLAMA_HOST` + `RESEARCH_LLM_ENDPOINT`).
  - gelir-hook → `GET /api/cookbook/monetize` (`{model,tokS,estTestgensPerHour,note}`).
- **Backend sözleşmesi:** `05-features/cookbook-models.md` O7.1-O7.6 (`server/cookbook.ts` motor-sarmalı; `optimize.ts` **import**, yeni skorlayıcı YOK; owner-guard + `MODULE_COOKBOOK` toggle). UI, backend hazır olmadan **mock**la ship EDİLMEZ — sözleşme kilitli olmalı.
- **Fit-mantığı tek-kaynağı:** UI ✓/⚠/✗ rozeti `optimize.vramFit` + correctness-gate'ten türer; `rankMacModels` (size-fit) ↔ `optimize` (score-fit) **iki fit-mantığı** cookbook'ta tek `fits` kaynağına birleşir (O7.1 REFACTOR; KN-7 backend). UI iki farklı eşik (0.7 vs 0.8) göstermemeli.
- i18n anahtar listesi: yeni `cookbook.hw.chip/ram/vram/cores/rescan`, `cookbook.fit.comfortable/borderline/insufficient`, `cookbook.primary.install/resident`, `cookbook.config.*`, `cookbook.filter.task/size/source`, `cookbook.serving.primary/research`, `cookbook.revenue.potential`, `cookbook.state.scanning/recommending/pullError`, EN+TR çift (Lingui, `src/locales/{en,tr}.ts`).
- App.tsx `tabs[]`'a `cookbook` ekleme + `activeTab === "cookbook" && <CookbookPanel/>` mount noktası (`00-shell-nav.md` **OPS grubu**).
- Capability-gate: mevcut model/owner permission'ına bağla (`isTabEnabled` + `.env` `MODULE_COOKBOOK` toggle; backend O7.2).
- **Cockpit birleştirme notu:** `CookbookPanel` mevcut `ModelsPanel`'i **genişletir** (yeni izole panel yerine "neden bu model?" detay-drawer'ı ekler); `ProviderLeaderboard`/`CouncilPanel` yerinde kalır (perf/calibrate ayrı iş). Dağınık model-UI **tek cookbook girişi** altında keşfedilir (KN-birleştirme).

---

## 8. Kabul Kriteri (bu cookbook brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] **Donanım kartı:** algılanan chip + RAM(16GB) + GPU/VRAM(unified) + cores + fit-eşiği rozeti (≤70% RAM) + Yeniden-tara.
- [ ] **Fit-score'lu öneri grid:** 6 model kartı (3 uyumlu / 2 sınırda / 1 yetersiz), her kart boyut+quant+~tok/s + uyum rozeti (✓/⚠/✗) donanıma göre renklendirilmiş; ✗ kart önerilmez (line-through).
- [ ] **qwen3:8b PRIMARY vurgu:** geniş kart + score-bar + reason + optimalConfig satırı + "Copy working-prompt" + "$0-local PRIMARY" rozeti.
- [ ] **Pull-progress:** primary kurulu değilse "Install qwen3:8b ($0 primary)" + progress bar; kuruluysa "resident ✓".
- [ ] **Serving-config:** primary endpoint (OLLAMA_HOST) + ayrı research endpoint (dual-model) göster/set.
- [ ] **Gelir köprüsü:** "bu donanım gelir potansiyeli: ~N testgen/saat · $0 maliyet (potansiyel/kaba)" → revenue link; **abartı yok**.
- [ ] **Görev filtresi:** chat/code/embed + boyut + kaynak (ollama/gguf).
- [ ] **4 durum** (taranıyor / öneri-yükleniyor / pull-hatası / dolu) ayrı frame; hata'da **sahte-installed YOK**, non-blocking.
- [ ] **Responsive:** desktop 2–3 kolon grid + tablet tek-kolon (primary üstte).
- [ ] Dark + light token-driven parity (`dark:` prefix yok).
- [ ] a11y: donanım kartı `role="status"`, grid `role="list"`, fit rozeti **metin-tabanlı** (renk-only değil), score-bar `aria-valuenow`, pull `role="progressbar"` + `aria-live`, scroll-region keyboard-reachable, focus-visible, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mock→real map` + `/api/cookbook/*` sözleşme kilidi + fit-tek-kaynağı notu + i18n checklist.
- [ ] **Üç mevcut panel (`ModelsPanel`/`ProviderLeaderboard`/`CouncilPanel`) içeriği KOPYALANMADI** — yalnız kart-grid / perf-tablo / SSE-progress deseni emsal (K1 koruma).

---

## 9. Kör-Nokta Ledger (CRITICAL gizleme yasak — ilk sıra)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **RİSK (hw-detect mock)** | Donanım kartı (RAM/GPU/VRAM/chip/cores) statik-HTML'de **sahte/sabit** (16GB mock); gerçek `detectHardware` (sysctl parse) yok — canvas gerçek makineyi okuyamaz. | Orta — kullanıcı mock-donanımı gerçek sanabilir | Claude Design yalnız görsel kart üretir; gerçek `detectHardware` (`optimize.parseSysctl`, canlı sysctl) **Claude Code** işi (`05-features` O7.1). UI mock 16GB; handoff'ta `sys` alanına bağlanır (mock→real map) |
| **KN2** | **RİSK (pull-progress sahteliği)** | "Install qwen3:8b" pull-bar statik-HTML'de **sahte** görünür (gerçek SSE yok); canvas `ollama pull` stream üretemez. | Orta — handoff'ta canlı progress sıfırdan bağlanır | Claude Design yalnız görsel progress-bar + %-durum üretir; gerçek SSE (`POST /api/cookbook/pull` `{type:"progress",pct}`) **Claude Code** işi (`CouncilPanel` EventSource deseni; O7.4). Pull-hatası durumu (§4-3) sahte-installed'ı yasaklar |
| **KN3** | **RİSK (gelir-köprü optional / abartı)** | Gelir-hook ("~N testgen/saat · $0") **satış-vaadi** gibi durabilir; ayrıca `monetizeProjection` backend O7.6'ya bağlı, henüz YOK — panel gelir olmadan da anlamlı olmalı. | Orta — sahte-güven / yanıltma (fluency-as-truth) | Hook **opsiyonel** + "potansiyel/kaba tahmin" etiketi zorunlu (UI kopyası); backend yoksa satır **gizlenebilir** (panel çekirdeği = öneri, gelir ikincil). Abartısız muhafazakâr sabit; `05-features` KN-5 paralel. Panel gelir-köprü olmadan da ship-edilebilir olmalı |
| **KN4** | **BİRLEŞTİRME (dağınık cockpit-panel)** | Model-UI üç yerde dağınık (`ModelsPanel`+`ProviderLeaderboard`+`CouncilPanel`); cookbook eklenince **dördüncü model-yüzey** olup dağınıklığı artırma riski. | Orta — keşfedilebilirlik düşer, tekrar | Cookbook `ModelsPanel`'i **genişletir** (yeni izole panel değil — detay-drawer + score/reason/config eklenir; §7 birleştirme notu). `ProviderLeaderboard`/`CouncilPanel` perf/calibrate için yerinde kalır (farklı amaç). Tek cookbook girişi = dağınık model-UI'ın keşif-noktası |
| **KN5** | **RİSK (iki fit-mantığı)** | `rankMacModels` (size-fit RAM×0.7) ↔ `optimize` (score-fit RAM×0.8) **iki farklı eşik**; UI iki panelde iki farklı "fit" gösterirse tutarsız. | Orta — UI güven kaybı (0.7 vs 0.8) | UI ✓/⚠/✗ **tek** kaynaktan (`optimize.vramFit` + correctness-gate); backend O7.1 REFACTOR `rankMacModels`'i cookbook `fits`'e delege eder. UI iki eşik göstermez; HANDOFF.md fit-tek-kaynağı notu (`05-features` KN-7 paralel) |
| **KN6** | **VARSAYIM (backend sözleşmesi)** | `/api/cookbook/*` ailesi + `optimize.ts` server-import (`server/cookbook.ts`) `05-features` O7 planından; kod henüz YOK (`grep cookbook server/` = 0). UI mock bu şemaya göre; sözleşme değişirse mock→real map kayar. | Orta | HANDOFF.md mock→real map + sözleşme-kilidi; backend O7.1-O7.2 yeşil olmadan panel ship EDİLMEZ (K7); alan adları backend planıyla senkron; `optimize` **import** (kopya değil) doğrulanır |
| **KN7** | **KAPSAM (llama.cpp / gguf discovery)** | Kaynak ikonu (ollama/gguf) mock; gerçek `.gguf` tarama (`scanGgufModels`, yol `~/.cache`/`models/`) makineye göre değişir, ollamas şu an yalnız Ollama tarıyor. | Düşük | UI mock 1 gguf kartı (mistral-nemo); gerçek discovery **Claude Code** işi (O7.4, env-configurable `GGUF_MODEL_DIRS`); bulunamazsa ollama listesi yeterli (sessiz-boş, `05-features` KN-4). Kaynak-ikonu görsel ayrımı yeterli |
| **KN-M** | **KAPSAM (mobil)** | Mobil (<768px) tasarımı bu belge dışı; 2–3 kolon grid + geniş primary kart dar viewport'ta bozulabilir. | Düşük | Tablet tek-kolon (primary üstte) belge içi; mobil detay ayrı iş; `03-ui` §2.8 genel kriter |
| **KN-DS** | **VARSAYIM (design-system ön-koşul)** | `01-design-system.md` mevcut/tam kabul edildi; token'lar `src/styles/tokens.css`'ten sadık. Score-bar/fit-rozeti/pull-bar için özel token yok — mevcut status renkleri (ok/warn/err/info) + accent-indigo kullanılır. | Düşük | `tokens.snippet.css` brief'e gömülür; ilk export'ta token-remap denetimi; fit-rozeti/score-bar mevcut status paletinden türetilir (yeni token gerekmez) |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `src/components/CookbookPanel.tsx` (ModelsPanel genişletme) + `server/cookbook.ts` (`optimize.ts` **import**, hw-detect + recommend + guided-pull SSE + monetize) TDD ile (`05-features/cookbook-models.md` O7.1-O7.6). Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN1/KN2/KN6 gate). Backend sözleşmesi + `optimize` reuse kilitlenmeden panel ship EDİLMEZ; yeni skorlayıcı YAZILMAZ.
