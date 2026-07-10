# ODYSSEY — Feature 05: RAG / Vector Modülü

> **Hedef:** ollamas'ın **mevcut** yerel RAG çekirdeğini (`server/rag.ts` + `sqlite-vec` +
> çok-sağlayıcılı embedding) odysseus-kalitesinde bir **personal-docs RAG** katmanına
> evriltmek: pluggable vector-store soyutlaması (VectorStore) + local embedding (ONNX/FastEmbed
> emsali) + RAG MCP server yüzeyi + **documents modülü ile entegrasyon** (chunk → embed → index).
> **Referans:** odysseus `rag/vector` modülü = ChromaDB (`http://localhost:8100`, async HTTP) +
> FastEmbed (local ONNX embeddings) + `rag_server.py` (MCP, personal-docs RAG) +
> `memory_provider.py` (pluggable ChromaDB/vector/hybrid abstraction).
> **Dil:** açıklama TR, kod/komut/dosya-yolu EN.
> **Çapraz-ref:** `05-features/documents.md` (kaynak metin üreticisi), `02-architecture.md`
> (VectorStore kararı), `00-MASTER.md` (KN-M4 persistence-uçurumu).

---

## 0. Yönetici Özeti (TL;DR)

- **DÜZELTME — RAG ollamas'ta YOK DEĞİL, VAR.** Prompt "ollamas'ta YOK, sıfırdan kur" varsayıyordu;
  **koda karşı doğrulandı (Read):** `server/rag.ts` (177 satır) tam işlevsel bir yerel vektör
  arama motoru — `sqlite-vec` (MIT/Apache) vec0 sanal tablosu + KNN + upsert + dim/provider
  tutarlılık kapıları. Embedding tarafı `server/embed-catalog.ts` (108 satır) **dört bulut
  sağlayıcı** (voyage/jina/gemini/cloudflare, OpenAI-compat `/embeddings`) + **terminal local
  ollama** fallback (`nomic-embed-text`). Agent'a `rag_index`/`rag_search` araçları olarak
  choke-point'ten (`server/tool-registry.ts:745/766`) bağlı, `sqlite-vec` `package.json:79`'da
  kurulu. Yani plan **"sıfırdan RAG"** değil, **"mevcut RAG'ı odysseus-parity'ye tamamlama"**.
- **Asıl eksikler (bu planın konusu):** (1) **pluggable VectorStore soyutlaması yok** —
  `createRagStore` doğrudan sqlite-vec'e sıkı bağlı, odysseus `memory_provider.py`'nin
  ChromaDB/vector/hybrid pluggable arayüzünün karşılığı yok; (2) **local ONNX embedding yok** —
  local tier ollama daemon'una bağlı (`OLLAMA_HOST`), odysseus FastEmbed'in daemon'suz gömülü
  ONNX'i (SEA/Cloud-Run-friendly, sıfır-servis) yok; (3) **chunking + documents entegrasyonu
  yok** — `rag_index` ham metni tek-parça gömer, `documents.md`'nin `extractText()` çıktısını
  chunk'layıp indeksleyen köprü yok; (4) **RAG MCP resource yüzeyi yok** — `rag_search` bir
  *tool*, ama odysseus `rag_server.py` gibi personal-docs koleksiyonunu MCP *resource* olarak
  sunmuyor; (5) **koleksiyon/namespace yok** — tek düz indeks, doküman-kaynak filtresi (email vs
  notes vs upload) yok; (6) **kalıcılık/metadata yok** — doc_id + text var ama source/kind/chunk-idx
  metadata'sı ve modül-store (`server/store/`) bağı yok (KN-M4).
- **Mimari karar (02-architecture.md ile hizalı):** `sqlite-vec` **kalır** (varsayılan, sıfır-servis);
  ChromaDB **opsiyonel-MCP** olarak eklenebilir (`VECTOR_BACKEND=chroma`); `rag.ts` bir
  **`VectorStore` arayüzünün** arkasına sarılır (odysseus `memory_provider.py` pluggable ruhu).
  Local embedding'e **FastEmbed emsali gömülü-ONNX tier** eklenir (opt-in, `EMBED_PROVIDER=onnx`).

---

## 1. Mevcut Durum — Kanıt Tabanlı (ollamas, koda karşı doğrulandı)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **Read/Grep ile teyit edildi.**
"VAR" = kodda mevcut, "YOK" = eksik (bu planın konusu).

### 1.1 VAR olan sağlam çekirdek (yeniden kullanılacak, sıfırdan yazılmayacak)

| Yetenek | Dosya / Konum | Not |
|---|---|---|
| **Yerel vektör store** | `server/rag.ts:78` `createRagStore()` | `sqlite-vec` vec0 sanal tablo, ayrı DB dosyası (`RAG_DB_PATH` / `~/.llm-mission-control/rag.db`) |
| **vec0 KNN arama** | `server/rag.ts:142` `search()` | MATCH + `ORDER BY distance LIMIT k`, subquery→JOIN (vec0 LIMIT-hidden bug guard) |
| **Upsert-by-id** | `server/rag.ts:126` `index()` | önce eski vektör+text sil, rowid paylaşımlı yeniden ekle |
| **Dim tutarlılık kapısı** | `server/rag.ts:115` `ensureVec()` | ilk vektör dim'i tabloyu kilitler; dim uyumsuzluğu → tiplenmiş hata (karışık-dim yazma engeli) |
| **Provider tutarlılık kapısı** | `server/rag.ts:100` `ensureProvider()` | indeks embed-provider'a bağlı; mismatch → hata (voyage-indeksine gemini yazma engeli) |
| **Injectable embedder** | `server/rag.ts:38` `resolveEmbedder()` | deterministik test için `embed` enjekte edilebilir; prod'da katalogdan çözülür |
| **Bulut embedding kataloğu** | `server/embed-catalog.ts:20` `EMBED_CATALOG` | voyage/jina/gemini/cloudflare, OpenAI-compat `/embeddings`, free-quota notlu |
| **Terminal local fallback** | `server/rag.ts:17` `embedText()` | `POST {OLLAMA_HOST}/api/embeddings`, `nomic-embed-text`; bulut ANY-fail → local'e düşer |
| **Pinned provider seçimi** | `server/embed-catalog.ts:72` `pickEmbedProvider()` | `EMBED_PROVIDER` pin; per-call rotasyon YASAK (indeks bütünlüğü) |
| **Agent tool'ları** | `server/tool-registry.ts:745/766` `rag_index` (tier `host`) / `rag_search` (tier `safe`) | ReAct döngüsünde + `/mcp` expose (tier süzgecinden) |
| **Vektör dep** | `package.json:79` `"sqlite-vec": "^0.1.9"` | saf-JS loadable extension, native C++ addon yok (SEA/Cloud-Run uyumlu) |

### 1.2 YOK olan (odysseus-parity eksiği — bu planın konusu)

- **Pluggable VectorStore soyutlaması YOK.** `createRagStore` doğrudan `DatabaseSync` + `sqliteVec`
  kullanır; backend değiştirilebilir bir arayüz (`VectorStore`) yok. odysseus `memory_provider.py`
  ChromaDB/vector/hybrid arasında geçiş yapabiliyor — ollamas'ta tek sabit backend.
- **Local ONNX embedding (FastEmbed emsali) YOK.** local tier `ollama` **daemon**'una bağlı
  (`OLLAMA_HOST` ayakta olmalı). odysseus FastEmbed **gömülü ONNX** ile daemon'suz, servis'siz
  embed üretir (SEA single-executable + Cloud-Run cold-start dostu). ollamas'ta gömülü ONNX yok.
- **Chunking + documents entegrasyonu YOK.** `rag_index(id, text)` ham metni **tek parça** gömer.
  `documents.md`'nin `extractText()` çıktısını (uzun PDF/DOCX) chunk'layan (overlap'li) ve her
  chunk'ı ayrı indeksleyen köprü (`indexDocument()`) yok. Uzun belge tek-vektör → düşük geri-çağırma.
- **RAG MCP resource yüzeyi YOK.** `rag_search` yalnız *tool*. odysseus `rag_server.py` personal-docs
  koleksiyonunu MCP **resource** (`rag://collection/...`) + prompt olarak da sunar. `server/mcp/server.ts`
  resource-list yalnız `file://` sunar (documents.md 1.1), RAG koleksiyonu sunmaz.
- **Koleksiyon / namespace YOK.** Tek düz indeks; kaynak-farkında filtre (`source=email|notes|upload`,
  `tenantId`) yok. Çok-kaynaklı personal-docs RAG için koleksiyon ayrımı gerekli.
- **Chunk/source metadata YOK.** `rag_docs` yalnız `doc_id + text`. `source`, `kind`, `chunk_index`,
  `path`, `mtime` metadata'sı yok → arama sonucunda kaynak-atıf (citation) üretilemiyor.
- **Modül-store bağı YOK (KN-M4).** `rag.db` üç DB dünyasından biri (`db.ts` / `store/` / `rag.ts`),
  birleşmiyor. Belgeler `server/store/`'da kalıcı değil; RAG indeksi yeniden kurulabilir değil.
- **Test YOK.** `find server -name "*.test.ts" | grep rag` → boş. `rag.ts` başındaki yorum
  "contract test" varsayıyor ama **repoda rag testi yok** (kör-nokta K1).

**Özet:** ollamas'ta odysseus'un vektör-arama *çekirdeği* (ChromaDB'nin sqlite-vec muadili) +
embedding *çok-sağlayıcılığı* **zaten var ve iyi tasarlanmış**. Eksik olan odysseus'un
**pluggability** (`memory_provider`), **daemon'suz local embed** (FastEmbed), **personal-docs MCP
yüzeyi** (`rag_server`) ve **belge-chunk pipeline** katmanları.

---

## 2. Odysseus Referansı (parity kaynağı)

odysseus `rag/vector` modülünün karşılığını üreteceğimiz alt-yetenekler ve ollamas eşlemesi:

| odysseus bileşeni | Ne yapar | ollamas karşılığı (bu plan) | Durum |
|---|---|---|---|
| **ChromaDB** (`localhost:8100`, async HTTP) | Vektör DB servisi, koleksiyonlar, metadata filtresi | `sqlite-vec` (varsayılan, gömülü) + opsiyonel Chroma-MCP backend | çekirdek VAR, koleksiyon/filtre YOK |
| **FastEmbed** (local ONNX) | Daemon'suz gömülü embedding | Gömülü-ONNX tier (`EMBED_PROVIDER=onnx`) — `fastembed-js`/`@xenova/transformers` emsali | YOK (Faz 2) |
| **`rag_server.py`** (MCP) | personal-docs RAG'i MCP tool+resource olarak sunar | `rag_index/rag_search` tool VAR → + MCP **resource** (`rag://`) + `rag_ingest_document` tool | tool VAR, resource/ingest YOK |
| **`memory_provider.py`** | pluggable ChromaDB/vector/hybrid abstraction | **`VectorStore` arayüzü** — `rag.ts` sqlite-vec impl'ini sarar; `chroma`/`hybrid` opsiyonel | YOK (Faz 1, çekirdek) |

**Kütüphane eşleme (odysseus Python → ollamas Node):**

| İşlev | odysseus (Py) | ollamas (JS) önerisi | Neden |
|---|---|---|---|
| Vektör DB | `chromadb` | `sqlite-vec` (mevcut) | saf-JS loadable ext, native addon yok, SEA/Cloud-Run uyumlu; Chroma opsiyonel-MCP |
| Local embed | `fastembed` (ONNX) | `@xenova/transformers` (transformers.js) **veya** `fastembed` (npm) | gömülü ONNX, daemon'suz; WASM/ONNX runtime saf-JS |
| Bulut embed | (yok / OpenAI) | `embed-catalog.ts` (mevcut) | voyage/jina/gemini/cloudflare free-tier + local fallback |
| Chunking | LangChain splitter | küçük saf-TS chunker (`chunkText`) | bağımlılık şişmesi yok; overlap'li recursive-char |
| MCP server | `mcp` (Py SDK) | `@modelcontextprotocol/sdk` (mevcut, `package.json`) | ek MCP altyapısı gerekmez, choke-point otomatik expose |

> **Karar gerekçesi (02-architecture.md ile hizalı):** ChromaDB ayrı bir servis süreci (Docker,
> `localhost:8100`) ister — ollamas **SEA single-executable + Cloud Run** hedefler, ek daemon
> **istenmez**. Bu yüzden **sqlite-vec varsayılan kalır** (gömülü, sıfır-servis); ChromaDB yalnız
> **opsiyonel MCP backend** olarak `VectorStore` arayüzü arkasına eklenir. Local embed için de aynı
> ruhla **gömülü-ONNX** (daemon'suz) tercih edilir; ollama-daemon tier korunur ama artık tek local
> yol değildir.

---

## 3. Hedef Plan (TDD-adımlı — her adım: önce test, sonra implementasyon)

> **Disiplin:** her Faz'da (1) failing test → (2) minimal implementasyon → (3) yeşil → (4) refactor.
> Test runner: `vitest` (mevcut). **Kritik:** rag.ts'in bugünkü testsizliği (K1) Faz 0'da kapatılır —
> refactor'dan ÖNCE mevcut davranışa contract test yazılır (regresyon kalkanı).

### FAZ 0 — Regresyon kalkanı + iskele (kapı: mevcut davranış kilitli)

> **Neden önce:** `rag.ts` refactor'lanacak (VectorStore'a sarılacak); testsiz refactor = kör uçuş.

**Test önce** — `server/__tests__/rag.test.ts` (injectable embedder ile deterministik):
- Sahte embedder (`text→sabit vektör`) enjekte et → `index()` sonra `search()` aynı doc'u döndürür.
- `index()` aynı id ile ikinci kez → upsert (tek satır kalır, eskisi silinir).
- Dim mismatch (farklı uzunlukta vektör) → tiplenmiş hata (`ensureVec`).
- Provider mismatch (farklı `embedProvider`) → tiplenmiş hata (`ensureProvider`).
- `pickEmbedProvider`: pin yok → null; geçersiz pin → null; key yoksa → null; cloudflare acct yoksa → null.
- `parseEmbedResponse`: boş data → throw; index'e göre sıralar.

**Implementasyon** — sadece iskele (davranış değişmez):
- `server/vector-store.ts` — `VectorStore` arayüzü (aşağıda Faz 1) için boş dosya + tip export.
- **Kapı:** `npm test` (yeni rag testleri yeşil) + `tsc --noEmit` + `npm run build`.

### FAZ 1 — VectorStore soyutlaması (çekirdek — `memory_provider.py` emsali)

**Test önce** — `server/__tests__/vector-store.test.ts`:
- `createVectorStore({ backend: "sqlite-vec" })` → mevcut `rag.ts` davranışını aynen verir
  (index/search/close kontratı; Faz 0 testleri bu arayüz üstünden de geçmeli).
- Backend-agnostik kontrat: aynı test hem `sqlite-vec` hem sahte `memory` backend ile yeşil.
- `VECTOR_BACKEND=chroma` ama Chroma erişilemez → net hata / honest-empty (crash yok).

**Implementasyon** — `server/vector-store.ts`:
```
export type VectorBackend = "sqlite-vec" | "chroma" | "memory";
export interface VectorDoc { id: string; text: string; metadata?: Record<string, string | number>; }
export interface VectorHit { id: string; text: string; distance: number; metadata?: Record<string, string | number>; }
export interface VectorStore {
  upsert(collection: string, docs: VectorDoc[]): Promise<{ count: number; dim: number }>;
  query(collection: string, query: string, opts?: { k?: number; filter?: Record<string, string | number> }): Promise<VectorHit[]>;
  deleteCollection(collection: string): Promise<void>;
  close(): void;
}
export function createVectorStore(opts?: { backend?: VectorBackend; embed?: Embedder; ... }): VectorStore
```
- **`sqlite-vec` impl:** mevcut `createRagStore` mantığını **taşır** (yeniden yazmaz); `collection`
  için tablo-adı/namespace kolonu ekler (`rag_docs.collection`), metadata JSON kolonu ekler.
- `rag.ts` `createRagStore` → `createVectorStore({ backend: "sqlite-vec" })` üstünde ince sarmalayıcı
  olur (geriye-uyum: `ragIndex/ragSearch` imzaları korunur → tool-registry kırılmaz).
- **Reuse:** `resolveEmbedder` + dim/provider kapıları **aynen** (bunlar backend-üstü, taşınır).
- `memory` backend: test/CI için saf-RAM kosinüs (sqlite-vec yüklenemeyen ortam kalkanı).

### FAZ 2 — Gömülü-ONNX local embedding (FastEmbed emsali, opt-in)

**Test önce** — `server/__tests__/embed-onnx.test.ts` (ağır model indirmesi CI-gate'li):
- `EMBED_PROVIDER=onnx` → `resolveEmbedder` gömülü embedder döner (ollama daemon'a bağlanmaz).
- Kısa metin → sabit-uzunlukta sayısal vektör (dim > 0, deterministik yön).
- Model indirilemez/offline → **local ollama'ya** temiz fallback (mevcut terminal-tier korunur).
- Boyut, `sqlite-vec` dim-kapısıyla uyumlu (indeks kurulabilir).

**Implementasyon** — `server/embed-onnx.ts` + `embed-catalog.ts` genişletme:
- `@xenova/transformers` (transformers.js, saf-JS ONNX-runtime WASM) veya `fastembed` (npm) ile
  `bge-small-en` / `all-MiniLM-L6-v2` gömülü embed. Model cache `~/.llm-mission-control/onnx/`.
- `resolveEmbedder`'a `onnx` dalı ekle: pin `onnx` → gömülü; **fail → local ollama** (terminal-tier
  değişmez). Bulut→local→onnx sıralaması: onnx yalnız açıkça pin'lenince devreye girer.
- **Native-binding taraması (K2):** `npm ls` ile C++ addon gelmediğini doğrula (WASM tercih);
  gelirse `sea-config.json` bundling'i kırılır → bu Faz 2 kapısı.
- **Config:** `.env` `EMBED_PROVIDER=onnx`, `EMBED_ONNX_MODEL`, kapalı-varsayılan (opt-in).

### FAZ 3 — Chunking + documents entegrasyonu (köprü — parity'nin kalbi)

> **Bağ:** `documents.md` FAZ 1 `extractText()` **kaynak metni** üretir; bu Faz onu **RAG'a akıtır**.

**Test önce** — `server/__tests__/rag-ingest.test.ts`:
- `chunkText(long, { size, overlap })` → overlap'li parçalar; kısa metin → tek chunk; boş → [].
- `indexDocument({ relativePath })` (mock `extractText`) → N chunk indekslenir, her biri
  `metadata={ source, path, kind, chunkIndex }` ile; `id = path#chunkIndex`.
- Aynı belgeyi yeniden ingest → eski chunk'lar temizlenir (koleksiyon-içi doc-prefix upsert).
- `rag_search` sonucu chunk metadata'sıyla döner (citation için `path` + `chunkIndex`).

**Implementasyon:**
- `server/rag.ts` (veya yeni `server/rag-ingest.ts`): saf-TS `chunkText()` (recursive-char, overlap)
  + `indexDocument()` = `readFileBuffer` (files.ts reuse) → `detectKind`+`extractText`
  (documents.ts, documents.md FAZ 1) → `chunkText` → `store.upsert(collection, chunks)`.
- **Reuse:** `FilesystemManager.resolveSafePath` (path guard yeniden yazma) + documents extract.
- Yeni tool `rag_ingest_document` (tool-registry, tier `host`) → belge yolunu alıp indeksler.

### FAZ 4 — RAG MCP yüzeyi + koleksiyon/citation (`rag_server.py` emsali)

**Test önce:**
- `rag_search` çıktısı `filter` (koleksiyon/source) parametresi kabul eder (route/tool testi).
- MCP `resources/list` → `rag://` koleksiyon kaynakları listelenir (mevcut `file://` bozulmadan).
- MCP `resources/read rag://<collection>/<docId>` → chunk metni + metadata döner.
- Citation: `rag_search` sonucu `path#chunkIndex` içerir (agent atıf üretebilir).

**Implementasyon:**
- `server/tool-registry.ts` `rag_search` schema'sına `collection?` + `filter?` ekle (geriye-uyumlu).
- `server/mcp/server.ts` `resources/list`/`read`'e `rag://` şeması ekle (documents.md K8 ile aynı
  MCP resource deseni) → personal-docs koleksiyonu MCP resource olarak görünür.
- (Opsiyonel) `server/mcp/prompts.ts`'e "answer-with-citations" RAG prompt'u.

### FAZ 5 — Modül-store kalıcılığı + opsiyonel Chroma backend (parity tamamlama)

**Test önce:**
- İndekslenen belgeler `server/store/` üzerinden kalıcı (yeniden başlatmada koleksiyon listesi durur).
- `VECTOR_BACKEND=chroma` (opsiyonel MCP/HTTP) → aynı `VectorStore` kontratı testi yeşil (Chroma ayakta
  ise); Chroma yoksa `sqlite-vec`'e otomatik düşer (honest degrade).

**Implementasyon:**
- `store/` içinde `rag_collections` metadata kalıcılığı (KN-M4 üç-DB birleşmesinin RAG ucu).
- `server/vector-store.ts`'e `chroma` backend impl (async HTTP, `CHROMA_URL`) — opt-in, opsiyonel.

---

## 4. Parity Kabul Kriteri (odysseus-parity — "bitti" tanımı)

Aşağıdakilerin **hepsi** yeşil olduğunda RAG/vector modülü odysseus-parity sayılır:

- [ ] **P0** `rag.ts` contract testleri yeşil (index/search/upsert/dim-guard/provider-guard) — regresyon kalkanı.
- [ ] **P1** `VectorStore` arayüzü VAR; `sqlite-vec` impl mevcut davranışı korur; `memory` backend testte çalışır (pluggability = `memory_provider.py` emsali).
- [ ] **P2** Gömülü-ONNX embedding (`EMBED_PROVIDER=onnx`) daemon'suz vektör üretir; fail → local ollama fallback (FastEmbed emsali).
- [ ] **P3** `chunkText` + `indexDocument`: uzun PDF/DOCX chunk'lanıp indekslenir, her chunk `source/path/kind/chunkIndex` metadata'lı (documents.md köprüsü).
- [ ] **P4** `rag_ingest_document` tool ReAct döngüsünde belge yolu alıp indeksliyor.
- [ ] **P5** Koleksiyon/namespace + `filter`: `rag_search` kaynağa göre süzülebiliyor; sonuç citation (`path#chunkIndex`) içeriyor.
- [ ] **P6** RAG MCP resource (`rag://`) `resources/list`+`read`'te görünüyor; mevcut `file://` bozulmadı (`rag_server.py` emsali).
- [ ] **P7** Config-driven: `EMBED_PROVIDER` (bulut/onnx/local), `VECTOR_BACKEND` (sqlite-vec/chroma), `RAG_DB_PATH` toggle'ları etkili.
- [ ] **P8** Kalıcılık: indekslenen koleksiyonlar `store/` üzerinden yeniden-başlatmada duruyor (KN-M4 RAG ucu kapandı).
- [ ] **P9** Regresyon yok: mevcut `rag_index`/`rag_search` tool imzaları + `/mcp` expose çalışıyor; SaaS DB extension'sız açılmaya devam ediyor.
- [ ] **P10** Build kapısı: `tsc --noEmit` + `npm run build` + SEA build temiz (native-binding/daemon girmedi; WASM/loadable-ext saf-JS).

**Odysseus'ta olup bu planda BİLEREK dışarıda bırakılan** (parity-dışı, ayrı iş):
ChromaDB'yi **varsayılan** yapmak (sqlite-vec varsayılan kalır; Chroma yalnız opsiyonel-MCP);
hibrit (dense+sparse/BM25) arama; reranker entegrasyonu (voyage/jina reranker key'i VAR ama ayrı
feature); OCR/görüntü embedding; dağıtık/çok-node vektör kümesi. Bunlar 10-roadmap'te ayrı satır.

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tür | Kayıt | Etki | Azaltım |
|---|---|---|---|---|
| K1 | **Risk (yüksek)** | `rag.ts`'in **hiç testi yok** (`grep rag *.test.ts` → boş), oysa dosya başı "contract test" varsayıyor. Refactor testsiz = regresyon körlüğü | Yüksek | **Faz 0 önce**: refactor'dan ÖNCE mevcut davranışa contract test (regresyon kalkanı) — VectorStore'a sarmadan önce yeşil olmalı |
| K2 | Varsayım | Local ONNX (`@xenova/transformers`/`fastembed`) saf-JS/WASM ve SEA-uyumlu, native C++ addon getirmez | Yüksek — yanlışsa Faz 2 kapısı çöker | Faz 2 T-kapısı: `npm ls` native-binding taraması; WASM-runtime tercih; getiremezse `onnx` tier'ı opsiyonel bırakılır, ollama-daemon local tier korunur |
| K3 | Karar | ChromaDB **varsayılan yapılmıyor** (ayrı Docker servisi, SEA/Cloud-Run ile çelişir); yalnız opsiyonel-MCP | Orta | 02-architecture.md kararı: `sqlite-vec` default, `VECTOR_BACKEND=chroma` opt-in; parity "davranış"ta değil "pluggability + personal-docs MCP yüzeyi"nde tanımlandı |
| K4 | Risk | `sqlite-vec` loadable extension **her ortamda** yüklenmeyebilir (SEA/Cloud-Run/CI); `DatabaseSync({allowExtension:true})` platforma bağlı | Orta | `memory` backend fallback (Faz 1) + Faz 0'da yükleme-başarısızlığı honest-empty; CI'da extension-yoksa `memory` ile geç |
| K5 | Bilinmeyen | Chunk boyutu/overlap (embed model context vs geri-çağırma dengesi); yanlış chunk → düşük recall | Orta | Faz 3'te config'lenebilir (`RAG_CHUNK_SIZE`/`RAG_CHUNK_OVERLAP`); varsayılan ~512 token / ~64 overlap, model-farkında |
| K6 | Risk | Provider tutarlılık kapısı (`ensureProvider`) **koleksiyon-başına** olmalı, indeks-başına değil — çok-koleksiyonda tek `rag_meta` dim/provider tüm koleksiyonları kilitler | Orta | Faz 1'de `rag_meta`'yı koleksiyon-scoped yap (`meta(collection,k,v)`); tek-koleksiyon davranışı geriye-uyumlu |
| K7 | Bilinmeyen | odysseus repo (isim/modül) prompt'tan; `rag_server.py`/`memory_provider.py` iç imzaları doğrulanmadı | Orta | Parity kriterini odysseus **davranışına** göre değil, listelenen alt-yeteneklere (pluggable/local-embed/MCP-resource/chunk) göre tanımladık; API imzaları ollamas'a özgü |
| K8 | Varsayım | `documents.md` FAZ 1 `extractText()` bu plan öncesi/paralel biter (Faz 3 ona bağımlı) | Orta | Faz 3'te `extractText` mock'lanır (test); üretimde documents.md P1 kapısına bağlı — 10-roadmap sıralaması: documents → rag-vector |
| K9 | Risk | Gömülü ONNX modeli ilk-çalıştırmada indirir (offline/Cloud-Run cold-start gecikme + disk) | Düşük-Orta | Model cache + lazy-load; offline → local ollama fallback; SEA'ya model gömme opsiyonel (boyut bütçesi) |
| K10 | Bilinmeyen | KN-M4 "üç-DB dünyası" birleşmesi (db.ts/store/rag.ts) bu feature'da ne kadar kapatılmalı | Orta | Faz 5'te yalnız **RAG ucu** (koleksiyon kalıcılığı) kapatılır; tam store-birleşmesi 02-architecture O0 kapsamı (kapsam-dışı) |
| K11 | Risk | `rag_index` tier `host`, `rag_search` `safe` — yeni `rag_ingest_document` dosya okur (path guard) → tier + RBAC hangi kapıya bağlanmalı | Düşük | Faz 3: `rag_ingest_document` tier `host` (file okur, `resolveSafePath` guard); search `safe` kalır |

---

*Üretici: ODYSSEY planlama üreteci. Kaynak kod okundu (Read/Grep):*
*`server/rag.ts`, `server/embed-catalog.ts`, `server/tool-registry.ts` (rag block 743–786),*
*`server/mcp/server.ts`, `package.json` (deps), `docs/odyssey/05-features/documents.md`,*
*`docs/odyssey/00-MASTER.md` (KN-M4), `docs/odyssey/02-architecture.md` (VectorStore kararı).*
*Tarih: 2026-07-10.*
