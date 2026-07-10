# ODYSSEY — Feature 05: Documents Modülü

> **Hedef:** ollamas'ı odysseus-kalitesinde bir "documents" modülüne kavuşturmak: PDF/office/markdown
> içerik çıkarma (processor), yazma-öncelikli (writing-first) editör UI ve doğrulamalı upload.
> **Referans:** odysseus `documents` modülü (upload_handler + PDF/office/markdown editor).
> **Dil:** açıklama TR, kod/komut/dosya-yolu EN.

---

## 1. Mevcut Durum (ollamas — koda karşı doğrulanmış)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **gerçekten okunarak** teyit edildi
(Read/Grep). "VAR" = kodda mevcut, "YOK" = eksik.

### 1.1 VAR olan sağlam temel (yeniden kullanılacak, sıfırdan yazılmayacak)

| Yetenek | Dosya / Konum | Not |
|---|---|---|
| Path-traversal guard | `server/files.ts:61` `FilesystemManager.resolveSafePath()` | root-escape guard; upload/download bunu geçer |
| Binary-safe write | `server/files.ts:236` `writeFileBuffer()` | parent-dir auto-create, Buffer round-trip |
| Binary-safe read | `server/files.ts:216` `readFileBuffer()` | utf-8 bozulması yok |
| utf-8 read/write/delete | `server/files.ts:170/192/256` | text dosya CRUD |
| Unified diff üretici | `server/files.ts:281` `generateUnifiedDiff()` | write onayı için |
| Git status overlay | `server/files.ts:141` + `parseGitPorcelain():22` | tree'de untracked/modified/staged |
| Demo virtual FS | `server/files.ts:50` `VIRTUAL_FILES` | mode==="demo" fallback |
| HTTP upload (raw body) | `server.ts:1919` `POST /api/workspace/upload` | `express.raw({limit:"1gb"})` @ `server.ts:260` |
| HTTP download (stream) | `server.ts:1942` `GET /api/workspace/download` | `Content-Disposition` attachment |
| Text file API | `server.ts:1871/1887/1903` `GET/POST/DELETE /api/workspace/file` | JSON utf-8 |
| Tree API | `server.ts:1839` `GET /api/workspace/tree` | + mode |
| Workspace select | `server.ts:1852` `POST /api/workspace/select` | CWD değiştir |
| Frontend upload/download | `src/components/FileTransfer.tsx` | drag-drop + path indir |
| Frontend tree + editör | `src/components/WorkspaceTree.tsx` | **ham `<textarea>`** editör (satır 255) |
| apiClient | `src/lib/apiClient.ts:215` `uploadFile` / `:236` `downloadFile` | binary endpoint sarmalı |
| MCP file resources | `server/mcp/server.ts:164` `resources/list` + `read` | `file://` uri, ilk 200 dosya |
| Agent tool'ları | `server/tool-registry.ts` `read_file/write_file/upload_file/download_file` | ReAct döngüsünde |

### 1.2 YOK olan (documents modülünün asıl eksiği — bu planın konusu)

- **Document processor YOK.** `package.json` deps'te PDF/office parse kütüphanesi yok:
  `pdf-parse`, `pdfjs`, `mammoth`, `xlsx`, `marked/remark` — hiçbiri yok (Grep ile teyit).
  PDF/DOCX/XLSX/PPTX bir agent'a veya editöre **metin olarak** aktarılamıyor; `readFile()` utf-8
  decode ettiği için binary office dosyası bozuk string döner.
- **Writing-first editör YOK.** `WorkspaceTree.tsx:255` sadece `rows={14}` ham `<textarea>`.
  Markdown önizleme yok, syntax-aware yok, taslak/otomatik-kaydet yok, kelime sayacı yok.
- **Upload validation YOK.** `POST /api/workspace/upload` (server.ts:1919) yalnızca "Buffer mı,
  boş mu" bakar; MIME/uzantı allowlist yok, magic-byte doğrulaması yok, per-file boyut politikası
  yok (yalnızca global 1gb express limiti). Content-Type ne olursa kabul (`type:"*/*"`).
- **Belge metadata / extract API YOK.** "bu PDF'i metne çevir", "sayfa sayısı", "belge özeti" gibi
  bir `POST /api/documents/extract` endpoint'i yok.
- **Odysseus-tarzı belge listesi/koleksiyon YOK.** Belge merkezli bir görünüm (yalnızca dosya-ağacı
  var); "documents" sekmesi, tür-filtreli belge kartları yok.

**Özet:** ollamas'ta güçlü bir **genel dosya** altyapısı var; eksik olan **belge-farkında** katman
(parse → normalize-to-text/markdown), **yazma-odaklı editör** ve **güvenli/doğrulanmış upload**.

---

## 2. Odysseus Referansı (parity hedefi)

odysseus `documents` modülünün karşılığını üreteceğimiz alt-yetenekler:

1. **upload_handler**: uzantı+MIME allowlist, boyut limiti, kaydetme + kayıt (registry).
2. **Document processor**: PDF (metin çıkarma, sayfa sayısı), office (DOCX→text, XLSX→CSV/JSON,
   PPTX→text), markdown (parse + render). odysseus Python `pypdf`/`python-docx` kullanır — ollamas
   Node olduğu için **JS emsalleri**: `pdfjs-dist` (veya `unpdf`), `mammoth` (DOCX), `xlsx`
   (SheetJS), `marked` (+ `dompurify`) markdown.
3. **Writing-first editor**: markdown yazma + canlı önizleme, taslak/kaydet, belge içinde arama.
4. **Documents view**: belge kartları, tür ikonu, metadata (boyut/sayfa/tür), "metne çevir" aksiyonu.

**JS kütüphane eşleme tablosu (odysseus Python → ollamas Node):**

| İşlev | odysseus (Py) | ollamas (JS) önerisi | Neden |
|---|---|---|---|
| PDF text | `pypdf` | `unpdf` veya `pdfjs-dist` | saf-JS, native binding yok, Cloud Run/SEA uyumlu |
| DOCX | `python-docx` | `mammoth` | DOCX→HTML/markdown, olgun |
| XLSX | `openpyxl` | `xlsx` (SheetJS) | sheet→JSON/CSV |
| PPTX | `python-pptx` | (Faz 2 opsiyonel) `pptx-text-parser` | düşük öncelik |
| Markdown | `markdown` | `marked` + `dompurify` | render + XSS guard |

> **Karar gerekçesi:** native binding'li kütüphaneler (`canvas` bağımlı pdf render) **kaçınılacak** —
> ollamas SEA (single-executable) + Cloud Run hedefliyor (`sea-config.json` mevcut). Saf-JS tercih.

---

## 3. Hedef Plan (TDD-adımlı — her adım: önce test, sonra implementasyon)

> **Disiplin:** her Faz'da (1) failing test yaz → (2) minimal implementasyon → (3) yeşil → (4) refactor.
> Test runner mevcut: `vitest` (`vitest.config.ts` VAR). E2E: `@playwright/test` VAR.

### FAZ 0 — Bağımlılık + iskele (kapı: build temiz)

- **T0.1** `npm i unpdf mammoth xlsx marked dompurify` + `@types/dompurify`. Native-binding
  içermediğini doğrula (`npm ls` → C++ addon yok). SEA build'i kırmadığını test et.
- **T0.2** `server/documents.ts` iskele + `src/lib/documents.ts` (tip paylaşımı). Boş export'lar.
- **Kapı:** `npm run build` + `tsc --noEmit` yeşil.

### FAZ 1 — Document processor (backend, çekirdek)

**Test önce** — `server/__tests__/documents.test.ts`:
- `extractText()` küçük bir fixture PDF (base64 gömülü) → beklenen metin substring içerir.
- DOCX fixture → paragraf metni döner.
- XLSX fixture → `{ sheets: [{ name, rows }] }` döner.
- `.md` → `{ text, html }` (html sanitize edilmiş: `<script>` strip).
- Bilinmeyen/binary uzantı → `UnsupportedDocumentError` fırlatır (500 değil, tiplenmiş hata).
- Bozuk PDF → yakalanır, `ProcessingError` (crash yok).

**Implementasyon** — `server/documents.ts`:
```
export type DocKind = "pdf" | "docx" | "xlsx" | "pptx" | "markdown" | "text";
export interface ExtractResult {
  kind: DocKind; text: string; html?: string;
  pages?: number; sheets?: { name: string; rows: string[][] }[];
  meta: { bytes: number; truncated: boolean };
}
export function detectKind(relativePath: string, buf: Buffer): DocKind   // uzantı + magic-byte
export async function extractText(kind, buf): Promise<ExtractResult>
```
- `readFileBuffer()` (files.ts) ile oku → `detectKind` → uygun parser.
- `truncated`: çıktı > MAX_EXTRACT_CHARS (örn 500k) ise kes + bayrakla (LLM context guard).
- **Reuse:** `FilesystemManager.resolveSafePath` üzerinden git (yeni path guard yazma).

### FAZ 2 — Extract API (backend route)

**Test önce** — `server/__tests__/documents-route.test.ts` (supertest/inject):
- `POST /api/documents/extract { relativePath }` → 200 + `ExtractResult`.
- Workspace dışı path (`../../etc/passwd`) → 400 (traversal, resolveSafePath'ten gelir).
- `permissions.fileRead` kapalı → 403.
- Var olmayan dosya → 404/500 (net mesaj).
- demo mode → `VIRTUAL_FILES`'tan çalışır (md/text).

**Implementasyon** — `server.ts` (mevcut `/api/workspace/*` bloğunun yanına):
- `app.post("/api/documents/extract", ...)`: `isLive` + `db.data.workspacePath` çöz →
  `readFileBuffer` → `detectKind` → `extractText` → JSON. `db.logSecurity("file_system", ...)`.
- **Reuse:** aynı `isLive = CURRENT_MODE !== "demo"` + `db.data.workspacePath` deseni (server.ts:1878).
- OpenAPI'ye ekle (`server/openapi.ts:119` deseni — workspace/file gibi).

### FAZ 3 — Upload validation (güvenlik sertleştirme)

**Test önce** — `server/__tests__/upload-validate.test.ts`:
- İzinli uzantı (`.pdf/.docx/.md/.png/...`) + doğru magic-byte → geçer.
- Uzantı `.pdf` ama magic-byte `MZ` (exe) → 415 reddedilir (spoof guard).
- Boyut > per-tür limit (örn PDF 50mb) → 413.
- Allowlist dışı uzantı (`.exe/.sh`) → 415.
- Boş body → 400 (mevcut davranış korunur).

**Implementasyon** — `server/documents.ts` `validateUpload(relativePath, buf, policy)` +
`server.ts:1919` upload route'una **öncesinde** çağrı ekle:
- `ALLOWED_UPLOAD` allowlist + magic-byte map. Reddi `415`/`413` ile net mesajla.
- Global `express.raw` 1gb limitini **düşürme** (regresyon riski) — per-tür kontrolü kod içinde yap.
- **Config-driven:** `.env` `DOCUMENTS_MAX_MB`, `DOCUMENTS_ALLOWED_EXT` (odysseus config-driven ruhu).

### FAZ 4 — Writing-first editör UI (frontend)

**Test önce** — `src/components/__tests__/DocumentEditor.test.tsx` (`@testing-library/react` VAR):
- Markdown yazınca canlı önizleme render eder (sanitize: `<script>` görünmez).
- "Save" → `POST /api/workspace/file` çağrılır (mock).
- Kelime/karakter sayacı doğru.
- Dirty state (kaydedilmemiş değişiklik) uyarısı.

**Implementasyon** — yeni `src/components/DocumentEditor.tsx`:
- İki-panel: sol yazma (`<textarea>` üstü, ileride CodeMirror'a genişletilebilir), sağ `marked`
  önizleme (`dompurify` ile sanitize edilmiş `dangerouslySetInnerHTML`).
- `WorkspaceTree.tsx:255` ham textarea'yı bu bileşenle **değiştir** (md/text için); binary/office
  dosyada "Extract to text" butonu → `/api/documents/extract` çağır, sonucu salt-okunur göster.
- **Reuse:** mevcut `handleOpenFile/handleSaveFile` (WorkspaceTree.tsx:61/76) akışını koru.
- i18n: `src/locales/en.ts` + `tr.ts`'e string ekle (mevcut lingui deseni).

### FAZ 5 — Documents view + agent tool (entegrasyon)

**Test önce:**
- `extract_document` agent tool (tool-registry.ts deseni) → `read_file` gibi tiered "safe",
  ExtractResult döner. Tool schema testi.
- E2E (Playwright): upload → tree'de görün → extract → editörde metin (bir happy-path).

**Implementasyon:**
- `server/tool-registry.ts`'e `extract_document` tool ekle (mevcut `read_file` bloğu deseni,
  satır 206) → ReAct agent PDF/DOCX'i "okuyabilsin".
- (Opsiyonel) `src/components/DocumentsPanel.tsx`: belge kartları görünümü; ayrı sekme.
  Düşük öncelik — parity için editör+extract+validate yeterli.

---

## 4. Parity Kabul Kriteri (odysseus-parity — "bitti" tanımı)

Aşağıdakilerin **hepsi** yeşil olduğunda documents modülü odysseus-parity sayılır:

- [ ] **P1** PDF/DOCX/XLSX/Markdown dosyaları metne çıkarılabiliyor (`extractText` + fixture testleri yeşil).
- [ ] **P2** `POST /api/documents/extract` çalışıyor; traversal/permission/404 doğru kodlarla (route testleri yeşil).
- [ ] **P3** Upload validation: uzantı+magic-byte allowlist, per-tür boyut limiti; spoof (`.pdf`=exe) reddediliyor.
- [ ] **P4** Writing-first editör: markdown canlı önizleme + sanitize + save + dirty-guard (UI testleri yeşil).
- [ ] **P5** Config-driven: `.env` `DOCUMENTS_MAX_MB` / `DOCUMENTS_ALLOWED_EXT` toggle'ları etkili.
- [ ] **P6** Agent `extract_document` tool ReAct döngüsünde PDF/DOCX okuyabiliyor.
- [ ] **P7** Demo mode kırılmadı (`VIRTUAL_FILES` üzerinden md/text extract + editör çalışıyor).
- [ ] **P8** Regresyon yok: mevcut `/api/workspace/upload|download|file|tree` testleri hâlâ yeşil.
- [ ] **P9** Build kapısı: `tsc --noEmit` + `npm run build` + SEA build temiz (native-binding girmedi).
- [ ] **P10** Güvenlik: sanitize edilmiş HTML (XSS yok), path guard reuse, `db.logSecurity` iz kaydı.

**Odysseus'ta olup bu planda BİLEREK dışarıda bırakılan** (parity-dışı, ayrı feature):
PPTX tam parse (Faz 2 opsiyonel), collaborative/gerçek-zamanlı düzenleme, belge sürüm geçmişi,
OCR (taranmış PDF), ChromaDB belge-embedding (bu ollamas'ta `rag.ts` + `sqlite-vec` kapsamında ayrı iş).

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| K1 | Varsayım | `unpdf`/`pdfjs-dist` saf-JS ve SEA-uyumlu | Yüksek — yanlışsa Faz 0 kapısı çöker | T0.1 `npm ls` ile native-binding taraması; alternatif `unpdf` (pdfjs wrapper, worker'sız) |
| K2 | Bilinmeyen | `sea-config.json` bundling'i `dompurify`/`jsdom` gerektiren paketi taşır mı | Orta | `dompurify` yerine sunucu-taraf sanitize için `isomorphic-dompurify` veya markdown'ı yalnız-client render et |
| K3 | Risk | XLSX/PPTX büyük dosya → bellek patlaması (Cloud Run limiti) | Orta | `MAX_EXTRACT_CHARS` + stream/parça; per-tür boyut limiti (Faz 3) |
| K4 | Varsayım | demo mode belge testleri md/text ile yeterli (binary fixture yok) | Düşük | Küçük gerçek PDF/DOCX fixture'ları repoya ekle (`server/__tests__/fixtures/`) |
| K5 | Bilinmeyen | `permissions.fileRead/fileWrite` (db.data.permissions) documents route'unda hangi kapıya bağlanmalı | Orta | Faz 2'de `fileRead`; validation yazma yok → upload zaten `fileWrite`'a bağlı (files.ts:241) |
| K6 | Risk | Global `express.raw` limit 1gb — DoS yüzeyi; per-tür kontrol yalnız kod-içi | Orta | Faz 3 erken-red (magic-byte header'dan sonra, tam gövde işlemeden reddet) |
| K7 | Bilinmeyen | Frontend editör CodeMirror'a mı yoksa textarea+preview'da mı kalmalı (bundle boyutu, `size-limit` VAR) | Düşük | MVP textarea+`marked` preview; CodeMirror ayrı iterasyon (bundle bütçesi ölç) |
| K8 | Varsayım | MCP `resources/read` (server.ts mcp:200) belge extract'ını da sunmalı mı | Düşük | Faz 5'te MCP resource mimeType'ı belge-farkında yap (opsiyonel); şimdilik `text/plain` kalır |
| K9 | Risk | odysseus repo linki (github.com/pewdiepie-archdaemon/odysseus, 82k star) doğrulanmadı — modül isimleri prompt'tan | Orta | Parity kriterini odysseus **davranışına** göre değil, listelenen alt-yeteneklere göre tanımladık; API imzaları ollamas'a özgü |
| K10 | Bilinmeyen | `test_orchestration.ts` / orchestra katmanı belge işlemeyi pipeline'a bağlamalı mı | Düşük | Kapsam-dışı; Faz 5 agent tool yeterli köprü |

---

*Üretici: ODYSSEY planlama üreteci. Kaynak kod okundu: `server/files.ts`, `server/artifacts.ts`,*
*`server/tool-registry.ts`, `server/mcp/server.ts`, `server.ts` (workspace routes), `src/components/*
*WorkspaceTree.tsx`, `FileTransfer.tsx`, `src/lib/apiClient.ts`, `package.json`. Tarih: 2026-07-10.*
