# BRAIN-INTEGRATION — aktivasyon durumu (dürüst, 2026-07-16 · son: 2026-07-18)

Bu doküman brain'in ollamas'a NE KADAR entegre olduğunu YALANSIZ anlatır — neyin canlı-aktif, neyin merge'e bağlı olduğu.

## Aktivasyon matrisi (Tur 17 — artık DEFAULT ON)

2026 SOTA: hafıza otomatik olmalı (recall her turn öncesi, retain her turn sonrası; model tool çağırmaz). Bu tur brain'i "tool'u var" → "gerçekten hatırlıyor" yaptı:

| Davranış | Default | Flag (opt-out) | Ne yapar |
|---|---|---|---|
| Auto-recall | **ON** | `BRAIN_AUTO_RECALL=0` | Her ReAct turn'ünde ilgili hafıza system-prompt'a enjekte (best-effort 4s, $0 local embed) |
| Per-turn retain | **ON** | `BRAIN_AUTO_RETAIN=0` | Her turn sonrası user+assistant exchange'i working-tier'a async yaz (embed-only, $0, LLM YOK) |
| Periyodik distill | **ON** | `BRAIN_AUTO_DISTILL=0` | Her 10 mesajda durable extraction; provider default keyless pollinations ($0) |
| Otonom bakım | **ON** (launchd) | — | Günlük 04:00 sweep+consolidate+drift |
| MCP expose | **OFF** | `BRAIN_MCP_EXPOSE=1` | brain_* dış MCP istemcilerine kapalı (operatör hafızası güvenliği) |

## CANLI kanıt (worktree server, 2026-07-16)

Bu worktree'den `PORT=3009 npx tsx server.ts` ile server boot edildi (keyless provider, De-load-safe). HİÇBİR `BRAIN_AUTO_*` env verilmeden:
- `POST /api/agent/chat` "ollamas deploy nasıl?" → agent koştu.
- **Retain doğrulandı**: canlı brain.db'de yeni `working` memory belirdi: `S: ollamas deploy nasil... / Y: ...` — agent tool çağırmadan exchange'i sakladı.
- **Recall doğrulandı**: seed core memory + yeni turn-memory ikisi de `recall("deploy")` ile geldi.
- Server kanıt sonrası kapatıldı (De-load).

→ **Brain, bu worktree'den koşan server'da DEFAULT AKTİF çalışıyor.**

## GERÇEK durum — B-PATTERN PORT TAMAMLANDI (2026-07-18, YALANSIZ)

- ff-merge 19↔34 ayrışma yüzünden İMKANSIZLAŞTI → Emre **Seçenek B** onayladı: brain deltası
  `69986e2` emsaliyle MAIN'e (`feat/v-final-train`) commit olarak taşındı.
- Taşınan: brain.ts tam sürüm (P1-P4 dahil: embed-cache/usageBoost/tierRecency/graphExpand/
  importance-prune) + brain-active/context/distill + embed-cache + tüm brain script'leri +
  eval + testler + server.ts wiring (auto-recall/retain/distill + /api/brain/*) + ns-jail +
  MCP gate + openapi spec'leri + Makefile hedefleri.
- launchd `com.ollamas.brain-maintain` artık MAIN yolundan koşar; `com.ollamas.server`
  restart'ı brain'i + `SEMANTIC_CACHE=1`'i birlikte aktifleştirir.
- ~~Git-capture hook'ları main'e KURULMADI~~ → **2026-07-18 KURULDU** (`make brain-hooks`;
  hook paylaşımlı gate'e ZİNCİRLİ — gate korunur, capture best-effort öne eklenir).
- Worktree lane'i brain'in geliştirme sahibi olmaya devam eder; yeni brain işi wt'de yapılır,
  aynı B-pattern ile porta taşınır.

## TAMAMLAMA TURU + PRODUCTION RESTART (2026-07-18, TAM CANLI — YALANSIZ)

9/9 denetim gap'i main'de shipped (`c123d98..e2488b4`) ve `com.ollamas.server` restart'ı
SONRASI :3000'de HEPSİ canlı-kanıtlı:

| Özellik | Canlı kanıt |
|---|---|
| `POST /api/brain/remember` choke-point | 200 `{id,dim:768}` gerçek-nomic; explicit-id re-POST idempotent |
| Org conductor dual-write mirror | server.log'da UA=node remember POST'ları; brain.db `ns='org'` 124→125+ (gerçek REPAIR kayıtları akıyor) |
| `/brain` paneli | Chrome görsel: self-hit %100 yeşil, tier dağılımı, entity-graf render |
| Drift-probe ns-fix (`ba55077`) | health selfHitRate 1.0 / drift false (org-ns kayıtlarıyla birlikte) |
| Session-end distill (S1) | idle-timer 10dk `BRAIN_DISTILL_IDLE_MS`; retain rejresyonsuz (working +1/chat-turu) |
| `BRAIN_RERANK=1` (.env) | recall canlı, degrade yok; kanıt golden-set MRR 0.8562→0.9531 |
| Fact hijyeni + gece MRR | maintain: fact-prune 30g retention + `brain.eval.mrr` satırı launchd logunda, exit 0 |
| Semantic-cache | `/api/cache` enabled:true (sayaçlar in-memory, restart'ta sıfırlanır — normal) |

## Nasıl doğrularsın (herkes)

```
PORT=3009 npx tsx server.ts        # worktree'den boot
# başka terminalde: POST /api/agent/chat → sonra:
make brain-show                    # working-tier'da turn-memory'ler görünür
```
