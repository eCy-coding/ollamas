# ODYSSEY-DESIGN — HANDOFF-PIPELINE (Claude Design → Claude Code Operasyonel Boru Hattı)

> **Belge:** `docs/odyssey/design-execution/HANDOFF-PIPELINE.md`
> **Rol:** `04-handoff-protocol.md`'nin (design→kod, 8-adım) **OPERASYONELLEŞTİRİLMİŞ** hâli — tüm 9 panelin ortak, tekrarlanabilir, panel-panel çalıştırılabilir handoff hattı. 04 = *protokol* (NASIL çevrilir); bu belge = *boru hattı* (her panel için AYNI sırayla NE yapılır, hangi klasöre, hangi dosya, hangi gate).
> **Odak:** Claude Design'da tasarlanan her panelin `Export` + `Handoff to Claude Code` bundle'ı → `docs/odyssey/handoff/<panel>/` → mevcut ollamas **Vite + React 19** component'ine implementasyon → token remap → `apiClient` bağlama → test → gate.
> **Kaynaklar (koda karşı DOĞRULANMIŞ, 2026-07-10):** `04-handoff-protocol.md` (8-adım + panel-checklist), `design-execution/panels/chat.md` (PİLOT, 6-dosya bundle spec), `design-execution/01-design-system.md` (token ön-koşul), `design-execution/panels/00-shell-nav.md` (shell/nav), `src/lib/apiClient.ts` (tek I/O choke-point), `src/main.tsx` (provider ağacı), `vite.config.ts` (PWA + SSE untouched).
> **Dil:** TR (anlatı) · kod/komut/dosya-yolu/prop-adı EN.
> **Üretim tarihi:** 2026-07-10.

---

## 0. Handoff Hattı — Genel Bakış

```
Claude Design (claude.ai/design)                        Claude Code (bu repo)
─────────────────────────────────                       ──────────────────────────────
01-design-system.md (token kur, 1×)
        │
   panel prompt (03 §3.x / panels/<p>.md §2)
        │  iterasyon: chat + inline-comment + slider
        ▼
   [Export] HTML.zip/PDF/PPTX  ─┐
   [Handoff to Claude Code]     ├──►  bundle = full HTML/CSS/JS + screenshot +
        │                       │      README(conversation+design-intent) + component-list
        ▼                       ┘
   docs/odyssey/handoff/<panel>/  ◄── bundle burada iner (screenshot-restart DEĞİL:
        │                              Claude Code bundle'dan DEVAM eder)
        ▼
   ┌─────────────────────── 7-AŞAMALI BORU HATTI (§2) ───────────────────────┐
   │ Design-export → bundle-yerleştir → Claude-Code-implemente →              │
   │ token-uygula → apiClient-bağla → test → gate                            │
   └─────────────────────────────────────────────────────────────────────────┘
        ▼
   src/components/<Panel>.tsx  +  i18n(EN/TR)  +  App.tsx mount  +  testler  →  gate ✓  →  commit
```

**Handoff mekaniği (DOĞRULANMIŞ):** Claude Design'ın **iki çıkış butonu** var — (a) `Export` → `HTML.zip` / `PDF` / `PPTX`; (b) `Handoff to Claude Code` → **bundle** (full HTML/CSS/JS + screenshot + README[conversation + design-intent] + component-list). Claude Code bundle'dan **devam eder** (ekran-görüntüsünden-sıfırdan-başlama DEĞİL). **Büyük repo tuzağı:** Claude Design'a >10MB paste etme; bunun yerine Claude Code'dan `/design-sync` çalıştır (repo bağlamını Design'a taşır). **Çıktı statik-HTML'dir** → canlı veri, SSE, auth Claude Code'da eklenir (§2 Aşama 5).

**Değişmez kural (04 §0'dan devralınır):** Claude Design frontend-only UI-tasarım aracıdır — backend/DB/host üretmez, `/api/*` çağıramaz, canlı state/SSE/auth yoktur. Bundle **mock veriyle** gelir. Tüm iş: ölü-mock UI'ı ollamas'ın canlı `apiClient` + token + i18n + capability katmanlarına **cerrahi** dikmek. **Golden Rule:** bundle = REFERANS, final kod değil — verbatim kopyalanmaz.

---

## 1. Bundle Standart Yapısı — `docs/odyssey/handoff/<panel>/`

> Her panelin handoff bundle'ı **AYNI standart iskeleti** izler. 04 §Adım-1 (5-dosya denetimi) + chat.md §5 (6-dosya + spec) burada birleştirildi. `<panel>` = tab-id (örn. `chat` = `react-agent`, `documents`, `research`, `notes`, `email`, `calendar`, `settings`, `cookbook`, `shell`).

```
docs/odyssey/handoff/<panel>/
  PROMPT.md            # §2'deki TAM Claude Design prompt'u (token + mock + 4-state) — arşiv/yeniden-üretim kaynağı
  design.html          # Claude Design "Handoff to Claude Code" export (self-contained, inline CSS/JS) — S4 ana ekran
  screenshot.png       # canvas görüntüsü (dark, S4) — görsel parity referansı
  screenshot-light.png # light varyant (S4) — dark/light parity kanıtı
  HANDOFF.md           # ÇEVİRİ SÖZLEŞMESİ (aşağıda zorunlu-alanlar)
  tokens.snippet.css   # brief'e gömülen ollamas token alt-kümesi (kaynak: src/styles/tokens.css)
  <PANEL>.spec.md      # panel-özel prop imzası (opsiyonel; örn. TRACE_CARD.spec.md, MODEL_CARD.spec.md)
  # opsiyonel ek 4-state kanıtı (PİLOT için ÖNERİLEN):
  screenshot-s1.png    # boş/greeting · screenshot-s2.png streaming · screenshot-s3.png hata/retry
```

### 1.1 `HANDOFF.md` — zorunlu alanlar (ÇEVİRİ SÖZLEŞMESİ)

> Bu dosya boru hattının **tek en kritik girdisidir**. Eksikse → **DUR**, Emre'den iste (screenshot'tan el-yazımı YASAK). İçermesi zorunlu 6 alan:

| Alan | İçerik | Kaynak / bağlanacağı yer |
|---|---|---|
| **1. Component adı** | `ReactAgentTab` (GENİŞLET) veya `<Panel>Panel` (YENİ) + opsiyonel alt-component'ler (`ToolCallCard`, `ReasoningTrace`) | 04 §Adım-2 reuse-first tablosu |
| **2. Prop imzası** | Ana prop (`{ onNotify(msg,type) }` vb.) + alt-component prop'ları | `<PANEL>.spec.md` → `src/types.ts` interface |
| **3. i18n anahtar listesi** | `app.tab.<id>` + tüm `<panel>.*` anahtarları (EN mock'tan çıkarılan) | `src/locales/{en,tr}.ts` (EN==TR eşit sayı) |
| **4. `/api` sözleşmesi (mock→real map)** | Tasarımın her mock array'i → gerçek `apiClient` çağrısı + endpoint + method + `{soft?}` | `apiClient` (§2 Aşama 5) + 05-features |
| **5. 4-durum listesi** | S1 loading/greeting · S2 streaming · S3 error/retry · S4 dolu → mevcut state'lere map | §1.6 kanonik 4-durum blok |
| **6. Kör-nokta notu** | Panelin H1–H10'dan geçerli riskleri (özellikle backend-yok → H5, güvenlik → K6) | §4 Ledger |

### 1.2 `tokens.snippet.css` — token remap kaynağı (K2 azaltıcı)

> Claude Design **ham hex/px** üretir, `--ollamas-*` değişkeni değil. Bu snippet remap'in kaynağıdır. `01-design-system.md §1`'den ampirik alt-küme:

```css
/* ollamas dark cockpit — remap hedefi (kaynak: src/styles/tokens.css) */
--ollamas-color-bg-base:#050608;    --ollamas-color-bg-sidebar:#08090d;
--ollamas-color-bg-panel:#0a0b10;   --ollamas-color-bg-inset:#04050a;
--ollamas-color-border-subtle:rgba(255,255,255,.05);
--ollamas-color-text-bright:#f8fafc; --ollamas-color-text-muted:#94a3b8;
--ollamas-color-status-accent:#818cf8; --ollamas-color-status-ok:#34d399;
--ollamas-color-status-warn:#fbbf24;   --ollamas-color-status-err:#fb7185; --ollamas-color-status-info:#22d3ee;
/* font: sans=Inter · mono=JetBrains Mono · radius sm3/md8/lg12 · space 4/8/12/16 */
```

**Remap tablosu (ham → utility):** `#0a0b10`→`bg-immersive-panel` · `#08090d`→`bg-immersive-sidebar` · `#050608`→`bg-immersive-bg` · `#6366f1/#818cf8`→`text-status-accent` · `#34d399`→`text-status-ok` · `#fbbf24`→`text-status-warn` · `#fb7185`→`text-status-err` · `rgba(255,255,255,.05)`→`border-immersive-border`. **`dark:` prefix YAZMA** — dark/light paritesi token katmanından gelir.

---

## 2. Panel-Panel Boru Hattı — Checklist (7 aşama, her panel için AYNI)

> 04 §2'nin 8-adım protokolü burada **7 işletilebilir aşamaya** sıkıştırıldı (Adım-1 "bundle-al" ikiye ayrılmadan tek aşama; her aşama = bir checkbox seti). Sıra sabittir. Disiplin: **TDD (test-önce), implementer ≠ verifier, root-cause-önce, evidence-önce** (04 §2, CLAUDE.md T0 kapıları).

### Aşama 1 — DESIGN-EXPORT (Claude Design'da, Emre)
- [ ] `01-design-system.md` token setup oturumda 1× yapıldı (ön-koşul; drift-guard).
- [ ] Panel prompt'u (`PROMPT.md` / `panels/<panel>.md §2`) canvas'a yapıştırıldı, 3-5 iterasyon döngüsü tamamlandı (4-state + dark/light + responsive üretildi).
- [ ] `Handoff to Claude Code` tıklandı → bundle indirildi. **Büyük repo:** Design'a paste yerine Claude Code'dan `/design-sync`.

### Aşama 2 — BUNDLE-YERLEŞTİR (ingest & doğrula)
- [ ] Bundle `docs/odyssey/handoff/<panel>/` altına açıldı (yoksa klasör oluşturuldu; §1 iskelet).
- [ ] **Zorunlu dosyalar var mı:** `design.html`, `screenshot.png`, `HANDOFF.md`, `PROMPT.md`, `tokens.snippet.css` (+ light + panel spec). **Eksikse → DUR**, Emre'den iste (eksik-context el-yazımı YASAK).
- [ ] `HANDOFF.md` okundu → §1.1'in 6 alanı çıkarıldı (component adı, prop, i18n, mock→real map, 4-durum, kör-nokta).
- [ ] `design.html` + `screenshot.png` **niyet** için okundu (layout/hiyerarşi/durum) — inline CSS **değer olarak alınmadı** (K2).

### Aşama 3 — CLAUDE-CODE-İMPLEMENTE (reuse-first + component-yaz)
- [ ] 04 §Adım-2 tablosundan panel **durumu** (VAR/KISMİ/YOK) alındı → GENİŞLET veya YENİ dosya kararı.
- [ ] Tekrar-eden birimler (kart/satır/rozet/çip) mevcut primitive'e eşlendi (`Skeleton`, `Sparkline`, `OfflineBadge`, `CapabilityGate`, status-tone map) — **yeni eşdeğer üretilmedi**.
- [ ] `<PANEL>.spec.md` prop imzası → `src/types.ts` interface (mevcut tip stiliyle).
- [ ] Component iskeleti §1.6 kanonik deseniyle kuruldu: `function`, `useState<T|null>`, `useEffect` (alive+cleanup), 4-durum blok. **Bundle JS = davranış-referansı, kopyalanmadı** (H4 — state DAİMA yeniden yazılır).
- [ ] a11y **elle** eklendi: liste `role="list"/"log"`, akış `aria-live="polite"`, buton `aria-label`, focus-visible, `prefers-reduced-motion` (H7 — bundle a11y garanti etmez).

### Aşama 4 — TOKEN-UYGULA (renk/space/font remap · EN KRİTİK MANUEL ADIM, K2)
- [ ] `tokens.snippet.css` kaynak alındı; her ham hex/px → `--ollamas-*` / `bg-immersive-*` / `text-status-*` utility'ye remap edildi (§1.2 tablosu).
- [ ] **`dark:` prefix YOK** — dark/light token katmanından. Radius `rounded`(8)/`rounded-sm`(3), space `p-4/p-5 gap-1.5..3`, font başlık `font-mono uppercase tracking-wider`.
- [ ] Token'da olmayan yeni renk varsa → `tokens/*.json` + `tokens-light.css` + **`npm run tokens`** regenerate (H9 — `tokens.css` el-ile YASAK; tokens diff commit'e dahil).
- [ ] `screenshot-light.png` ile light varyant göz-doğrulandı (remap iki temada render).

### Aşama 5 — APICLIENT-BAĞLA (mock → canlı)
- [ ] Snapshot/liste → `api.get<T>('/api/<panel>/…', {soft?})`; mutation → `api.post/put/del`; upload → `api.uploadFile`; download → `api.downloadFile`; streaming → `api.streamPost(ep, body, {onChunk,onError,signal})` + `AbortController` cleanup.
- [ ] **Doğrudan `fetch`/`EventSource` YOK** (`apiClient.ts` tek choke-point). Auth wiring **yazılmadı** (`authHeaders()` otomatik). Hata → `ApiError` yakala → 4-durum "error" + `onNotify`.
- [ ] **Endpoint YOKSA (backend O-backend işi, H5):** çağrı `{soft:true}` ile yazıldı ama panel **honest-empty / "not available"** durumuna düşüyor — **çökmüyor**. Backend 05-features'ta gelince mock kaldırılır.

### Aşama 6 — TEST (TDD kırmızı→yeşil) + MOUNT
- [ ] **Test-önce:** `<Panel>.test.tsx` — 4-durum render (loading/empty/error/ok), prop akışı, i18n anahtar varlığı, a11y rol. Testler **kırmızıyken** UI handoff'a göre yazıldı → **yeşile** çekildi.
- [ ] `src/App.tsx` `tabs[]`'a `{ id:"<panel>", icon:<Icon/> }` + mount blok `{activeTab==="<panel>" && <div className="animate-fade-in"><Panel/></div>}`. Yazma/exec varsa `CapabilityGate need="…"` + `TAB_CAPABILITY` map.
- [ ] `src/locales/en.ts` + `tr.ts`'e `app.tab.<panel>` + tüm `<panel>.*` (**EN==TR eşit sayı** — H6; eksik = runtime id sızıntısı).
- [ ] **Nav taşma kontrolü (H8/K4):** ≥24 sekmede `00-shell-nav.md`'nin ⌘K komut-paleti / kategori-grup refactor'ı tetiklenir (ayrı iş, ama mount'ta karar noktası).
- [ ] Görsel parity: `screenshot.png` referans; `mcp__Claude_Preview__preview_*` veya Playwright ile dark+light render doğrulandı.

### Aşama 7 — GATE + SHIP (T0 kapısı)
```
npm run typecheck  ✓   →   npm run lint  ✓   →   npm test (fresh)  ✓   →   commit
```
- [ ] Gate geçmeden commit YASAK (CLAUDE.md Kalite Kapısı). Unused code silindi.
- [ ] **implementer ≠ verifier:** yazan agent ≠ doğrulayan (`ecyproskill:code-reviewer` / `pbvc-runner`). CRITICAL bulgu ilk sırada.
- [ ] Commit: `feat(<panel>): …` conventional. `HANDOFF.md`'ye panelin H-riskleri not düşüldü.

---

## 3. PİLOT Kalibrasyonu — chat paneli ilk export → şablonu ampirik düzelt

> `panels/chat.md §7` bu belgenin **çalıştırma bağımlılığıdır**: chat = `design-execution` altındaki İLK gerçek Claude Design export'u. K1 (export şeması) + K2 (token sadakati) **doğrulanmamış varsayım**. Boru hattı chat'te ampirik test edilir; sonra kalibre şablon diğer 8 panele devrolur.

**Chat pilot çıktısı → bu belgeye geri-yaz (zorunlu):**
1. **Bundle şeması (K1/H1):** `Handoff to Claude Code` gerçekte hangi dosyaları verdi? HTML tek dosya mı / component başına mı? README/component-list formatı? → §1 iskeletini gerçekle karşılaştır, sap → §1 düzelt (+ 04 §Adım-1 + 03 §3).
2. **Token sadakati (K2/H2):** Export inline hex mi CSS-değişkeni mi? `#0a0b10` çıktıda ne göründü? → Aşama 4 manuel remap yükünü ölç; ağırsa "otomatik remap script" görevi ekle.
3. **HTML→React eforu (H3):** `design.html`'i `ReactAgentTab`'a dikmek kaç saat/sapma? → §2 7-aşama gerçekçiliğini doğrula.
4. **i18n boşluğu (H6):** Design EN mock üretti; TR anahtar boşluğu gerçekte kaç anahtar? → §1.1 i18n-checklist yeterliliğini ölç.
5. **Şablon geri-yaz:** 1-4 sapmalarını hem bu belgeye (§1/§2) hem `panels/chat.md §5` + `04 §Adım-1-3`'e yansıt. Diğer paneller kalibre şablonu devralır.

**Chat özel sapmaları (`panels/chat.md`'den, boru hattına giren):** GENİŞLET `ReactAgentTab.tsx` (prop `{onNotify}` **değişmez**, state makinesi KORUNUR); `TRACE_CARD.spec.md` → inline `ToolCallCard`; `api.streamPost('/api/agent/chat')` frame-map (`thought`→trace, `message`→balon, `step`→kart, `paused`→onay, `done`→özet, `error`→S3); streaming imleç **mock** (gerçek token-delta backend Eksen A'ya bağlı, kapsam-dışı).

---

## 4. Sıra — design-system → shell → chat-pilot → kalan-paneller → cross-panel-tutarlılık

> Bağımlılık sırası (04 §3 + `01-design-system.md §0` + `00-shell-nav.md`). Her satır önceki T0 kapısından geçmeden başlamaz.

| # | Aşama | Panel/iş | Neden bu sırada | Bundle klasörü |
|---|---|---|---|---|
| 0 | **Design-system** | `01-design-system.md` token setup (kod değil, Design oturum-kurulumu) | **ÖN-KOŞUL** — tüm panellerin token drift-guard'ı | — (Design canvas) |
| 1 | **Shell** | `00-shell-nav.md` → App-shell + ⌘K nav | Panel mount hedefi; nav taşması burada çözülür (K4) | `handoff/shell/` |
| 2 | **Chat (PİLOT)** | `panels/chat.md` → GENİŞLET `ReactAgentTab` | İlk gerçek export → şablon kalibrasyonu (§3) | `handoff/chat/` |
| 3 | **Documents** | GENİŞLET `WorkspaceTree` + YENİ `DocumentEditor` | VAR backend (KISMİ); `fileWrite` gate deseni erken kurulur | `handoff/documents/` |
| 4 | **Calendar** | GENİŞLET `GoogleCalendarBrowser` → `CalendarPanel` | KISMİ backend; Google-read KORUNUR + CalDAV eklenir | `handoff/calendar/` |
| 5 | **Cookbook** | YENİ `CookbookPanel` | backend YOK → honest-empty deseni (H5) kanıtı | `handoff/cookbook/` |
| 6 | **Research** | YENİ `ResearchPanel` | backend YOK; `streamPost` + SearXNG-down honest-empty | `handoff/research/` |
| 7 | **Notes** | YENİ `NotesPanel` | backend YOK; CRUD + cron-preview | `handoff/notes/` |
| 8 | **Email** | YENİ `EmailPanel` (Gmail'e DOKUNMA) | KISMİ; K7 metadata-only privacy KORUNUR, ayrı IMAP | `handoff/email/` |
| 9 | **Settings/2FA** | GENİŞLET `SecurityPolicies` → `SettingsPanel` | **SON** — K6 güvenlik-kritik: backend TOTP+RBAC yeşil olmadan UI ship YASAK | `handoff/settings/` |
| 10 | **Cross-panel tutarlılık** | 9 panel token/spacing/mono/a11y drift denetimi | Tüm paneller indikten sonra tek-geçiş parity audit | — |

**Cross-panel tutarlılık kontrol (adım 10):** tüm paneller aynı `--ollamas-*` token'dan mı? Başlık stili (`font-mono uppercase tracking-wider`) tutarlı mı? 4-durum + honest-empty her panelde var mı? i18n `app.tab.*` EN==TR? a11y AA her panelde? → drift bulunursa ilgili panel Aşama 4/6'ya geri döner.

---

## 5. Kabul Kriteri (HANDOFF-PIPELINE = boru hattı DONE koşulu)

Bir panelin handoff'u **DONE** sayılır ancak-ve-ancak:

- [ ] **§2'nin 7 aşaması** sırayla uygulandı (design-export → bundle-yerleştir → implemente → token-uygula → apiClient-bağla → test+mount → gate).
- [ ] Bundle **verbatim kopyalanmadı**; mevcut `src/components` deseni + `apiClient` + `--ollamas-*` token + Lingui i18n **yeniden kullanıldı** (Golden Rule).
- [ ] **Doğrudan `fetch`/`EventSource` YOK** — tüm I/O `apiClient` üzerinden; auth otomatik; hata `ApiError` → 4-durum.
- [ ] **`dark:` prefix YOK** — parity token katmanından; `screenshot.png` (dark) + light görsel parity geçti.
- [ ] **4-durum** (loading/empty/error/ok) render; **honest-empty** (backend yoksa `{soft}`+boş, çökme yok — H5).
- [ ] **i18n `app.tab.<id>` + `<panel>.*` EN==TR** eşit; hardcoded string yok.
- [ ] Yazma/exec paneli **`CapabilityGate`** ile sarıldı; `TAB_CAPABILITY` güncel.
- [ ] a11y (ARIA rol + `aria-live` + focus-visible + `prefers-reduced-motion` + AA) **elle** eklendi (H7).
- [ ] Gate: `typecheck ✓ lint ✓ test(fresh) ✓`; implementer ≠ verifier; unused code silindi; conventional commit.
- [ ] Panelin H-riskleri `HANDOFF.md`'de not düşüldü.

**Nihai boru-hattı parity testi:** chat PİLOT'u §2 ile uçtan-uca çevrildiğinde (bundle → canlı `ReactAgentTab`, `apiClient`'a bağlı, dark/light + 4-durum + i18n EN/TR + gate-yeşil) **ve §3 kalibrasyonu bu belgeye geri işlendiğinde**, HANDOFF-PIPELINE **DONE**. Kalan 8 panel aynı kalibre boru hattını izler.

---

## 6. Kör-Nokta Ledger (export-gerçekliği · /design-sync · token-drift · backend-yok)

> 04 §4 H1–H10 + chat.md §9 C1–C6'dan **boru-hattına özgü** damıtım. Yeni ID'ler P-serisi.

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **P1** | **VARSAYIM** | Claude Design `Handoff to Claude Code` bundle şeması (full HTML/CSS/JS + screenshot + README[conversation+design-intent] + component-list) tarif edildiği gibi; **gerçek export hiç görülmedi** (H1/C1). §1 iskelet varsayıma dayanıyor. | Aşama 2 ingest yanlış dosya arayabilir | **PİLOT (chat) gerçek export → §1 şablonu + §2 aşamaları kalibre** (§3 adım-1); bu belgeyi güncelle. |
| **P2** | **BİLİNMEYEN** | **`/design-sync` mekaniği doğrulanmadı:** büyük repo'da (>10MB) Design'a paste yerine Claude Code'dan `/design-sync` deniyor — komut gerçekte var mı, repo bağlamını nasıl taşıyor, hangi dosyaları Design'a gönderiyor bilinmiyor. | Aşama 1 büyük-repo yolu çalışmayabilir → Design bağlamsız tasarlar | İlk kullanımda `/design-sync` çıktısını gözle; yoksa fallback: token snippet (§1.2) + panel brief'i manuel paste (repo tamamı DEĞİL). |
| **P3** | **MANUEL** | **Token-remap drift (K2/H2):** Design ham hex üretir; `#0a0b10`≈`bg-immersive-panel` ama canvas'ın seçtiği hex tam token değeri olmayabilir (`#0a0b11` gibi yakın-ama-farklı). Otomatikleşemez. | Aşama 4 yaklaşık-eşleme → subtle renk drift, cross-panel tutarsızlık | `tokens.snippet.css` zorunlu göm; remap'i `screenshot-light.png` ile göz-doğrula; şüpheli renk → **en-yakın token'a snap, ham bırakma**; §4 adım-10 cross-panel audit yakalar. |
| **P4** | **RİSK** | **Backend-yok honest-empty (H5):** 5 panel (`cookbook, research, notes, email, settings-rbac`) backend'siz. Aşama 5 çağrısı boşa düşer; panel canvas'ta güzel ama runtime'da ölü. | `{soft:true}` unutulursa panel 5xx'te ÇÖKER (RUM error, kötü UX) | Aşama 5 kuralı ZORUNLU: `{soft:true}` + honest-empty → çökmeden mock-boş render; backend 05-features'ta gelince mock kaldırılır. **Boru hattı tek başına canlı-panel garanti ETMEZ.** |
| **P5** | **RİSK** | **Bundle JS verbatim taşıma (H4):** `design.html` interaktif mock logic (event handler, local state) içerir; ollamas React 19 + `apiClient` state modeliyle çelişir → çift-state/bug. | Aşama 3'te "kolaycılık" ile bundle JS kopyalanırsa mimari bozulur | Golden Rule: bundle JS = davranış-**referansı**. State DAİMA §1.6 deseniyle yeniden yazılır; testler (Aşama 6) çift-state'i yakalar. |
| **P6** | **RİSK** | **GENİŞLET regresyonu (H10):** `chat/documents/calendar/settings` çalışan state/logic taşır; bundle görsel katmanı bunu ezerse regresyon. | Görsel yükseltme mevcut davranışı bozar | Aşama 3 kuralı: **state/logic KORUNUR, sadece görsel katman**; mevcut testler yeşil kalmalı (Aşama 6 regresyon gate); davranış-koruyucu refactor ayrı commit. |
| **P7** | **MANUEL** | **i18n TR boşluğu (H6/C6):** Design EN mock üretir; TR anahtar Aşama 6'da **el ile**. Eksik `<panel>.*` TR → Lingui fallback = ham id sızıntısı. | Yarım i18n = TR kullanıcıda ham anahtar | Her `HANDOFF.md`'ye i18n-checklist; Aşama 6'da EN==TR anahtar-sayısı diff (CI grep). |
| **P8** | **RİSK** | **Nav taşması (K4/H8):** her başarılı handoff +1 sekme → 21→30 sidebar taşar. Shell (§4 adım-1) bunu çözmezse mount UX'i bozulur. | Aşama 6 mount her panelde nav'ı büyütür | Shell paneli chat'ten ÖNCE (§4 sırası); ≥24 sekmede ⌘K/kategori-grup zorunlu (`00-shell-nav.md`). |
| **P9** | **MANUEL** | **`npm run tokens` unutma (H9):** yeni renk `tokens/*.json`'a eklenip regenerate edilmezse utility class boşa çıkar. | Aşama 4.3 atlanırsa panel renksiz | Aşama 4'te "yeni token mı?" kontrolü + `npm run tokens` + `tokens.css` diff commit'e dahil. |
| **P10** | **RİSK** | **Settings güvenlik-yanılsaması (K6):** `settings/2FA` UI'ı backend TOTP time-window + RBAC enforcement olmadan ship edilirse **sahte-güvenlik** (UI kilit gösterir, backend açık). | Kullanıcı güvende sanır, değil | §4 sırasında settings **SON**; backend auth/rbac yeşil olmadan UI ship YASAK; `security-auditor` gate. |

---

**Boru hattı özeti:** `01 token → 00 shell → chat PİLOT (kalibre) → documents → calendar → cookbook → research → notes → email → settings → cross-panel audit`. Her panel §1 bundle iskeletiyle iner, §2 7-aşamayla çevrilir, §5 kabul kriteriyle DONE olur. PİLOT (chat) §3'te şablonu ampirik düzeltir; §6 Ledger export-gerçekliği/`/design-sync`/token-drift/backend-yok kör-noktalarını taşır.
