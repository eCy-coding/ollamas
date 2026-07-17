# BRAIN — Master System-Design Prompt (v1, 2026-07-16)

Bu doküman, "zero-latency Brain↔Memory sistemi" mega-prompt'unun **master-seviye, kaynak-doğrulanmış** yeniden yazımıdır. Orijinal prompt tek-atışta CUDA+PagedAttention+agent-memory'yi "raw production code" olarak istiyordu — 2026 pratiğinde bu halüsinasyon üretir. Aşağısı aynı niyeti (Brain=compute, Memory=hiyerarşi) **spec-driven, ölçülebilir, iteratif** bir sözleşmeye çevirir ve ollamas'ta GERÇEKTEN shipped olan katmanlara bağlar.

Versiyonlu prompt kütüphanesi disiplini (enterprise best-practice): bu dosya değişince sürüm+tarih güncellenir.

---

## §0 — Nasıl kullanılır

1. Bu bir **spec-prompt**, tek-atış kod siparişi değil. §1 ortam-beyanını DOLDURMADAN başlama — boş bırakılırsa model donanım/stack uydurur (halüsinasyonun #1 kaynağı).
2. Katmanları (L1→L4) **sırayla** işlet; bir katmanın kabul kapısı geçmeden sonrakine geçme.
3. Teslim **iteratif**: en küçük çalışan dilim → ölç → sonraki dilim. "Placeholder yok" kuralı iterasyonlar ARASINDA değil, bir iterasyonun İÇİNDE geçerli.

## §1 — ROLE & CONTEXT (ortam-beyanı zorunlu, EN BAŞTA)

```
Rol: Senior LLM systems + memory engineer. (Persona-şişirme yok — "20 yıl" gibi
     ölçülemez sıfatlar talimat bütçesi yakar, çıktıya katkısı kanıtlanmamıştır.)

ORTAM (DOLDUR — boş bırakma):
  Donanım        : <örn. Apple M4 / 1× RTX 6000 Ada / H100 80GB>
  Serving stack  : <örn. vLLM 0.x / SGLang / MLX / llama.cpp / ollama>
  Bütçe/kısıt    : <örn. $0? zero-dependency runtime? on-prem/data-residency?>
  Var olan kod   : <yeniden İCAT ETME — mevcut repo yolları / vLLM / bu brain modülü>
  Hedef iş yükü  : <bağlam uzunluğu, eşzamanlılık, gecikme/throughput önceliği>
```

## §2 — Katmanlı mandate (spec-driven, ölçülebilir)

Talimat ile veri ayrımı: her katman `### GİRDİ / ### ÇIKTI / ### KABUL` bloklarıyla.

### L1 — Inference-runtime memory (KV cache) — DONANIM-KOŞULLU
- Serving stack'in paged KV cache'ini **AYARLA, yeniden yazma** (block size, prefix caching, eviction policy). vLLM/SGLang/FlashInfer olgun; sıfırdan CUDA kernel = YAGNI.
- Eviction gerekiyorsa yayınlanmış yöntemleri **ÖLÇÜMLE** seç: H2O (heavy-hitter), SnapKV, PagedEviction. İddia değil, ölçüm.
- **Fiziksel gerçek**: token eviction paged GPU bloğunu boşaltmaz — blok ancak tamamen boşalınca serbest kalır (NVIDIA infra). Buna göre tasarla; "belleği anında geri ver" hedefi koyma.
- Apple Silicon / CUDA-yok ortam: bu katman **atlanır** — inference cloud/ollama'ya delege. (ollamas kararı.)

### L2 — Agent memory (AYRI yaşam döngüsü: gün/ay, ms değil)
Tiered semantic memory + bi-temporal fact grafı, tek embedded store:
- Tier'lar (agentmem): core/procedural/learned/episodic/working; recall = yakınlık × tier-ağırlık × recency-decay.
- Bi-temporal fact'ler (graphiti): `valid_from`/`invalidated_at` — değişen değer eskisini invalidate eder, silmez; point-in-time sorgu.
- Ring-buffer working (bounded scratchpad), non-blocking distill (episode→memory, execution'ı bloklamadan).
- **ÇIKTI**: choke-point tool'lar (write=host, read=safe); tenant izolasyonu (ns-jail).

### L3 — Self-observation (drift SOMUT tanımlı)
- Metrikler OTel `gen_ai.*` şemasıyla (SDK zorunlu değil, alan adı hizası yeter): latency, tok/s, cache-hit, memory-op sayıları.
- **"Context drift" tanımı** (mega-prompt'un muğlak bıraktığı): probe self-recall — son N learned/core hafıza kendi içeriğiyle top-1 kendini bulmalı; `selfHitRate < eşik (örn 0.8)` ⇒ drift = embedding uzayı kaydı (model swap/decay).
- Aksiyon: rapor + öneri. Yıkıcı otomatik aksiyon (re-embed) **opt-in** — safety-critical kayıtlar korunur (SSGM).

### L4 — Otonom bakım (four-lever, zamanlanmış "sleep-time compute")
- **decay + eviction**: working-tier TTL düşer (kalıcı tier'lar asla).
- **merge + promote**: normalize-duplikat birleşir; sık-recall episodic → learned terfi.
- **drift**: L3 probe; sağlıklı=exit 0, drift=exit≠0 (cron alarmı).
- Idle/sleep-time zamanla (launchd/cron/idle-thread) — agent çağırmasına gerek yok. Non-blocking.

## §3 — Anti-hedefler (ne YAPMA — karşı-örnek örnekten güçlüdür)

| Yanlış | Doğru | Kaynak |
|---|---|---|
| "zero-latency", "<1µs inter-block sync" | Ölçülen baz → hedef delta (örn "TTFT −20% @8k ctx"). Kernel launch tek başına ~µs'ler | fiziksel |
| Tek yanıtta tam production kod | İteratif: en küçük dilim → ölç → sonraki | spec-driven 2026 |
| "DMS" gibi uydurma isim | Literatür adı: H2O/SnapKV/PagedEviction | KV-eviction araştırması |
| Mega tek system-prompt | Routing + domain prompt (bloat→halüsinasyon) | system-prompt best-practice |
| "Elite 20+ yıl" persona | Rol + somut yetkinlik | persona-stuffing anti-pattern |
| KV-cache ile agent-memory'yi karıştırma | AYRI katman/yaşam döngüsü (ms vs gün) | mimari |

## §4 — Kabul kapıları (her katman)

- **Determinist unit test** (fake embedder/clock) + **1 canlı smoke** + **1 benchmark** script.
- Kabul sayıları **fiziksel mümkün**; asla mutlak ("zero"), her zaman baz→delta.
- Bir prompt "bir kez çalışınca" değil, **sistematik eval geçince** biter.
- Her iterasyon raporu: (1) ne değişti, (2) nasıl koşulur, (3) taze ölçüm çıktısı.

## §5 — ollamas eşlemesi (grounded — bu repo'da CANLI)

Mega-prompt'un MacBook'ta anlamlı katmanları burada shipped (doğrulandı 2026-07-16):

| Mandate | ollamas karşılığı | Kanıt |
|---|---|---|
| L2 tiered+bitemporal memory | `server/brain.ts` (7 tool: brain_remember/recall/fact_assert/facts/ingest/sweep/health) | `make brain-show` |
| L2 hybrid retrieval (RRF) + write-dedup | recall = vektör ∪ FTS5-BM25 → `rrfFuse`; remember AUDN-lite near-dup merge | brain suite v4 |
| L2 entity graph (vector+episodic+graph üçlüsü) | `buildGraph` reify + degree-centrality; `GET /api/brain/graph` + canlı SVG harita | brain suite v5 |
| L2 non-blocking distill | `server/brain-distill.ts` + `BRAIN_AUTO_DISTILL` | `make brain-e2e` (canlı $0 zincir) |
| L2 auto-recall (okuma simetrisi) | `server/brain-context.ts` + `BRAIN_AUTO_RECALL` | tenant-ns jail (H1) |
| L3 drift tanımı + probe | `brain_health` tool, selfHitRate<0.8 | `make brain-show` health satırı |
| L4 otonom four-lever bakım | `scripts/brain-maintain.ts` (sweep+consolidate+health, exit 3=drift) | `make brain-maintain` + launchd plist |
| Kalite kapısı | `make eval-brain` ($0 keyless extraction sözleşmesi) | canlı 1/1 |
| Registry köprüsü | `make brain-sync-registry` (THINK dersleri→learned) | canlı 13/13 |
| Robustluk | WAL + busy_timeout (brain.db + rag.db) | concurrency testi |

L1 (KV/CUDA) bilinçli DIŞARIDA: Apple Silicon + $0 + zero-dep + inference delege. GPU ortamına geçilirse §2-L1 rehberi vLLM üstünde uygulanır.

## §6 — Kaynaklar

- KV eviction: H2O / SnapKV / [PagedEviction](https://arxiv.org/html/2509.04377v1) / [NVIDIA: KV compression infra](https://research.nvidia.com/labs/eai/blogs/kv-cache-compression-and-its-infra-problems/) / [CalibreOS KV-cache](https://www.calibreos.com/learn/genai-kv-cache-management)
- Agent memory: [graphiti](https://github.com/getzep/graphiti) / [mem0](https://github.com/mem0ai/mem0) / agentmem / [sleep-time consolidation](https://hindsight.vectorize.io/blog/2026/05/21/agent-memory-consolidation)
- Prompt disiplini: [anti-patterns 2026](https://www.digitalapplied.com/blog/prompt-engineering-anti-patterns-10-mistakes-2026) / [dört-disiplin](https://aetherlink.ai/en/ai-prompt-engineering-2026) / [system-prompt best-practice](https://www.buildmvpfast.com/blog/system-prompt-design-best-practices-llm-instructions-engineering-2026)

---

## EK — Kopyala-yapıştır master prompt (çekirdek, ~250 kelime)

```text
Rol: Senior LLM systems + memory engineer.

ORTAM (doldur, boş bırakma):
  Donanım: <...>  Serving: <...>  Kısıt: <$0? zero-dep? on-prem?>
  Var olan kod (reinvent ETME): <...>  İş yükü: <ctx/eşzamanlılık/öncelik>

Görev: Brain (compute) ↔ Memory (hiyerarşi) sistemini KATMAN KATMAN kur.
Sırayı bozma; bir katmanın kabul kapısı geçmeden sonrakine geçme.

L1 Inference-KV (donanım varsa): serving stack'in paged KV cache'ini AYARLA
   (yeniden yazma). Eviction gerekirse H2O/SnapKV/PagedEviction'ı ÖLÇÜMLE seç.
   Gerçek: eviction paged GPU bloğunu boşaltmaz — buna göre tasarla.
L2 Agent memory (AYRI yaşam döngüsü): tiered (core/proc/learned/episodic/working)
   + bi-temporal fact (valid_from/invalidated_at) + ring-buffer working +
   non-blocking distill. Tek embedded store; choke-point tool'lar; tenant ns-jail.
L3 Self-observation: OTel gen_ai.* metrik. "Drift"i SOMUT tanımla: probe self-recall,
   selfHitRate<0.8 ⇒ drift. Yıkıcı aksiyon opt-in; safety-critical kayıt korunur.
L4 Otonom bakım (sleep-time): four-lever (decay+eviction / merge+promote / drift-check)
   idle'da zamanla. Sağlıklı exit 0, drift exit≠0.

YAPMA: "zero-latency/<1µs" (→ ölçülen baz→delta); tek-atış tam-kod (→ iteratif);
   uydurma isim (→ literatür); mega system-prompt (→ routing+domain); persona-şişirme.

KABUL (her katman): determinist unit + 1 canlı smoke + 1 benchmark; hedefler fiziksel
   mümkün. Her iterasyon: ne değişti / nasıl koşulur / taze ölçüm.
```
