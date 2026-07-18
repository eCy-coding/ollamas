# BRAIN-GAP-2026 — 2026 Global Standart Denetimi (Google AI Mode derin-audit, 2026-07-18)

Kaynaklar: LoCoMo/LongMemEval/BEAM/MemBench/EverMemBench/GroupMemBench yetenek kategorileri (mem0.ai/blog/ai-memory-benchmarks-in-2026, xiaowu0162.github.io/long-mem-eval, arxiv 2602.01313, 2605.14498) + Mem0/Zep/Letta/supermemory üretim feature matrisi (developersdigest.tech, vectorize.io/articles/best-ai-agent-memory-systems).

Durum işaretleri: ✓ shipped (kanıt=dosya) · ◐ kısmi · ✗ eksik. "Std" = 2026 endüstri standardı mı (Google-audit cevabı).

| # | Yetenek | Std | Durum | Kanıt / Eksik |
|---|---------|-----|-------|---------------|
| 1 | Single-hop recall (IE) | Yes | ✓ | hybrid RRF + rerank, `server/brain.ts` recall |
| 2 | Multi-hop / multi-session synthesis | Yes | ◐ | `graphExpand` 1-hop var; iteratif multi-hop yok (BACKLOG) |
| 3 | Temporal reasoning / event ordering | Yes | ◐→✓ | facts bi-temporal + point-in-time ✓; **relative-time sorgu çözümleme (B2) SHIPPED** |
| 4 | Knowledge update / staleness | Yes | ✓ | fact süperseed + belief-revision (`superseded_at`, 50fcd21) |
| 5 | Abstention / grounding threshold | Yes | ✗→✓ | recall eşiksiz k döndürüyordu — **B1 SHIPPED** |
| 6 | Contradiction / belief consistency | Yes | ✓ | belief-revision 50fcd21 |
| 7 | Instruction vs preference ayrımı | Yes | ✓ | 5-tier (core/procedural sabit, learned/episodic akışkan) |
| 8 | Actor attribution (multi-party) | Yes | ✗→✓ | satırda konuşan-kimliği yoktu — **B5 SHIPPED** |
| 9 | Memory awareness / proactive recall | Yes | ✓ | auto-recall default-ON (`brain-active.ts`) |
| 10 | Provenance & confidence | Yes | ◐ | `source` alanı var; recall'da score zaten dönüyor; citation + confidence ayrı alan BACKLOG |
| 11 | Session summarization hierarchy | Yes | ◐ | distill (10-mesaj + idle) var; rolling-compression hiyerarşisi BACKLOG |
| 12 | Memory poisoning defense | Yes | ◐ | redaction-gate + A-MAC admission var; untrusted-source işaretleme BACKLOG |
| 13 | Right-to-be-forgotten (delete-by-subject) | Mixed | ✗→✓ | silme API'si yoktu — **B4 SHIPPED** |
| 14 | Audit trail (append-only ledger) | Yes | ✗→✓ | OTel log vardı ama DB-ledger yoktu — **B3 SHIPPED** |
| 15 | Failure-driven procedural learning | No (edge) | ◐ | PROBLEM_REGISTRY→learned köprüsü var (`make brain-sync-registry`); otomatik failure-hook BACKLOG |
| 16 | GPU/embedder contention yönetimi | — | ✓ | write-behind + GPU-gate (58233cb, c2c0524) |
| 17 | Counterfactual/shadow eval | — | ✓ | brain-shadow.ts f18464a |

## Faz B sırası (bu tur)
B1 abstention → B3 audit-ledger → B4 RTBF delete-by-subject → B5 actor attribution → B2 relative-time. Kalanlar (2/10/11/12/15) BACKLOG — memory dosyasında işaretli.
