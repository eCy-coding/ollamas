# BRAIN-ENGINE — tiered memory + bi-temporal facts (Tur 4, v1)

> Master system-design prompt (bu brain'i tasarlayan sözleşme, kaynak-doğrulanmış): **docs/BRAIN-MASTER-PROMPT.md**
> Aktivasyon/entegrasyon durumu (dürüst: neyin canlı, neyin merge'e bağlı): **docs/BRAIN-INTEGRATION.md**

`server/brain.ts` + 5 tool (`tool-registry.ts`). Zero yeni bağımlılık: rag.ts'in sqlite-vec
makinesi (dedicated `DatabaseSync`, injectable embedder, dim/provider guard) aynen yeniden kullanılır.
DB: `~/.llm-mission-control/brain.db` (`BRAIN_DB_PATH` ile taşınır) — rag.db'den ayrı dosya.

## Soyağacı (docs/COMPLEMENTARY-REPOS araştırması)

| Pattern | Kaynak | Buradaki hali |
|---|---|---|
| 5 hafıza tier'ı, tek SQLite dosya | agentmem | `brain_memories.tier` + `TIER_WEIGHT` (core 1.3 → working 0.9) |
| Bi-temporal fact edge'leri | graphiti | `brain_facts(valid_from, invalidated_at)` — değişen object eskisini invalidate eder, tarih sorgusu `factsAbout(s,{at})` |
| Agent kendi hafızasını yazar | Letta/MemGPT | Damıtma tool'a gömülmez; ReAct agent `EXTRACTION_PROMPT` ile damıtıp `brain_ingest` çağırır |
| Extraction ADD/UPDATE kararı | mem0 | `EXTRACTION_PROMPT` sözleşmesi + `parseExtraction` (reasoning-leakage-safe: sondan geriye JSON dener) |

## Recall matematiği

`score = (1/(1+distance)) × TIER_WEIGHT[tier] × recency`, `recency = 1/(1+gün/30)` —
taze core gerçekler öne, bayat working notları geriye. KNN overfetch (k×4+16) sonrası
tier/ns filtresi + yeniden sıralama.

## Tool'lar (choke-point)

| Tool | Tier | İş |
|---|---|---|
| `brain_remember` | host | Tek hafıza yaz (id ile upsert) |
| `brain_recall` | safe | Semantik recall (k, tier?, ns?) |
| `brain_fact_assert` | host | S-P-O fact; değişen object → süperseed, aynı → no-op |
| `brain_facts` | safe | Subject'in gerçekleri; `at` ile tarihsel görünüm |
| `brain_ingest` | host | Damıtılmış episode batch'i (yapısal ya da `raw` LLM çıktısı) |

## Kullanım akışı (session → hafıza)

1. Session biterken agent'a `EXTRACTION_PROMPT` + transcript verilir (herhangi bir provider, $0 lokal dahil)
2. Agent yanıtı → `brain_ingest {episode_id, raw}` — parse + tier'lı yazım + fact'ler episode'a bağlı
3. Sonraki session'larda `brain_recall` / `brain_facts` bağlam sağlar

## v2 (aynı gün shipped)

- **Semantik fact araması:** fact'ler `"subject predicate object"` olarak embed edilir (`brain_fact_vec`); `searchFacts(query,{k,ns,at})` KNN + geçerlilik filtresi — invalidated vektörler kalır, `at` ile tarihsel arama çalışır. `brain_facts` tool'u `query` paramıyla semantik moda geçer.
- **Unutma + konsolidasyon:** `sweep()` working-tier'ı TTL'le siler (default 7 gün); `recall()` access_count/last_access günceller; `consolidate()` sık çağrılan episodic'leri learned'a terfi ettirir (default 3 recall — agentmem "skill crystallization"). Tool: `brain_sweep` (host).
- **Session damıtma:** `server/brain-distill.ts` — transcript(tail 24K) → `EXTRACTION_PROMPT` → injectable LLM → `parseExtraction` → ingest; <2 mesaj skip, çöp yanıt 0-yazım (best-effort, throw yok). HTTP: `POST /api/brain/distill/:id` (`BRAIN_DISTILL_PROVIDER/MODEL` env, default session'ın provider'ı). Opt-in otomatik: `BRAIN_AUTO_DISTILL=1` → ReAct upsert'inde her 10. mesajda fire-and-forget.
- v1 brain.db'ler otomatik migrate olur (guarded `ALTER TABLE` + lazy `brain_fact_vec`).

## Entity graph + canlı harita (Tur 16)

2026 SOTA üretim deseni = vector + episodic + **graph** (AriGraph/Graphiti — entity-yoğun sorgular). ollamas fact'leri artık grafa reify edilir:

- **`buildGraph(facts)`** (pure): düz bi-temporal S-P-O → `{nodes:[{id,label,degree,live}], edges:[{source,target,predicate,live}]}`. Node = distinct subject∪object (id case-normalize, label orijinal), **degree = incident kenar = centrality/importance sinyali** (SOTA). Node.live = en az bir canlı kenar. Süperseed fact = non-live kenar (harita kesikli çizer, bi-temporal).
- **`BrainStore.graph({ns,at,limit})`** + `GET /api/brain/graph?limit=&at=` (local-owner, openapi). `at` ile tarihsel snapshot.
- **Canlı harita:** scratchpad `brain-map.ts` — zero-dep SVG radial layout, node yarıçapı ∝ degree, predicate-etiketli kenarlar, canlı=yeşil-düz / süperseed=gri-kesikli, 3s poll. Chrome'da kanıtlandı: `ollamas` merkez hub, yeni fact assert → node canlı belirdi (13→15 düğüm).

## 2026-SOTA retrieval (Tur 15)

Orkestra-şefi araştırma turu (2× WebSearch SOTA + Explore repo-map) iki yüksek-değerli boşluk buldu, ikisi de sıfır-dep:

- **Hybrid retrieval (RRF):** recall() artık vektör-KNN ∪ FTS5-BM25 aday listelerini **Reciprocal Rank Fusion** ile harmanlar (`rrfFuse`, k0=60), sonra tier×recency çarpanı. FTS5 node:sqlite'a gömülü (feature-detect; yoksa vektör-only fallback). Kazanç: anahtar-kelime/kod-id/isim eşleşen ama semantik ıskalanan sorgular artık bulunur (araştırma: RRF +7.4% NDCG). v1-v3 db'ler `brain_fts`'i lazy backfill'ler. `ftsQuery` sorguyu güvenli MATCH'e temizler.
- **Semantic write-dedup (AUDN-lite):** `remember()` auto-id yazımda aynı ns+tier'da near-duplicate arar (vektör distance ≤ `BRAIN_DEDUP_DISTANCE` ~0.08 ≈ cosine 0.92); bulursa MERGE (hits topla, uzun content'i tut) → recall kirlenmez ("retrieval pollution" kapandı). **core-tier ASLA** otomatik merge (kimlik güvenliği); explicit-id exact-upsert korunur; `BRAIN_DEDUP=0` kapatır.
- Ertelendi: cross-encoder rerank (model/$ gerektirir, $0-zero-dep yasası) — RRF zaten büyük kazancı verir.

## Otonom bakım — sleep-time compute (Tur 12)

Mega-prompt denetiminin L3/L4'ü ("background thread → expired episodic'i taşı" + "self-optimization loop: drift → eviction") MacBook/$0'da: agent'ın hiç çağırmasına gerek olmayan zamanlanmış bakım. Four-lever (araştırma: LightMem/MOOM offline-consolidation):

- **decay + eviction:** `sweep()` — süresi geçen working-tier düşer (core/learned/procedural ASLA silinmez, SSGM güvenlik).
- **merge + promote:** `consolidate()` — normalize-aynı learned birleşir, sık-recall episodic→learned terfi.
- **drift:** `health()` probe — `selfHitRate<0.8` ⇒ rapor + re-embed önerisi (otomatik yıkıcı aksiyon YOK).
- Koşucu `scripts/brain-maintain.ts` → tek-satır OTel JSON log (`gen_ai.operation.name=memory_maintenance`), sağlıklı exit 0 / drift exit 3 (cron alarmı). `make brain-maintain`. Daemon: `scripts/com.ollamas.brain-maintain.plist` (günlük 04:00). `BRAIN_MAINTAIN=0` kapatır.
- **0-manuel kurulum:** `make brain-bootstrap` (idempotent) — git-capture hook'ları + brain-maintain launchd agent'ı tek komutta kurar+yükler. Kurulu: agent CANLI (günlük 04:00, log `/tmp/ollamas-brain-maintain.log`). Geri al: bootstrap çıktısındaki unload komutu.
- Git-capture artık **fast-fail** (`BRAIN_CAPTURE_TIMEOUT_MS` default 3000): ollama meşgulse commit ASLA asılmaz (30s bekleme kırılganlığı kapandı), capture sessizce skip.

Brain artık tam simetrik: **yaz** (auto-distill) + **oku** (auto-recall) + **bakım** (otonom). Pasif değil.

## P1–P4 Brain/Memory-Engineer denetim turu (2026-07-18)

Tam-denetim (2 paralel Explore + gap analizi) sonrası dört faz shipped — hepsi $0/zero-dep yasasına uygun:

- **P1 embed-cache** (`server/embed-cache.ts`): `sha256(provider,text)→Float32` — in-mem LRU (512) + brain.db içinde kalıcı `embed_cache` tablosu. recall/remember/dedup aynı metni bir daha embed etmez. `BRAIN_EMBED_CACHE=0` kapatır; boyut `sweep()` içinde caplenir (`BRAIN_EMBED_CACHE_CAP` default 5000). **Drift-probe cache'i DELER** (`recall {fresh:true}`) — cache'li vektör sessiz model-swap'ı maskelerdi.
- **P3 retrieval:** (1) `usageBoost(hits)` — sık-recall +%12 tavanlı skor katkısı; tavan core/learned tier-oranının (1.13) ALTINDA → tier-sıra sözleşmesi ısıyla bozulamaz (test-guard'lı). (2) `tierRecency` — yarı-ömür tier özelliği: core=∞, learned/procedural=90g, episodic=7g, working=1g (düz 30g yerine). (3) `recall({graphExpand:true})` — fact-grafında 1-hop: semantik-yakın fact'lerin entity'lerini ANAN hafızalar üçüncü RRF kolu olur (`rrfFuseMany`).
- **P4 lifecycle:** `sweep()` importance-prune — YALNIZ episodic/working; importance = tier×recency×usageBoost (recall'ın kendi matematiği), eşik altı düşer (`BRAIN_PRUNE=0` / `BRAIN_PRUNE_THRESHOLD` 0.15). brain-maintain sırası artık consolidate→sweep (sıcak episodic önce learned'a terfi = prune'dan muaf).
- **P4 dayanıklılık:** `make brain-backup` — WAL-checkpoint + kopya + satır-sayısı restore-verify (uyumsuzsa kopyayı siler, throw) + 7 gün retention; brain-maintain'e binmiş (`BRAIN_BACKUP=0` kapatır). Canlı kanıt: 34 mem/17 fact verified.
- **P4 kalite:** `make eval-brain-mrr` — 20 altın hafıza / 16 sorgu, gerçek local embedder, MRR taban 0.6. **Canlı: MRR 0.8562 PASS** (12/16 top-1).
- Cross-encoder rerank hâlâ ertelenmiş ($0 yasası); rerank-adaptasyonu main'deki B5 rubric'inden merge sonrası değerlendirilecek.

**Merge durumu (2026-07-18 GÜNCEL):** BRAIN-INTEGRATION.md'deki `--ff-only` planı ARTIK GEÇERSİZ — parent (`feat/v-final-train`) 34 commit ileri (backend-oss Dalga merge'leri + brain v1 portu `69986e2`), bu branch 19 commit ileri → ayrışma. Seçenekler: (A) non-ff merge + brain.ts/tool-registry çakışma çözümü, (B) B3-pattern port (kalan delta parent'a commit), (C) launchd'yi worktree'den koşturmak (geçici). Karar T0 (Emre).

## Robustluk + panel backend (Tur 11)

- **Eşzamanlılık kök-fix:** brain.db + rag.db `PRAGMA journal_mode=WAL` + `busy_timeout=5000` — eşzamanlı okuyucu (viewer/panel/ikinci store) artık yazıcıyı kilitlemez ("database is locked" crash'i kapandı). Uzun-ömürlü reader store `dim`'i lazy yeniden okur (başka bağlantının yazdığı ilk vektörü görür).
- **Panel backend HAZIR:** `GET /api/brain/overview?recent=N` → `{ stats, memories[], facts[], history[], health }` tek okuma-only bundle; `brainOverview()`/`BrainStore.overview()`. Frontend BrainPanel yalnız fetch+render (LANE-HANDOFF-GAPS.md). Local-owner; tenant hafızası H1'de ns-hapsli, burada yüzeye çıkmaz.

## Sistem entegrasyonu (Tur 9)

- **Tenant izolasyonu (güvenlik):** tenant ctx'inde tüm brain_* tool'ları `ns=tenant:<id>`'e ZORLANIR; caller'ın `ns` argümanı yok sayılır → cross-tenant memory erişimi imkânsız (`server/tool-registry.ts` `brainNs`).
- **MCP expose gate:** brain_* tool'ları `/mcp` yüzeyinden (list + call) gizli, `BRAIN_MCP_EXPOSE=1` olmadıkça — operatör hafızası dış istemcilere sızmaz (`server/mcp/server.ts` `brainMcpAllowed`).
- **Auto-recall (okuma simetrisi):** `BRAIN_AUTO_RECALL=1` → ReAct system prompt'una ilgili hafıza bloğu eklenir (`server/brain-context.ts`, best-effort 4s tavan, env-kapalı default'ta sıfır etki).
- **Registry köprüsü:** `make brain-sync-registry` orchestration PROBLEM_REGISTRY proven derslerini `learned` hafızaya çeker (tek yönlü okuma, idempotent `preg:<kategori>`).
- **openapi:** `POST /api/brain/distill/{id}` envanterde.
- Kalan (başka lane): BrainPanel UI → `docs/LANE-HANDOFF-GAPS.md` SPEC'i.

## Admin işletimi (vibe-coding sürdürme, Tur 6)

- **Aç/bak:** `make brain-show` (istatistik + son hafızalar + canlı/süperseed fact'ler); `make brain-show Q="soru"` semantik recall + fact araması. Bakmak hafızayı ısıtır (access-bump) — tasarım.
- **Git öncesi otomatik yakalama:** worktree-local hook'lar (`make brain-hooks` kurar; `scripts/install-brain-hooks.sh`) her **commit / merge / push ÖNCESİ** brain'e yazar: episodic hafıza (op + branch + staged özet + son subject) + bi-temporal fact'ler (`active_branch`, `last_commit_subject`). Best-effort — ollama kapalıysa tek satır uyarı, git işlemi ASLA bloklanmaz. Kapat: `BRAIN_GIT_CAPTURE=0`. Paylaşımlı gate'e zincirlenir (pre-merge-commit dahil — merge'ler gate'i atlatamaz). Diğer lane'ler ETKİLENMEZ (`git config --worktree core.hooksPath`).
- **Agent tarafı:** iş başında `brain_recall`/`brain_facts query:`, iş sonunda `brain_ingest`; hijyen `brain_sweep` (haftalık makul).
- **Bootstrap:** admin çekirdek bilgiyi `brain_ingest` ile tohumlar (2026-07-16: 7 hafıza + 3 fact yüklendi).

## v3 (mega-prompt denetiminin L2/L3 uygulaması — MacBook/$0 gerçeğinde)

- **Working ring-buffer:** working tier ns-başına tavanlı (default 64, `workingCap`); tavan üstü en eski kayıt düşer — sınırsız scratchpad şişmesi bitti.
- **Dedupe/merge:** `consolidate()` terfi sonrası normalize-içerik duplikat learned'ları EN ESKİ id'de birleştirir, hits toplanır (`merged` sayacı).
- **Drift tanımı (somut):** probe self-recall — son 8 learned/core hafıza kendi content'iyle top-1 kendini bulmalı; `selfHitRate < 0.8` ⇒ drift (embedding uzayı kaydı — model değişimi/bozulması). Rapor-only, otomatik yıkıcı aksiyon yok. Tool: `brain_health` (safe, registry 43); `make brain-show` başlığında.
- **Gözlem:** stats += namespaces/dbBytes; distill tek-satır JSON log (OTel `gen_ai.*` alan adları, SDK dep'siz).
- **Kalite kapıları:** `make eval-brain` — extraction sözleşmesi $0 keyless canlı (1/1 PASS); `make brain-e2e` — tam zincir tek komut: $0 LLM → distill → sqlite-vec → recall/facts/health, exit 0/1.
- Bilinçli DIŞARIDA: CUDA/KV-cache katmanları (Apple Silicon + zero-dep + inference zaten delege — denetim raporu `docs/COMPLEMENTARY-REPOS.md` §4.5).

Test: `tests/brain.test.ts` 24 deterministik + 1 canlı; capture builder 4; toplam brain suite 50+ yeşil.
