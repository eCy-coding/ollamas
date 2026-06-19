# ADOPT_GATE.md — vO4 Lisans-Disiplini Gate

> READ-ONLY. `tsx orchestration/bin/adopt-gate.ts [--sbom]`. RISK-ORCH-005 kodlanmış kapı.

## Katman 1 — ADOPTIONS matris (karar↔lisans)
Durum: ✅ temiz

| Repo | Lisans | Karar | Sebep |
|---|---|---|---|
| _(yok)_ | | | matris temiz |

## Katman 2 — gerçek runtime-dep (syft SBOM)
⏭️ atlandı (`--sbom` ile çalıştır).

**Lejant:** Katman1 İHLAL=hard fail (exit 1). Katman2 copyleft runtime dep=uyarı (soft).
