# CONTRACT LANE — AGENT SÖZLEŞMESİ

## §1 Misyon
Kontrol + Kontrat: makineler kontrat (ToS hash) imzalar → e-posta ile başvurur →
T0 (Emre) LOKAL onaylar (SMTP yok, sovereign) → API key üretilir (server/store,
hash-only) → makine compute pool'a girer → tüm bağlı makineler TEK büyük makine
gibi model çalıştırır (fleet scheduler + llama.cpp rpc-server layer-split).

## §2 Scope
- `contract/**` bu lane'in alanı. server.ts / server/tool-registry.ts diff'leri
  YALNIZ /api/contract/* + /api/pool/* wiring için, minimal.
- Key'ler server/store api_keys'te (issueApiKey/revokeApiKey/resolveKey).
  Ledger yalnız keyId referansı tutar (ERR-CONTRACT-002).
- backend/ stub'ları (go/rs/sol) KULLANILMAZ.

## §3 Değişmez kurallar
1. Zero-dep, Node ≥24 native TS-strip → parameter property YASAK.
2. `npm test` = bare `node --test` (ERR-CONTRACT-001).
3. TDD: test önce. Pure çekirdek (registry/partition) IO'suz.
4. Makine-aksiyonları ToolRegistry.execute üstünden (`contract_admin`, tier host, owner-gated).
5. Canlı kanıt: her vK sonu `contract doctor` / curl zinciri — unit yetmez (ERR-TUNNEL-003 dersi).
6. Raw key tek-seferlik; loglara/state'e ASLA.
7. rpc-server yalnız private/mesh bind (RISK-K1).
8. PUSH YOK; branch oturum-başı doğrula.

## §4 Self-report
"Bu sekmede görevin nedir?" → ezber DEĞİL, `npm run whoami`
(scripts/whoami.sh: canlı branch + git log + ROADMAP ✅/NEXT + test sayısı).

## §5 Sürüm döngüsü
Her vK: plan → TDD → build → canlı-kanıt → ROADMAP işaretle → commit
(conventional, İngilizce). Tetik: "sıradaki versiyonu planla".

## §6 Commit gate (vK16 — sürdürülebilir, kör GATE_SKIP YASAK)
Contract lane İZOLE: root tsc/vitest contract'ı hiç derlemez (`.ts`-uzantı importları),
vitest contract'ı referans etmez → contract kendi kalitesinden sorumlu, root-RED'in
suçlusu/kurbanı değil. Ama root pre-commit gate tüm-repo koşar; başka lane'in WIP'i
(dönüşümlü: embed-catalog, key-doctor…) tüm-repoyu RED bırakınca contract commit'i rehin kalır.
**Kural:** contract/**-only commit → `bash contract/scripts/verify.sh && GATE_SKIP=1 git commit …`.
GATE_SKIP YALNIZ verify.sh geçtikten sonra meşru (kör-skip = ERR-CONTRACT-009).
Root gate/hook (`.git/hooks/pre-commit`, apply-harness.sh) = shared-infra, DOKUNULMAZ.
Contract kendi CI'ına sahip: `.github/workflows/contract-ci.yml` (paths:contract/**).
