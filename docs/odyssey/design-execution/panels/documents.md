# ODYSSEY-DESIGN — Panel: DOCUMENTS (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/documents.md`
> **Odak:** `documents` paneli — odysseus PDF/office/markdown editör + upload. ollamas'ta writing-first editör YOK (`WorkspaceTree.tsx:255` ham `<textarea>`). Claude Design tasarımı: **doküman-listesi + writing-first AI-yardımlı editör + upload + PDF/office önizleme**.
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment + slider; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** mock (backend/API/localhost YOK). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Durum (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10):
> `src/components/WorkspaceTree.tsx`, `src/components/FileTransfer.tsx`,
> `docs/odyssey/05-features/documents.md`, `docs/odyssey/03-claude-design-ui.md §3.3`.

### 1.1 VAR olan (yeniden kullanılacak, sıfırdan tasarlanmayacak)

| Yetenek | Dosya / Konum | Not |
|---|---|---|
| **Dosya ağacı (read)** | `WorkspaceTree.tsx:133-181` `renderItem()` | klasör/dosya ikonu (`lucide` Folder/File), git-status rozeti (untracked/modified/staged renk), recursive |
| **Ağaç başlık + CWD seçici** | `WorkspaceTree.tsx:184-210` | `Target Directory Explorer` başlık + refresh + `Select CWD` path input |
| **Dosya oluştur** | `WorkspaceTree.tsx:91-104` `handleCreateFile` | `newFileName` input + `FilePlus` buton |
| **Dosya sil** | `WorkspaceTree.tsx:106-122` `handleDeleteFile` | hover'da `Trash2`, confirm gate |
| **HAM editör (yükseltilecek)** | `WorkspaceTree.tsx:238-274` | `rows={14}` düz `<textarea>` (satır 255) + `Save` butonu (satır 247) + dosya-yok boş durum (satır 264) |
| **Aç/kaydet akışı** | `WorkspaceTree.tsx:61-89` `handleOpenFile`/`handleSaveFile` | `GET/POST /api/workspace/file` — **KORUNACAK** |
| **Upload UI (drag-drop)** | `FileTransfer.tsx:77-94` | dashed drop-zone + `dragOver` durumu + multi-file, "binary-safe" |
| **Upload hedef-dizin** | `FileTransfer.tsx:67-75` | `Upload to:` input (default `uploads`) |
| **Download by path** | `FileTransfer.tsx:96-110` | path input + `Download` buton (blob) |
| **Upload/download busy** | `FileTransfer.tsx:13-58` | `busy` state + `Loader2` spinner + notify |
| **demo-mode rozeti** | `WorkspaceTree.tsx:267-271` | `DEMO Workspace emulated` badge (`treeMode==="demo"`) |

### 1.2 YOK olan (bu tasarımın konusu — writing-first + belge-farkında UI)

- **Writing-first editör YOK.** `WorkspaceTree.tsx:255` yalnız `rows={14}` ham `<textarea>` —
  markdown canlı önizleme yok, syntax-highlight yok, AI-öneri yok, kelime/karakter sayacı yok,
  taslak/dirty-guard yok, belge-içi arama yok.
- **PDF/office önizleme YOK.** Binary belge editöre utf-8 olarak açılır → bozuk string. PDF/DOCX/XLSX
  için read-only preview paneli yok; "metne çevir" (`/api/documents/extract`) aksiyonu tasarlanmamış.
- **Belge-listesi / koleksiyon görünümü YOK.** Yalnız ham dosya-ağacı var; tür-filtreli belge kartları,
  metadata (boyut/sayfa/tür), "son açılanlar" yok (`03-claude-design-ui.md §3.3` "belge kartları").
- **Upload progress/hata UI YOK.** `FileTransfer.tsx` yalnız global `busy` spinner; per-dosya
  ilerleme çubuğu, MIME/uzantı-red hatası, boyut-aşımı geri-bildirimi yok.
- **İki-mod görüntüleyici YOK.** MD için split-editör (raw|preview) vs PDF/office için read-only
  preview ayrımı yok — tek `<textarea>` her şeyi kör-açar.
- **Upload + editör AYRI bileşenlerde.** `FileTransfer` ile `WorkspaceTree` bağımsız kartlar;
  odysseus-tarzı **tek belge-workspace** olarak birleşmemiş.

**Özet:** ollamas'ta sağlam **ham dosya-ağacı + upload/download** var; eksik olan **yazma-odaklı
AI-yardımlı editör**, **belge-farkında (PDF/office) önizleme** ve **belge-listesi/upload-progress**
UI'ı. Bu belge o eksik UI'ın Claude Design brief'idir.

---

## 2. Hedef Panel — odysseus documents parity (3-bölge + upload-bar)

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır. `handleOpenFile/
handleSaveFile`, `/api/documents/extract`, capability-gate (`fileWrite`), SSE **Claude Code handoff**
aşamasında implemente edilir. Claude Design yalnız **görsel iskeleti + mock durumları** üretir.

**Bölge şeması (3-kolon + üst upload/format-bar):**

```
┌─ ÜST BAR ───────────────────────────────────────────────────────────────
│  [dosya adı]  [tür rozeti .md/.pdf/.docx]  ·  format-toolbar (B I H1 · list · link)
│  [Upload ▾ drop-zone]  [word/char sayaç]  [dirty ●]  [Save]  [Extract to text]
├──────────────┬───────────────────────────────────┬────────────────────────
│ SOL          │ ORTA (writing-first editör)       │ SAĞ (önizleme)
│ Doküman      │ • markdown raw + syntax-highlight  │ • MD  → canlı render (sanitize)
│ listesi      │ • AI-öneri satır-içi (ghost text)  │ • PDF → sayfa önizleme + sayfa-nav
│ + ağaç       │ • kelime/karakter sayacı           │ • office → extract-edilmiş metin
│ + tür-filtre │ • dirty/autosave taslak            │   (read-only, "download orijinal")
│ + upload CTA │                                    │
└──────────────┴───────────────────────────────────┴────────────────────────
```

- **SOL:** mevcut `WorkspaceTree` ağacını **belge-listesine** evriltir — tür-ikonu + tür-rozeti
  (`.md/.pdf/.docx/.xlsx`) + tür-filtre çipleri + üstte `Upload` CTA (drop-zone'u açar).
- **ORTA:** ham `<textarea>` (satır 255) yerine **writing-first editör** — markdown raw + syntax-highlight
  + satır-içi AI-öneri (ghost text, `Tab` kabul) + kelime/karakter sayacı + dirty-göstergesi.
- **SAĞ:** iki-mod — MD için canlı-render (`marked` + `dompurify` sanitize), PDF için sayfa-önizleme
  + sayfa-nav, office (DOCX/XLSX) için extract-edilmiş salt-okunur metin + "download orijinal".
- **Mevcut korunur:** `handleOpenFile/handleSaveFile` akışı + git-status rozeti + demo-badge +
  capability-lock deseni DEĞİŞMEZ; yalnız görsel/etkileşim katmanı zenginleşir.

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları
> `01-design-system.md`'den gelir (ön-koşul). `00-shell-nav.md` shell içine mount edilir.

```
[GOAL]
Design the DOCUMENTS panel for a self-hosted, local-first AI workspace ("ollamas",
odysseus-parity). It is a writing-first document workspace: a document list/tree on
the left, an AI-assisted markdown editor in the center, and a dual-mode preview on
the right (live markdown render OR read-only PDF/office preview). A top bar carries
the filename, format toolbar, upload drop-zone, word count, dirty indicator, Save,
and an "Extract to text" action for binary documents. This is ONE feature panel
mounted inside the app-shell (see 00-shell-nav) — NOT the whole shell.

[LAYOUT]
- Panel = single card on immersive dark bg, filling the shell content mount.
- TOP BAR (h-~48px, full width): left = filename (mono) + file-kind badge
  (.md / .pdf / .docx / .xlsx, color-coded) ; center = markdown format toolbar
  (Bold, Italic, H1/H2, bullet-list, link, code) shown ONLY for markdown ; right =
  word/char counter + dirty dot (● amber when unsaved) + primary "Save" button +
  secondary "Extract to text" button (only for pdf/office).
- BODY = 3 columns:
    • LEFT (~240px): "Documents" header + an "Upload" button that opens a drag-drop
      drop-zone; type-filter chips (All / MD / PDF / Office); then a file
      list/tree — each row = kind icon + name + tiny kind badge + optional
      git-status dot. Active row = indigo tint + left accent border. A "+ New"
      inline input at top to create a markdown doc.
    • CENTER (fluid, ~1fr): the WRITING-FIRST editor — a markdown raw textarea with
      light syntax highlighting (headings bold, code mono, links tinted). Show an
      inline AI suggestion as dimmed ghost text at the cursor line with a hint
      "Tab to accept · Esc to dismiss". A subtle live word/char count under the
      editor. Draft-autosave chip ("Draft saved 12s ago").
    • RIGHT (~1fr): DUAL-MODE preview.
        – markdown → rendered HTML preview (sanitized), scroll-synced with editor.
        – pdf → page thumbnail preview with page navigation (‹ 1 / 12 ›).
        – office (docx/xlsx) → extracted plain text, read-only, with a
          "Download original" link and an "extracted, read-only" note.
- The drop-zone (from the Upload button) = dashed border area "Drag & drop any file,
  or click to choose (binary-safe)"; while uploading show per-file progress bars
  and error rows (rejected type / too large).

[CONTENT]
Use these exact labels. Left list mock (5 docs):
  📄 notes.md (MD)        📄 spec.md (MD, active)     📕 report.pdf (PDF)
  📘 brief.docx (Office)  📗 budget.xlsx (Office)
Filter chips: "All · Markdown · PDF · Office".
Active doc = spec.md open in editor with a heading, a paragraph, a bullet list, and
a fenced code block; right panel shows its rendered preview.
AI ghost-text sample (dimmed): after "## Acceptance criteria" show suggested next
line "- [ ] Upload rejects .exe disguised as .pdf" with "Tab to accept" hint.
Top-bar counter mock: "412 words · 2,318 chars". Dirty dot ON (unsaved).
Extract mock (for report.pdf selected): right panel = "Extracting… page 3 / 12"
then extracted text block.

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  kind badges: md #22d3ee · pdf #fb7185 · office #fbbf24.
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Dark is primary; ALSO produce a light variant (token-driven, no dark: prefixes).
Motion: fade-in 0.25s; upload progress bars ease; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR panel states:
  1. EMPTY DOC — no document selected (fresh): left list populated, center shows a
     centered greeting "Select a document or drop a file to begin" + "+ New markdown"
     CTA; right preview empty. (Mirrors current WorkspaceTree empty state, upgraded.)
  2. LOADING/UPLOADING — a file is uploading: drop-zone shows per-file progress bars
     (report.pdf 64%), and/or editor area shows skeleton shimmer while opening a doc.
  3. PROCESSING ERROR — extract/upload failed: a non-blocking inline error banner
     "Couldn't extract report.pdf — file may be corrupt or unsupported" + retry;
     for upload: a rejected row ".exe files are not allowed" (amber/err).
  4. FILLED EDITOR — spec.md open, split editor + live markdown preview, AI ghost
     suggestion visible, word counter + dirty dot, Save enabled. (happy-path ref.)
Responsive:
  • DESKTOP (≥1024px): full 3-column (list | editor | preview).
  • TABLET (768–1023px): collapse to 2 columns — list becomes a top drawer/toggle;
    editor + preview share width, OR a segmented toggle (Edit | Preview) swaps them.
Keyboard-first: Cmd+S save, Tab accepts AI suggestion, Esc dismisses. Accessibility:
role="list" on doc list, aria-current on active doc, aria-live on upload progress +
extract status, focus-visible rings, sanitized preview (no script), contrast AA.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Panel görünümü | Kritik detay |
|---|---|---|
| **1. Boş belge** | Sol liste dolu; orta ortada `Select a document or drop a file to begin` + `+ New markdown` CTA; sağ preview boş | mevcut `WorkspaceTree.tsx:264` boş-durumun yükseltilmişi; upload keşfedilebilirliği burada |
| **2. Yükleniyor / upload** | Drop-zone per-dosya progress bar (`report.pdf 64%`); veya editör alanı skeleton shimmer (doc açılırken) | `aria-live` upload ilerleme; `.ollamas-skeleton` shimmer; **upload-progress bu belgenin en zayıf mock alanı — KN1** |
| **3. İşleme hatası** | Non-blocking inline banner `Couldn't extract report.pdf — corrupt/unsupported` + retry; upload-red satırı `.exe not allowed` | shell çökmez, stale/kısmi gösterir; amber (`warn`) vs err ayrımı |
| **4. Dolu editör** | `spec.md` açık; split editör (raw|render) + AI ghost-text + word-sayaç + dirty ● + Save aktif | happy-path referans; markdown sanitize preview |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel**
(2 viewport × 2 tema). Toplam 16 frame hedefi.

---

## 5. Responsive (desktop + tablet)

| Viewport | Yerleşim | Not |
|---|---|---|
| **Desktop (≥1024px)** | Tam 3-kolon: liste (~240px) \| editör (1fr) \| preview (1fr). Mevcut shell `lg:col-span-3` content mount içine sığar | `WorkspaceTree.tsx:212` mevcut `md:grid-cols-3` deseni baz alınır, 3-bölgeye genişletilir |
| **Tablet (768–1023px)** | 2-kolon: liste üst-drawer/toggle'a iner; editör + preview yan-yana **veya** `Edit \| Preview` segment-toggle ile takas | preview + editör aynı anda dar ekrana sığmaz → segment-toggle taşıma vanası |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md §2.8` "mobil bozulmayan grid"
genel kriteri geçerli; documents için mobil detay ayrı iş (Kör-Nokta KN6).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment + slider)

1. **PROMPT yapıştır** (§3) → canvas ilk panel iskeletini üretir (muhtemel: tek editör, dual-preview zayıf).
2. **İnline-comment #1:** "Orta editörü writing-first yap — markdown syntax-highlight + satır-içi AI ghost-text ('Tab to accept'), altında word/char sayaç."
3. **Chat iterasyon #2:** "Sağ paneli iki-mod yap: MD için canlı-render (sanitize), PDF için sayfa-nav önizleme, office için extract-edilmiş salt-okunur metin + 'Download original'."
4. **İnline-comment #3:** "Üst bara format-toolbar (B I H1 list link code) + tür-rozeti + dirty ● + Save + 'Extract to text' ekle."
5. **Chat iterasyon #4:** "Sol ağacı belge-listesine çevir — tür-ikon + tür-rozeti + tür-filtre çipleri (All/MD/PDF/Office) + 'Upload' CTA drop-zone."
6. **İnline-comment #5:** "4 panel durumunu ayrı frame üret: boş-belge / yükleniyor-upload (per-dosya progress bar) / işleme-hatası (extract-fail banner + upload-red satırı) / dolu-editör."
7. **Chat iterasyon #6:** "Light varyantı token-driven üret (dark: prefix yok). Tablet 2-kolon + Edit|Preview segment-toggle varyantını ekle."
8. **Slider ayarı:** editör/preview genişlik dengesi + AI ghost-text opaklığı (`text-dim`) inline-slider ile kalibre.
9. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (K1 azaltma).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/documents/` altına:

```
documents/
  PROMPT.md               # §3'teki tam brief (token + mock + 4-state)
  design.html             # Claude Design export (self-contained, inline CSS)
  screenshot-empty.png    # 4 durum × dark
  screenshot-loading.png
  screenshot-error.png
  screenshot-filled.png
  screenshot-*-light.png  # her durumun light varyantı
  screenshot-tablet.png   # 2-kolon + Edit|Preview segment-toggle
  HANDOFF.md              # ↓ zorunlu içerik
  tokens.snippet.css      # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  MD_EDITOR.spec.md       # writing-first editör prop imzası + AI-öneri + dirty/save sözleşmesi
  DROPZONE.spec.md        # upload drop-zone prop imzası + per-dosya progress + red-hata durumu
  PREVIEW.spec.md         # dual-mode preview sözleşmesi (MD render sanitize / PDF page-nav / office extract)
```

**HANDOFF.md zorunlu içeriği:**
- Component ağacı: `DocumentsPanel` → `DocList(items[], filter)` / `EditorToolbar` /
  `DocumentEditor(value, onChange, aiSuggestion?)` / `Preview(kind, source)` / `Dropzone(onUpload)`.
- **Mevcut→yeni map:** `WorkspaceTree.tsx:238-274` ham textarea → yeni `DocumentEditor.tsx`;
  `WorkspaceTree.tsx:133-181` ağaç → `DocList`; `FileTransfer.tsx:77-94` drop-zone → `Dropzone`
  (progress eklenir). **`handleOpenFile/handleSaveFile` (satır 61/76) KORUNUR** — editör onları çağırır.
- Yeni backend bağı: `POST /api/documents/extract` (bkz `05-features/documents.md §2`) — PDF/office
  "Extract to text" ve sağ-preview office-modu bunu çağırır (`marked`+`dompurify` sanitize MD tarafı).
- Capability-gate: editör Save + upload `CapabilityGate need="fileWrite"`; extract/preview `fileRead`.
  Mevcut `isTabEnabled` + `Lock` deseni korunur (`src/lib/capabilities.ts`).
- i18n anahtar listesi: yeni `documents.*` (EN+TR) — `documents.list.header/upload/filter.all|md|pdf|office`,
  `documents.editor.save/dirty/wordCount/aiHint`, `documents.preview.downloadOriginal/extracting/extractError`,
  `documents.dropzone.prompt/rejected.type/rejected.size`. Mevcut Lingui deseni (`_(\`documents.${...}\`)`).
- Sanitize sözleşmesi: MD preview `dompurify` ile temizlenir, `dangerouslySetInnerHTML` yalnız
  sanitize-sonrası; `<script>` strip zorunlu (XSS gate).

---

## 8. Kabul Kriteri (bu documents brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] **3-bölge yerleşim:** sol belge-listesi (+ tür-filtre + upload CTA) \| orta writing-first editör \| sağ dual-mode preview.
- [ ] **Writing-first editör:** markdown syntax-highlight + satır-içi AI ghost-text (`Tab` kabul) + word/char sayaç + dirty ●.
- [ ] **Dual-mode preview:** MD canlı-render (sanitize) / PDF sayfa-nav / office extract-edilmiş salt-okunur + "Download original".
- [ ] **Üst upload/format-bar:** tür-rozeti + format-toolbar (MD) + Save + "Extract to text" + word-sayaç.
- [ ] **Upload drop-zone:** drag-drop + **per-dosya progress bar** + red-hata satırı (tür/boyut).
- [ ] **4 panel durumu** (boş-belge / yükleniyor-upload / işleme-hatası / dolu-editör) ayrı frame.
- [ ] **Responsive:** desktop 3-kolon + tablet 2-kolon (Edit|Preview segment-toggle).
- [ ] Dark + light token-driven parity (`dark:` prefix yok); kind-badge renk token'ları (md/pdf/office).
- [ ] a11y: `role="list"`, `aria-current`, `aria-live` (upload+extract), focus-visible, sanitize (XSS yok), kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mevcut→yeni map` + `handleOpenFile/handleSaveFile` koruma notu + `MD_EDITOR/DROPZONE/PREVIEW.spec.md`.
- [ ] **Mevcut aç/kaydet akışı + git-status + demo-badge + capability-lock KIRILMADI** (yalnız görsel/etkileşim katmanı eklendi).

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **RİSK (editör-zenginliği-mock)** | Claude Design statik-HTML; "syntax-highlight + satır-içi AI ghost-text + dirty/autosave" **etkileşimli** editör davranışını yalnız **görsel taklit** eder — gerçek CodeMirror/highlight yok. | Handoff'ta editör beklenenden zengin sanılır; Claude Code sıfırdan kodlar (textarea+overlay veya CodeMirror). | Mock'ta ghost-text'i statik dimmed satır olarak göster; `MD_EDITOR.spec.md`'de "görsel-mock, davranış Claude Code işi" notu; MVP `05-features/documents.md §4` textarea+`marked` (CodeMirror ayrı iterasyon, `size-limit` bütçesi). |
| **KN2** | **RİSK (PDF-önizleme)** | Sağ-panel PDF sayfa-nav önizlemesi statik-HTML'de gerçek PDF render edemez (`pdfjs` worker yok); yalnız placeholder sayfa-görseli mock'lanır. | Gerçek PDF görüntüleme handoff'ta ayrı iş; mock yanıltıcı olabilir. | Mock'ta PDF preview'ı "temsili sayfa çerçevesi + `‹ 3/12 ›` nav" olarak göster; `PREVIEW.spec.md`'de office/PDF modu `/api/documents/extract` metin-fallback'e bağlanır (native PDF render Faz-2, `05-features/documents.md` K1/K7). |
| **KN3** | **RİSK (upload-progress)** | `FileTransfer.tsx` bugün yalnız global `busy` spinner — **per-dosya progress bar YOK**. Mock'taki progress bar gerçek XHR-progress bağını gerektirir. | Tasarım gerçekten fazla vaat eder; Claude Code `XMLHttpRequest.upload.onprogress` veya `fetch` stream eklemeli. | `DROPZONE.spec.md`'de progress-bar'ın `apiClient.uploadFile` (`src/lib/apiClient.ts:215`) XHR-progress'e yükseltilmesi gerektiği not edilir; mock statik %64 bar gösterir, davranış Claude Code işi. |
| **KN4** | **VARSAYIM (AI-öneri kaynağı)** | Satır-içi AI ghost-text'in hangi model/endpoint'ten geldiği (local `qwen3`? ReAct agent?) tasarımda belirsiz. | Backend bağı belirsiz kalırsa öneri özelliği hayalet olur. | Mock yalnız UX'i satar; HANDOFF.md'de "AI-öneri kaynağı = local model completion endpoint, ayrı feature-spike" notu; MVP'de öneri toggle-kapalı ship edilebilir. |
| **KN5** | **KORUMA (mevcut akış)** | Editör yükseltmesi mevcut `handleOpenFile/handleSaveFile` (`WorkspaceTree.tsx:61/76`) veya `activeTab` id'sini kırarsa dosya CRUD + panel mount çöker. | Regresyon — dosya aç/kaydet çalışmaz. | `handleOpenFile/handleSaveFile` imzası DEĞİŞMEZ; yeni `DocumentEditor` onları prop olarak alır; HANDOFF.md `mevcut→yeni map` + koruma checklist; refactor sonrası aç/kaydet/sil yolu test edilir. |
| **KN6** | **BİLİNMEYEN (mobil)** | Mobil (<768px) 3-bölge (liste+editör+preview) sığmaz; segment-toggle + drawer detayı bu belgede kapsam-dışı. | Küçük ekranda panel kullanılamaz. | Tablet segment-toggle deseni mobile taşınabilir; mobil detay ayrı panel-iterasyonu; `03-claude-design-ui.md §2.8` genel grid kriteri geçerli. |
| **KN7** | **VARSAYIM (design-system)** | `01-design-system.md` ön-koşul mevcut/tam kabul edildi; token'lar (kind-badge md/pdf/office renkleri dahil) `src/styles/tokens.css`'ten sadık. | Token uyuşmazlığı → görsel drift, badge renk tutarsızlığı. | `tokens.snippet.css` brief'e gömülür; kind-badge renkleri ilk export'ta token-remap denetimi; §3 `[BRAND]` bloğunda renkler açık listelendi. |
| **KN8** | **VARSAYIM (odysseus parity)** | odysseus "documents" alt-yetenek listesi prompt'tan; repo davranışı bire-bir doğrulanmadı (`05-features/documents.md K9`). | Parity kriteri odysseus'un gerçek UI'ından sapabilir. | Parity, listelenen alt-yeteneklere (liste+upload+MD-editör+PDF-preview+dirty/save) göre tanımlandı; API imzaları ollamas'a özgü (`05-features/documents.md` ile hizalı). |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar →
§7 handoff-bundle → Claude Code: `WorkspaceTree.tsx` genişlet + yeni `DocumentEditor.tsx` + backend
`POST /api/documents/extract` (bkz `05-features/documents.md`), TDD ile (`fileWrite`-gate zorunlu).
Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN1/KN2/KN5 gate).
