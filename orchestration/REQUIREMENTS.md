# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)

> READ-ONLY `fuse.ts`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.
> **Proje hazırlık: 49/100** · 15 gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.

## 🎯 EN KRİTİK GEREKSİNİM
**Criticality:** SECURITY · **Kaynak:** conduct

**Gereksinim:** Lisans ihlali: f/prompts.chat — copyleft: 'ADOPT' kod kopyalama ima eder — yalnız ref-only/idea-only/eval-only/future-ref izinli (RISK-ORCH-005)

**Eylem:** ADOPTIONS: f/prompts.chat kararını ref-only'ye çevir (RISK-ORCH-005)

## Tüm gereksinimler (critical-first)
### SECURITY (1)
- **lic:f/prompts.chat** [conduct]: Lisans ihlali: f/prompts.chat — copyleft: 'ADOPT' kod kopyalama ima eder — yalnız ref-only/idea-only/eval-only/future-ref izinli (RISK-ORCH-005)
  → ADOPTIONS: f/prompts.chat kararını ref-only'ye çevir (RISK-ORCH-005)

### COMPLETENESS (11)
- **dod:concurrent-task:adopt-gate** [conduct+dod]: adopt-gate kısmen tamam — eksik eş-zamanlı: test
  → adopt-gate için test aynı anda tamamla
- **dod:concurrent-task:claim** [conduct+dod]: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
  → claim için test + SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:driftguard** [conduct+dod]: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
  → driftguard için SEYIR-entry aynı anda tamamla
- **dod:concurrent-task:scan** [conduct+dod]: scan kısmen tamam — eksik eş-zamanlı: test
  → scan için test aynı anda tamamla
- **dod:concurrent-task:status** [conduct+dod]: status kısmen tamam — eksik eş-zamanlı: test
  → status için test aynı anda tamamla
- **dod:done-without-governance:vO4.1** [conduct+dod]: vO4.1 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.1 için SEYIR girdisi + errors_registry güncelle
- **dod:done-without-governance:vO4.2** [conduct+dod]: vO4.2 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
  → vO4.2 için SEYIR girdisi + errors_registry güncelle
- **dod:uncommitted-green:34 dosya** [conduct+dod]: Commit'siz yeşil iş (built-not-shipped): ADOPTIONS_ORCHESTRATION.md, AUTOPILOT.md, CONDUCTOR.md, CRITIC.json, CRITIC.md, DOCTOR.md…
  → yeşil parçayı commit'le (per-file git add + conventional)
- **red:backend** [conduct+conduct(stale)]: test failed — testTs bayat, güvenilmez (phantom-critical önlendi)
  → backend: testi taze koş; gerçekten kırıksa CRITICAL olur
- **stale-test:backend** [quality(stale)]: backend testLast=failed ama testTs 2220 dk bayat — güvenilmez (phantom-critical önlendi)
  → backend: testi YENİDEN koş (taze sonuç al); gerçekten kırıksa CRITICAL olur
- **crit:coverage-gap:lib/suppress.ts** [conduct+critic]: lib/suppress.ts: test'siz export → loadSuppress
  → lib/suppress.ts için test ekle (loadSuppress)

### ROADMAP (3)
- **next:cli** [conduct]: cli sıradaki: v15 TUI v2 / agent watch top multi pane (request
  → cli: "sıradaki versiyonu planla cli"
- **next:scripts** [conduct]: scripts sıradaki: Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 
  → scripts: "sıradaki versiyonu planla scripts"
- **next:ukp** [conduct]: ukp sıradaki: ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
  → ukp: "sıradaki versiyonu planla ukp"

## Kaynak tazelik (eşik 60dk)
| Kaynak | ts | Durum |
|---|---|---|
| conduct | (canlı exec) | ✓ taze |
| critic | 2026-06-20T12:37:01.132Z | ✓ taze |
| dod | 2026-06-20T12:37:01.237Z | ✓ taze |
| quality | 2026-06-20T11:53:27.489Z | ✓ taze |

## Optimal working-prompt (en-kritik eyleme)
_(bench verisi yok)_

<next-action>
ADOPTIONS: f/prompts.chat kararını ref-only'ye çevir (RISK-ORCH-005)
</next-action>

---
_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._
