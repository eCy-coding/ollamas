# ODYSSEY-DESIGN — Panel: Research (deep_research + SearXNG) (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/research.md`
> **Odak:** Research paneli — odysseus `deep_research` + self-host **SearXNG** meta-search UI'ı. Araştırma-sorgusu → **çok-adımlı ilerleme** → **kaynak sentezi** → **alıntılı rapor**.
> **Kritik ayrım (kör-noktayı ilk sıraya koyuyoruz):** ollamas'ta bir research-UI **YOK**. `ECySearcherPanel` = **threat-intel** paneli (domain/IP/CVE göstergesi arama, ayrı Flask stack), **web-research DEĞİL**. Bu panel **sıfırdan** Claude Design'da tasarlanır; `ECySearcherPanel` yalnız **yeniden-kullanılabilir UI iskeleti** (liste/kart/refresh deseni) için emsaldir, içerik tamamen farklıdır.
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** (backend/API/localhost/SSE YOK, mock-veri). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Durum (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10) — `src/components/ECySearcherPanel.tsx`, `docs/odyssey/05-features/research-searxng.md`, `docs/odyssey/03-claude-design-ui.md` §3.2.

### 1.1 Research-UI durumu: **YOK** (bu belgenin konusu)

- **Research paneli YOK.** `03-claude-design-ui.md` §1.4: "araştırma sorusu → ilerleyen adımlar → atıflı rapor" gösteren bir Research sekmesi mevcut değil. `src/App.tsx` `tabs[]` içinde `research` **yok** (mevcut arama-benzeri sekmeler: `search` = GitHub kod arama, `threatintel` = tehdit-intel).
- **Çok-adımlı araştırma döngüsü YOK / rapor sentezi YOK / atıflı çıktı YOK.** `05-features/research-searxng.md` §1.2: `runDeep()` tek-sorgu → top-N fetch → düz JSON döndürür; `plan → alt-sorgu → tur-tur topla → boşluk-analiz → sentez` iteratif orkestrasyon yok; atıflı Markdown rapor üretimi yok.
- **SearXNG backend YOK.** Kodun hiçbir yerinde `SEARXNG` / `SEARCH_BACKEND` env'i yok; tek arama yolu DuckDuckGo HTML-scrape (bloklanabilir). SearXNG bu panelin **birincil kaynağı** olarak backend planında (`05-features/research-searxng.md` FAZ 0) tasarlanıyor.
- **Server route YOK.** `server.ts`'te `/api/research*` yok; oturum/geçmiş saklama yok (stateless host-tool çağrısı).

### 1.2 `ECySearcherPanel` = **yanlış temel** (karıştırma yasağı) — ama UI iskeleti emsal

| Boyut | `ECySearcherPanel.tsx` (mevcut) | Research paneli (hedef) | Karar |
|---|---|---|---|
| Amaç | Threat-intel: domain/IP/CVE göstergesi arama | Web deep-research: soru → sentez → rapor | **Farklı içerik** — kopyalanmaz |
| Backend | ayrı Flask+Postgres+Redis docker stack (`/api/ecysearcher/*`) | SearXNG proxy + `server/research/*` (yeni) | Farklı |
| Çıktı | düz gösterge listesi (`threats/domains/ips`) | çok-adımlı ilerleme + **atıflı rapor** | Farklı |
| **Yeniden-kullanılacak UI deseni** | "Canlı Tehdit Akışı" liste/kart/refresh (`ECySearcherPanel.tsx:188-227`), input+Ara satırı (`:229-244`), honest boş-durum (`:167-175`, `:251-253`), UP/DOWN durum-pill (`:136-138`) | Liste/kart iskeleti, sorgu-input, honest-empty, durum-pill | **Reuse (yalnız iskelet)** |

> **Not (K1 ilk-sıra):** Bu panel için `ECySearcherPanel`'in **veri modeli, endpoint'leri, threat-severity semantiği kopyalanmaz** — yalnız görsel liste/kart/input/durum deseni emsal alınır. İçerik = deep-research (soru/adım/kaynak/rapor), threat-intel değil.

### 1.3 Backend bağımlılığı (bu UI panelinin arkasındaki iş — ayrı plan)

Research paneli **frontend-only** Claude Design işidir; ama gerçek veri için `05-features/research-searxng.md`'deki backend gerekir. UI, o backend'in **API sözleşmesine** göre mock'lanır:

- `POST /api/research { question, deep? }` → `{ report, sources[], rounds[] }` (FAZ 4, henüz YOK).
- (Opsiyonel) `GET /api/research/stream` → SSE tur-tur ilerleme (odysseus-tarzı canlı).
- Backend hazır değilken UI **mock-veri** ile tasarlanır; Claude Code handoff'ta bu sözleşmeye bağlanır (K3, K7).

---

## 2. Hedef Research Paneli — odysseus `deep_research` parity

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır; gerçek SearXNG fetch, SSE canlı-akış, `runResearch` orkestrasyonu **Claude Code handoff** aşamasında `server/research/*` + `src/components/ResearchPanel.tsx`'e implemente edilir. Claude Design yalnız **görsel iskeleti + 4 mock durumu** üretir.

**Panel anatomisi (iki-bölge, boğmayan düzen — `03-ui` §2 kriter 1):**

```
┌─ ÜST: sorgu bandı ───────────────────────────────────────────
│  [geniş arama kutusu]  [derinlik: Quick ▸ Deep]  [Araştır]
│  kaynak toggle'ları: ◉ web/SearXNG  ○ threat-feed  ○ GitHub
├─ ORTA: çok-adımlı ilerleme (canlı akış) ─────────────────────
│  ① sorgu planı üretildi        (3 alt-sorgu · ✓)
│  ② N kaynak çekiliyor          (SearXNG · fetch → extract · progress)
│  ③ kaynaklar özetleniyor       (summarize · 3/5)
│  ④ çelişki/boşluk doğrulandı   (verify · ✓)
│  ⑤ rapor sentezleniyor         (synthesize · …)
├─ ALT: sonuç (iki-kolon) ─────────────────────────────────────
│  SOL (geniş): cited rapor — paragraflar + [1][2] atıf çipleri
│               + yönetici-özeti + tematik bölümler
│  SAĞ (dar):   kaynak listesi — [n] başlık · domain · tarih · ⧉aç
├─ SOL-RAY (opsiyonel): geçmiş araştırmalar (kaydet/aç)
```

**Adım-vokabüleri (odysseus `deep_research` pipeline eşlemesi — `05-features/research-searxng.md` §2):**
`plan (topic_analyzer)` → `fetch (SearXNG + web-extract)` → `summarize (RESEARCH_MODEL)` → `verify (boşluk-tespit → nextQueries)` → `synthesize (atıflı report)`. Bu 5 adım **mock ilerleme kartlarının** birebir etiketidir.

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul). Backend olmadığı için **tüm veri mock**tur.

```
[GOAL]
Design a "deep research" panel for a self-hosted, local-first AI workspace
("ollamas", odysseus-parity). A user asks one research question; the panel runs a
MULTI-STEP pipeline (plan → fetch sources → summarize → verify → synthesize) with
VISIBLE progress, then shows a CITED report next to a numbered source list. This
is NOT a plain search box and NOT threat-intel — it is iterative, multi-source,
fact-checked research that ends in a report with inline [n] citations.

[LAYOUT]
- Full-height panel, two logical zones stacked, then a two-column result.
- QUERY BAND (top): a wide search textarea (placeholder "Bir araştırma sorusu
  sor…"), a depth selector segmented control [Quick | Deep], a primary "Araştır"
  button, and a row of source toggles (web/SearXNG default-on, threat-feed off,
  GitHub off).
- PROGRESS STREAM (middle): a vertical list of NUMBERED step cards, one per
  pipeline stage. Each card = step number + stage label + a status
  (queued/running/done/failed) + a compact metric (e.g. "3 sub-queries",
  "5 sources fetched", "3/5 summarized"). Stages, in order:
    ① Plan       — sub-queries generated
    ② Fetch      — SearXNG search + readable-extract, N sources
    ③ Summarize  — per-source summary (keeps source URL)
    ④ Verify     — gap/contradiction check → maybe new queries
    ⑤ Synthesize — cited report assembled
  Running card shows a progress affordance + spinner; done card shows a check +
  its metric; the currently-running one is visually emphasized.
- RESULT (bottom, two columns):
  • LEFT (wide): the CITED REPORT — an executive summary paragraph, then themed
    sections, prose with inline citation chips "[1]" "[2]" (small pill, hover =
    source title). No claim without a citation chip.
  • RIGHT (narrow): the SOURCE LIST — numbered [1..n] rows: favicon/domain dot +
    title (truncate) + domain + date + an external-open icon. Clicking a citation
    chip scrolls/highlights its source row (and vice-versa).
- HISTORY RAIL (optional left, collapsible): past research runs (question snippet
  + date), plus a "Save" affordance on the current run.

[CONTENT]
Mock a full run for the question: "Yerel LLM'ler gizlilik açısından bulut
modellerden neden daha güvenli?".
  • Plan step: 3 sub-queries ("local LLM data residency", "cloud LLM data
    retention policy", "on-device inference privacy").
  • Fetch step: 5 sources.
  • Summarize: 5/5 done.
  • Verify: 1 gap found → 1 follow-up query, then done.
  • Synthesize: done.
Report (mock, ~3 short sections) with inline [1]–[5] citations. Source list of 5:
  [1] "On-device inference & data residency" · arxiv.org · 2025-11
  [2] "Cloud LLM retention: what providers keep" · eff.org · 2026-01
  [3] "Self-hosting Ollama for privacy" · ollama.com · 2025-09
  [4] "SearXNG: tracking-free meta-search" · docs.searxng.org · 2026-02
  [5] "GDPR & LLM data processing" · edpb.europa.eu · 2025-12
Depth "Deep" should imply more rounds/sources than "Quick" (hint in UI copy).

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Citation chips + source numbers use mono. Progress "running" uses info/indigo,
"done" uses ok-green, "failed" uses err-rose. Dark is primary; ALSO produce a
light variant (token-driven, no dark: prefixes). Motion: fade-in 0.25s, step
cards animate in as they start; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR states:
  1. EMPTY (no research yet) — centered query box + 3 example-question suggestion
     chips ("Ask anything…"); progress + result zones absent or ghosted.
  2. RESEARCHING (in progress) — steps ①–③ done, ④ running (spinner + "verify…"),
     ⑤ queued; result area shows a skeleton/"synthesizing…" placeholder; the
     "Araştır" button is disabled / shows "Durdur" (cancel).
  3. ERROR (SearXNG down) — an amber non-blocking banner "SearXNG unreachable —
     falling back to DuckDuckGo" OR, if no backend at all, an honest empty result:
     "Araştırma tamamlanamadı — arama servisi erişilemiyor" with a retry. NEVER a
     fabricated report.
  4. FILLED (done) — all 5 steps done (collapsible into a compact "5 steps ·
     6 sources · 2 rounds" summary bar), full cited report on the left, numbered
     source list on the right.
Responsive:
  • DESKTOP (≥1024px): report + source list side-by-side two-column.
  • TABLET (768–1023px): source list moves BELOW the report (single column);
    progress stream stays full-width; history rail becomes a drawer.
Keyboard-first: ⌘↵ / Enter runs research, esc cancels a running run, clicking a
[n] chip focuses its source. Accessibility: progress list role="list" with
aria-live="polite" for step updates, citation chips are real <a>/<button> with
aria-label "Kaynak n", source list role="list", focus-visible rings, contrast AA.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Panel görünümü | Kritik detay (honest / anti-halüsinasyon) |
|---|---|---|
| **1. Boş araştırma** | Ortada sorgu kutusu + 3 örnek-soru öneri çipi; ilerleme + sonuç bölgeleri yok/hayalet | Keşif: örnek sorular. Henüz hiçbir adım yok |
| **2. Araştırıyor (progress)** | Adım ①–③ done, ④ `verify…` running (spinner), ⑤ queued; sonuç skeleton "synthesizing…"; buton → `Durdur` | **Progress mock** — statik canvas'ta "running" görseli sahte, gerçek SSE handoff'ta (K-progress) |
| **3. Hata (SearXNG down)** | Amber non-blocking banner `SearXNG unreachable → DuckDuckGo fallback`; backend hiç yoksa honest-empty `Araştırma tamamlanamadı — arama servisi erişilemiyor` + retry | **Asla uydurma rapor** — kaynak yoksa boş-durum; DDG-fallback banner (backend §P2) |
| **4. Dolu (rapor)** | 5 adım done (kompakt `5 adım · 6 kaynak · 2 tur` özet-barına katlanır); solda atıflı rapor, sağda numaralı kaynak listesi; `[n]` çipi → kaynak vurgu | happy-path referans; her iddia `[n]` atıflı, atıfsız cümle yok |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema).

---

## 5. Responsive (desktop + tablet)

| Viewport | Rapor + kaynak düzeni | İlerleme akışı | Geçmiş rayı |
|---|---|---|---|
| **Desktop (≥1024px)** | Yan-yana iki-kolon (rapor geniş sol, kaynak dar sağ) | Tam-genişlik dikey adım kartları | Sol katlanabilir ray |
| **Tablet (768–1023px)** | Tek-kolon: kaynak listesi rapor **altına** iner | Tam-genişlik (korunur) | Drawer'a daralır |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` §2.8 "mobil bozulmayan grid" genel kriteri geçerli; detay tasarımı ayrı iş (Kör-Nokta KN5).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk iskeleti üretir (muhtemel: düz arama kutusu + sonuç listesi, adım-akışı zayıf).
2. **İnline-comment #1:** "Orta bölgeye 5 numaralı adım kartı ekle (Plan/Fetch/Summarize/Verify/Synthesize), her kart status + metrik; running kartı vurgulu + spinner."
3. **Chat iterasyon #2:** "Alt sonucu iki-kolona böl: solda atıflı rapor (`[1][2]` inline çip), sağda numaralı kaynak listesi. Çip → kaynak satırını vurgula."
4. **İnline-comment #3:** "Sorgu bandına derinlik seçici (Quick/Deep) + kaynak toggle'ları (web/SearXNG, threat-feed, GitHub) ekle."
5. **Chat iterasyon #4:** "4 durumu ayrı frame üret: boş (örnek sorular) / araştırıyor (④ running) / hata (SearXNG down banner + honest-empty) / dolu (kompakt özet-bar + tam rapor)."
6. **İnline-comment #5:** "Light varyantı token-driven üret (dark: prefix yok). Tablet varyantı: kaynak listesi rapor altına, geçmiş ray'ı drawer."
7. **İnline-comment #6:** "Atıf çiplerini gerçek link/button yap (aria-label 'Kaynak n'); kaynak yoksa boş-durum metnini honest tut (uydurma rapor YOK)."
8. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (K1 azaltma; shell paneli export'u varsa onunla hizala).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/research/` altına:

```
research/
  PROMPT.md              # §3'teki tam brief (token + mock + 4-state)
  research.html          # Claude Design export (self-contained, inline CSS)
  screenshot-empty.png   # 4 durum × dark
  screenshot-researching.png
  screenshot-error.png
  screenshot-filled.png
  screenshot-*-light.png # her durumun light varyantı
  screenshot-tablet.png  # tek-kolon (kaynak rapor altında) + drawer
  HANDOFF.md             # ↓ zorunlu içerik
  tokens.snippet.css     # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  STEP_CARD.spec.md      # çok-adımlı ilerleme kartı prop imzası + status enum
  CITATION_CHIP.spec.md  # [n] atıf çipi prop imzası + kaynak-eşleme sözleşmesi
  SOURCE_LIST.spec.md    # numaralı kaynak listesi satır imzası (title/domain/date/url)
```

**HANDOFF.md zorunlu içeriği:**
- Component ağacı: `ResearchPanel` → `QueryBand` / `ProgressStream(steps[])` → `StepCard` / `ResultView` → `CitedReport` + `SourceList(sources[])` / `HistoryRail`.
- **Mock→real map:** her mock alanı hangi `/api/research` sözleşme alanına bağlanır:
  - progress kartları → `POST /api/research` `rounds[]` (veya `GET /api/research/stream` SSE tur-tur).
  - rapor → `report` (Markdown → `marked`+`dompurify` sanitize, `documents` paneliyle aynı karar).
  - kaynak listesi → `sources[]` (`{title, url, domain, date}`; `[n]` index = citation index).
- **Backend sözleşmesi:** `05-features/research-searxng.md` FAZ 4 (`POST /api/research`, permission-guard, demo-mode fixture, SearXNG-down→DDG fallback). UI, backend hazır olmadan **mock**la ship EDİLMEZ — sözleşme kilitli olmalı.
- i18n anahtar listesi: yeni `research.query.placeholder`, `research.depth.quick/deep`, `research.step.plan/fetch/summarize/verify/synthesize`, `research.source.open`, `research.empty.suggest`, `research.error.searxngDown/backendDown`, EN+TR çift (Lingui, `src/locales/{en,tr}.ts`).
- App.tsx `tabs[]`'a `research` ekleme + `activeTab === "research" && <ResearchPanel/>` mount noktası (`00-shell-nav.md` AI-Workspace grubu).
- Capability-gate: mevcut web-tool permission'ına bağla (`isTabEnabled` + `.env` `ENABLE_RESEARCH` toggle; `03-ui` §3.2, backend §P10).
- Agent tool notu: `server/tool-registry.ts`'e `deep_research` tool eklenecek (bu panelle aynı `runResearch`'ü çağırır; `05-features` FAZ 5).

---

## 8. Kabul Kriteri (bu research brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] **Sorgu bandı:** geniş kutu + derinlik seçici (Quick/Deep) + kaynak toggle'ları + Araştır butonu.
- [ ] **Çok-adımlı ilerleme:** 5 numaralı adım kartı (Plan→Fetch→Summarize→Verify→Synthesize), status + metrik, running vurgulu.
- [ ] **Kaynak sentezi:** iki-kolon sonuç — solda rapor, sağda numaralı kaynak listesi.
- [ ] **Alıntılı rapor:** her iddia `[n]` inline çip + numaralı kaynak listesi; **atıfsız cümle yok**; çip↔kaynak çift-yönlü vurgu.
- [ ] **4 durum** (boş / araştırıyor / hata-SearXNG-down / dolu) ayrı frame; hata'da **honest-empty, uydurma rapor YOK**.
- [ ] **Responsive:** desktop iki-kolon + tablet tek-kolon (kaynak rapor altında) + drawer geçmiş.
- [ ] Dark + light token-driven parity (`dark:` prefix yok).
- [ ] a11y: progress `role="list"` + `aria-live="polite"`, atıf çipleri gerçek link/button (`aria-label "Kaynak n"`), kaynak listesi `role="list"`, focus-visible, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mock→real map` + `/api/research` sözleşme kilidi + i18n checklist.
- [ ] **`ECySearcherPanel` içeriği KOPYALANMADI** — yalnız liste/kart/input/durum-pill deseni emsal (K1 koruma).

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **KARIŞIKLIK (yanlış temel)** | `ECySearcherPanel` research sanılabilir; aslında threat-intel (ayrı Flask stack, `ECySearcherPanel.tsx:5-8`). İçeriği kopyalanırsa panel threat-intel'e sapar. | Yüksek — tüm panel yanlış modele oturur | §1.2 ilk-sıra ayrım; yalnız görsel iskelet reuse (liste/kart/input/durum), veri-modeli/endpoint DEĞİL; §8 son madde koruma-check |
| **KN2** | **RİSK (progress-mock sahteliği)** | Çok-adımlı "running" ilerleme statik-HTML'de **sahte** görünür (gerçek SSE yok); canvas prototip keydown/stream üretemez. | Orta — handoff'ta canlı akış sıfırdan kodlanır | Claude Design yalnız görsel adım-kartı üretir; gerçek tur-tur ilerleme (SSE veya poll) **Claude Code** işi (`05-features` FAZ 4/5, K7 paraleli); MVP poll ile başla |
| **KN3** | **RİSK (atıf-format / halüsinasyon)** | Rapor `[n]` atıf formatı UI'da mock; gerçek backend atıfsız/uydurma iddia üretirse UI "güvenilir rapor" yanılsaması verir. | Yüksek — sahte-güven (fluency-as-truth) | UI sözleşmesi: **atıfsız cümle render edilmez**; kaynak yoksa honest-empty (§4 durum 3); backend anti-halüsinasyon `05-features` §P5 (yalnız `gathered`'dan yaz, atıf zorunlu) — UI ve backend aynı kuralı paylaşır |
| **KN4** | **RİSK (SearXNG down davranışı)** | SearXNG erişilemezse UI ne gösterir belirsiz — sessiz boş mu, DDG-fallback banner mı, honest-error mı. | Orta — kullanıcı "araştırma çalışmıyor" sanır | §4 durum 3 iki yol: (a) DDG-fallback amber banner (backend fail-soft var, §P2), (b) hiç backend yoksa honest-empty + retry. Sessiz-boş YASAK |
| **KN5** | **KAPSAM (mobil)** | Mobil (<768px) tasarımı bu belge dışı; iki-kolon rapor+kaynak dar viewport'ta bozulabilir. | Düşük | Tablet tek-kolon (kaynak rapor altında) belge içi; mobil detay ayrı iş; `03-ui` §2.8 genel kriter |
| **KN6** | **VARSAYIM (backend sözleşmesi)** | `POST /api/research { question, deep }` → `{report, sources, rounds}` sözleşmesi `05-features` planından; kod henüz YOK. UI mock bu şemaya göre yapıldı, sözleşme değişirse mock→real map kayar. | Orta | HANDOFF.md'de mock→real map + sözleşme-kilidi; backend FAZ 4 yeşil olmadan panel ship EDİLMEZ (K7); alan adları backend planıyla senkron |
| **KN7** | **VARSAYIM (design-system ön-koşul)** | `01-design-system.md` mevcut/tam kabul edildi; token'lar `src/styles/tokens.css`'ten sadık. Citation-chip/step-card için özel token yok — mevcut status renkleri (info/ok/err) kullanılır. | Düşük | `tokens.snippet.css` brief'e gömülür; ilk export'ta token-remap denetimi; step/chip mevcut status paletinden türetilir (yeni token gerekmez) |
| **KN8** | **VARSAYIM (odysseus modül isimleri)** | `deep_research` / `topic_analyzer` / adım-vokabüleri (plan/fetch/summarize/verify/synthesize) `05-features` planından; odysseus repo doğrulanmadı. | Düşük | Parity'yi davranışa değil listelenen alt-yeteneklere göre tanımladık; adım etiketleri ollamas backend FAZ'larıyla (0-3) birebir eşlenir |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `src/components/ResearchPanel.tsx` + `server/research/*` (SearXNG proxy + iteratif engine + atıflı rapor) TDD ile (`05-features/research-searxng.md` FAZ 0-5). Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN2/KN3/KN6 gate). Backend sözleşmesi kilitlenmeden panel ship EDİLMEZ.
