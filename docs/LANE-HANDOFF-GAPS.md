# LANE-HANDOFF-GAPS — sahipli açık işler haritası (2026-07-16 keşfi)

Tur 9 keşfinin çıktısı. Bu lane (integrate-wt) brain entegrasyon boşluklarını kapattı (H1-H5);
aşağıdakiler BAŞKA lane'lerin scope'u — kanıt referanslı, öncelik sıralı. Kaynak kayıtlar:
`planlama/03-GAP.md`, `planlama/02-DOD.md` (D1-D23'ten yalnız D11 ✅), `orchestration/COMPLETION_GAPS.md`.

## Yüksek öncelik

| İş | Kanıt | Lane |
|---|---|---|
| Auth-boundary: per-tenant auth eksik, allowlist/test tamamlanmamış | 03-GAP.md:19 (GAP-001), D2 | core-server (P2 planında) |
| README kurgusal "Mission Control mesh" ürünü anlatıyor | 03-GAP.md:54 (GAP-024), D23 | docs |
| setup.sh var olmayan `bin/main.go`'yu çağırıyor (ölü Genesis) | 03-GAP.md:55 (GAP-025) | scripts |

## Orta

| İş | Kanıt | Lane |
|---|---|---|
| Billing checkout→webhook→meter e2e zinciri kanıtsız | 03-GAP.md:34 (GAP-016), D10 | contract |
| 98 .mjs dosyası TS'e taşınmadı (72'si @ts-check'li) | COMPLETION_GAPS.md:72-83 | scripts/core |
| Tam vitest+e2e FRESH koşusu bayat (2026-06-21 damgası) | 03-GAP.md:30 (GAP-012), D6/D7 | scripts |
| custom-openai/catalog agent dropdown'da yok | ReactAgentTab.tsx:211, GAP-035 | frontend |
| package.json `react-example@0.0.0`, VERSION yok (Emre-restore kararı bekliyor) | GAP-020, D17 | scripts |

## Düşük

i18n parity assert (GAP-018, frontend) · migration rollback (GAP-041, contract) · CONTRIBUTING/troubleshooting docs (GAP-026/031/032, docs) · 15 ölü backend route + 9 stub klasör (COMPLETION_GAPS, core) · Lighthouse hiç koşmadı (GAP-017, frontend) · 90 dokümante edilmemiş route (çoğu kasıtlı-internal, docs).

## Frontend lane'e hazır SPEC: BrainPanel

Brain'in canlı paneli scratchpad demosunda kanıtlandı (Chrome'da gösterildi) — kalıcı hali frontend lane'in işi:

- **Kayıt:** `src/App.tsx:113` `tabs[]` dizisine `BrainPanel` (KeyVault.tsx import pattern'i, App.tsx:5).
- **Veri: HAZIR.** `GET /api/brain/overview?recent=N` → `{ stats, memories[], facts[], history[], health }` (2026-07-16, Tur 11). Panel yalnız fetch+render yapar — backend'e ek iş YOK. openapi'de dokümante.
- **İçerik (demo şemasıyla birebir):** tier rozetleri (core/learned/procedural/episodic/working), son 20 hafıza tablosu (id/tier/içerik/hits), canlı fact'ler + süperseed tarihçesi (bi-temporal), 🩺 drift-probe butonu (`brain_health`), 3s poll.
- **Güvenlik:** yalnız local-owner görünümü (tenant'a brain UI YOK — H1/H2 izolasyonuyla tutarlı).
- Referans görsel + JSON şema: bu lane'in scratchpad `brain-live.ts` demosu (Emre'de ekran görüntüsü mevcut).

## Bu lane'in kapattıkları (Tur 9)

H1 tenant-ns zorlaması (cross-tenant memory leak kapandı) · H2 MCP expose gate (`BRAIN_MCP_EXPOSE`, default kapalı) · H3 ReAct auto-recall (`BRAIN_AUTO_RECALL=1`, `server/brain-context.ts`) · H4 openapi `/api/brain/distill/{id}` · H5 PROBLEM_REGISTRY→brain köprüsü (`make brain-sync-registry`, 13 ders canlı).
