# BRAIN-SERVICES — 50 Kritik Servisin Kataloğu (tek gerçeklik kaynağı)

> **50-servis kontratı:** `server/brain-services.ts` registry'si TAM 50 servis beyan eder
> (`validateBrainRegistry {expectCount:50}`); her biri canlılığını KANITLAYAN bir selftest taşır.
> Koşucu: `make brain-services` (OFFLINE=1 :3000 probe'larını atlar) — kırmızıda exit 1.
> S26-S50 entegrasyon katmanı aşağıda §S26-S50'de.

> Mimari karar (T0, 2026-07-18): 25 servis **modüler in-process** — tek server (:3000) +
> mevcut launchd daemon'ları arkasında tanımlı-kontratlı modüller. 25 ayrı daemon
> REDDEDİLDİ ($0 / zero-dep / De-load yasaları: bellek-CPU maliyeti, 25 arıza yüzeyi).
> Her servis: pure-core + thin-IO, fake-embed/tmp-db ile determinist test, graceful-degrade.

## Çekirdek depo + retrieval (S1–S8)

| # | Servis | Kontrat / Yüzey | Kanıt komutu |
|---|--------|-----------------|--------------|
| S1 | embed-service | `rag.resolveEmbedder` → $0 lokal nomic (`ollama-local`, 768d); `BRAIN_EMBED_FAKE=1` determinist test embedder | `make brain-e2e` |
| S2 | embed-cache | `server/embed-cache.ts` — sha256(provider,text)→f32; in-mem LRU 512 + sqlite `embed_cache` cap 5000 (sweep içinde); `BRAIN_EMBED_CACHE=0` | `/metrics` → `ollamas_brain_embed_cache_rows` |
| S3 | memory-store (5-tier) | `server/brain.ts` `brain_memories` — tier ağırlığı core1.3→working0.9 × tier yarı-ömrü (core ∞ / learned-proc 90g / epi 7g / working 1g) × usageBoost ≤ +%12 | `/api/brain/overview` |
| S4 | recall (hybrid RRF) | `recall()` = vecKNN ∪ FTS5-BM25 ∪ 1-hop graf → `rrfFuseMany` k0=60 → skor-sıralı k; ns-jail'li | `make eval-brain-mrr` (taban 0.6; canlı 0.8562) |
| S5 | rerank | `server/rerank.ts` bge-reranker ONNX ($0 lokal); `BRAIN_RERANK=1` → havuz max(3k,12) yeniden sıralanır | `make eval-rerank`; brain MRR 0.8562→0.9531 |
| S6 | write-dedup (AUDN) | `rememberOne` auto-id near-dup ≤0.08 → MERGE (core muaf, explicit-id upsert); `BRAIN_DEDUP=0` | tests/brain.test.ts dedup case'leri |
| S7 | fact-store (bi-temporal) | `assertFact` supersede + `validFrom/invalidatedAt` import-override (S22) + `searchFacts` point-in-time + `factsAbout` | `/api/brain/overview` facts/history |
| S8 | entity-graph | `buildGraph` S-P-O reify, degree=centrality, live/süperseed | `/api/brain/graph` |

## Otomatik hafıza döngüsü (S9–S13)

| # | Servis | Kontrat | Kanıt |
|---|--------|---------|-------|
| S9 | retain (per-turn) | `brain-active.buildTurnMemory` → working-tier, her chat turu, embed-only; `BRAIN_AUTO_RETAIN=0` | chat turu → working +1 |
| S10 | auto-recall | `brain-context.buildBrainContext` — turn öncesi 4s-yarış, cap 1200; `BRAIN_AUTO_RECALL=0` | chat system-prompt enjeksiyonu |
| S11 | distill | `brain-distill.distillSession` — her 10 msg + session-end idle-timer (`BRAIN_DISTILL_IDLE_MS` 10dk); $0 keyless provider; `BRAIN_AUTO_DISTILL=0` | kısa oturum → distilled memory |
| S12 | sweep/decay | `sweep()` — working-TTL + importance-prune (epi/working, eşik 0.15) + fact-prune (invalidated>30g, `BRAIN_FACT_PRUNE=0`) + embed-cache cap | `make brain-maintain` |
| S13 | consolidate | `consolidate()` — 3+ recall episodic→learned terfi; normalize-dup learned merge (hits toplanır) | maintain `promoted/merged` |

## Sağlık + yaşam döngüsü (S14–S17)

| # | Servis | Kontrat | Kanıt |
|---|--------|---------|-------|
| S14 | health/drift-probe | `health()` — son 8 learned/core self-recall KENDİ ns'inde (ba55077 fix); <0.8 ⇒ drift raporu (yıkıcı aksiyon YOK) | `/api/brain/overview` health |
| S15 | backup | `scripts/brain-backup.ts` — WAL-checkpoint + satır-sayısı restore-verify + 7g retention; maintain'e binmiş | `make brain-backup` |
| S16 | MRR-eval (gece) | `runMrrEval` — 20-altın/16-sorgu throwaway-db; maintain'de taban 0.6 altı exit 3; `BRAIN_MRR_NIGHTLY=0` | maintain logunda `brain.eval.mrr` |
| S17 | git-capture | `scripts/brain-git-capture.ts` + worktree hook'lar — commit/merge/push → episodic + branch fact; 3s fast-fail, commit'i asla bloklamaz | commit → `[brain] captured` |

## Entegrasyon yüzeyleri (S18–S20)

| # | Servis | Kontrat | Kanıt |
|---|--------|---------|-------|
| S18 | org-mirror (dual-write) | `orchestration/bin/lib/brain-ledger.ts` — JSONL sync-otorite + fire-and-forget `POST /api/brain/remember` (sha1-determinist id, ns=org, orijinal ts); ORG_STATE_DIR izolasyon-seam; `ORG_BRAIN_MIRROR=0/1` | server.log UA=node POST'lar; `ns='org'` satır artışı |
| S19 | remember choke-point API | `POST /api/brain/remember` + GET overview/graph + POST distill/:id — module top-level (NO_AUTOBOOT test-erişilebilir); openapi'li | tests/brain-panel.test.ts |
| S20 | panel | `/brain` inline-HTML — health badge + tier dağılımı + fact tablosu + graf SVG, 15s poll | Chrome: :3000/brain |

## Tamamlama turunda inşa edilenler (S21–S25, 2026-07-18)

| # | Servis | Kontrat | Kanıt |
|---|--------|---------|-------|
| S21 | brain-metrics | `server/brain-metrics.ts` — /metrics'e pull-time gauge'lar (memories{tier}, facts{status}, db_bytes, embed_cache_rows) + maintain-log'dan self_hit_rate/last_exit (scrape ASLA embed etmez) + `brainRecall` latency histogramı (iç probe recall'ları hariç); `BRAIN_METRICS=0` | `curl :3000/metrics \| grep ollamas_brain` |
| S22 | brain-portable | `server/brain-portable.ts` — versiyonlu vektörsüz JSON dump/restore; explicit-id idempotent merge; heat+timestamp+bi-temporal tarih korunur; vektörler embed-yolundan yeniden | `make brain-export` / `brain-import FILE= [DRY=1]` |
| S23 | brain-reembed | `server/brain-reembed.ts` — drift REMEDİASYONU: backup-guard → vec0 DROP+CREATE(yeni dim) → batch re-embed → meta (embed_provider+dim) EN SON atomik flip; yarıda kalma = meta eski → drift işaretli kalır | `make brain-reembed [DRY=1]` |
| S24 | brain-redact | `server/brain-redact.ts` — `rememberOne` TEK enforcement noktası (tüm yazım yolları); repo-geneli gitleaks/secretlint kuralları yeniden kullanılır; enforce=maskeli persist+embed / report / 0; `BRAIN_REDACT_EMAIL=1` | tests/brain-redact.test.ts; log `brain.redact` |
| S25 | brain-consistency | `server/brain-consistency.ts` — rapor-only invariant bekçisi: canlı-fact tekilliği, vec/fts sync (bağlantı sqlite-vec YÜKLEMELİ — düz bağlantı vec0 okuyamaz), case-variant özneler; maintain'e binmiş, exit 0 kalır; `BRAIN_CONSISTENCY=0` | `make brain-check` |

## §S26-S50 — Entegrasyon katmanı (brain ↔ TÜM ollamas, 2026-07-18 ikinci tur)

**Belirleyici kural:** kaynakta dayanıklı depo yoksa (callback/geçiş/pure-sonuç) sinyal ANINDA kaybolur → S26 bus üstünden event-driven agregat; dayanıklı kaynaklar (jsonl/katalog/db/policy-dosyası) gece maintain'de cursor'lı batch. Tüm yazımlar store choke-point'inden (redaction+AUDN+ns-jail), `ops` ns'e (chat/org kirlenmez), `deterministicId` + günlük `budgetAllow` ile.

| # | Servis | Kontrat |
|---|---|---|
| S26 | brain-bus | tipli pub/sub; emit asla throw/blok etmez; `getBusStats` dead-letter görünürlüğü |
| S27 | service-registry | ServiceSpec[50], validate unique/deps/tam-50 |
| S28 | services-runner | `make brain-services` — selftest sweep, exit-1-on-red |
| S29 | seyir-ingest | jsonl byte-cursor tail → episodic (telemetri-gürültüsü filtreli) |
| S30 | tool-outcome | onUsage → GÜNLÜK tool-başına procedural (bin çağrı = 1 satır) |
| S31 | error-memory | recordError emit → signature-dedup günlük learned |
| S32 | provider-facts | key-health snapshot POLL → yalnız-değişim fact |
| S33 | council-memory | scoreCouncil emit → model-başına günlük learned ortalama |
| S34 | job-outcome | job record emit → günlük episodic rollup |
| S35 | upstream-facts | MCP supervisor snapshot POLL → durum fact'leri |
| S36 | kev-facts | KEV katalog delta (seen-set sınırlı) → fact |
| S37 | champion-fact | şampiyon POLL → supersede'li fact |
| S38 | hierarchy-snapshot | policy dosyası content-hash değişiminde → procedural |
| S39 | recall-api | `POST /api/brain/recall` dış sorgu yüzeyi |
| S40 | facts-api | `GET /api/brain/facts?subject&at` bi-temporal sorgu |
| S41 | rag-bridge | rag_docs → konu fact'leri (seen-set) |
| S42 | session-link | source=sessionId sorgusu — `GET /api/brain/session/:id` + distill emit |
| S43 | tenant-seed | tenant create → kendi ns'ine core tohum + ops fact |
| S44 | align-memory | verifier verdict emit → günlük learned |
| S45 | bus-metrics | bus event/handled/failed/denied gauge'ları /metrics'te |
| S46 | ingest-budget | kaynak-başına günlük yazım bütçesi (BRAIN_INGEST_BUDGET) |
| S47 | restore-drill | haftalık DR kanıtı: dump→throwaway-restore→recall smoke |
| S48 | pressure-governor | db/episodic/cache bütçe izleme → rapor-only öneri |
| S49 | xns-recall | admin cross-ns (env+loopback çift kilit; kullanım fact'lenir) |
| S50 | e2e-proof | usta selftest: bus→fold→write(redacted)→recall→fact→export→consistency tek zincirde |

## Destek yüzeyleri (50 sayımı dışında)
semantic-cache (LLM-yanıt katmanı, `SEMANTIC_CACHE=1` + near-miss telemetri) · brain-sync-registry (PROBLEM_REGISTRY→learned) · maintain-orkestratörü (launchd 04:00, sıra: consolidate→sweep→health→consistency→mrr→backup) · MCP-gate (`BRAIN_MCP_EXPOSE`) · tenant-ns-jail (`brainNs`) · git-hook zinciri (paylaşımlı gate korunur).

## Bilinen sınırlar (dürüstlük)
- Consistency rowid-korelasyonu: sqlite rowid-reuse, store-arkası DELETE+INSERT'te yanlış-içerik eşleşmesini gizleyebilir (deleteMemRow üçünü birlikte siler; content-hash bilinçli kapsam dışı).
- Redaction yüksek-hassasiyet kural seti: bilinmeyen secret biçimleri kaçabilir (genel entropi taraması bilinçli yok — yanlış-pozitif hafıza bozar).
- Reembed sırasında canlı server eski-dim tabloyu sorgularsa geçici recall hatası olası — remediation operasyonu maintain-penceresi işidir.
