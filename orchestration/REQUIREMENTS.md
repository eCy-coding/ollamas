# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)

> READ-ONLY `fuse.ts`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.
> **Proje hazırlık: 44/100** · 25 gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.

## 🎯 EN KRİTİK GEREKSİNİM
**Criticality:** COMPLETENESS · **Kaynak:** conduct+critic

**Gereksinim:** v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç kapanı) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)

**Eylem:** v1.25 durumunu DONE'a güncelle (roadmap-gerçek reconcile)

## Tüm gereksinimler (critical-first)
### COMPLETENESS (6)
- **crit:roadmap-drift:v1.25** [conduct+critic]: v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç kapanı) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
  → v1.25 durumunu DONE'a güncelle (roadmap-gerçek reconcile)
- **crit:roadmap-drift:v1.28** [conduct+critic]: v1.28 (.1 build/catalog + keys + orchestra araç eşlemesi (roadmap c) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
  → v1.28 durumunu DONE'a güncelle (roadmap-gerçek reconcile)
- **crit:duplication:conduct.ts↔orchestra.ts** [conduct+critic]: conduct.ts ve orchestra.ts ayırt-edici amaç-örtüşmesi (2 distinktif kelime) — olası duplicate
  → conduct.ts/orchestra.ts dedup ya da rol ayrımını netleştir
- **crit:duplication:fleet-conduct.ts↔orchestra.ts** [conduct+critic]: fleet-conduct.ts ve orchestra.ts ayırt-edici amaç-örtüşmesi (3 distinktif kelime) — olası duplicate
  → fleet-conduct.ts/orchestra.ts dedup ya da rol ayrımını netleştir
- **dod:uncommitted-green:2 dosya** [conduct+dod]: Commit'siz yeşil iş (built-not-shipped): TASKS.json, CALIBRATION.md
  → yeşil parçayı commit'le (per-file git add + conventional)
- **crit:coverage-gap:lib/fleet-prompt.ts** [conduct+critic]: lib/fleet-prompt.ts: test'siz export → groundedPrompt
  → lib/fleet-prompt.ts için test ekle (groundedPrompt)

### STALE (19)
- **stale:cockpit** [conduct]: cockpit 81s commitsiz (idle)
  → cockpit: sıradaki versiyonu planla (durağan)
- **stale:colab** [conduct]: colab 191s commitsiz (idle)
  → colab: sıradaki versiyonu planla (durağan)
- **stale:fable** [conduct]: fable 119s commitsiz (idle)
  → fable: sıradaki versiyonu planla (durağan)
- **stale:fix/audit-security** [conduct]: fix/audit-security 399s commitsiz (idle)
  → fix/audit-security: sıradaki versiyonu planla (durağan)
- **stale:fix/binary-architecture-calibration** [conduct]: fix/binary-architecture-calibration 503s commitsiz (idle)
  → fix/binary-architecture-calibration: sıradaki versiyonu planla (durağan)
- **stale:flow** [conduct]: flow 189s commitsiz (idle)
  → flow: sıradaki versiyonu planla (durağan)
- **stale:gwv** [conduct]: gwv 55s commitsiz (idle)
  → gwv: sıradaki versiyonu planla (durağan)
- **stale:revenue** [conduct]: revenue 82s commitsiz (idle)
  → revenue: sıradaki versiyonu planla (durağan)
- **stale:ux** [conduct]: ux 52s commitsiz (idle)
  → ux: sıradaki versiyonu planla (durağan)
- **stale:v** [conduct]: v 56s commitsiz (idle)
  → v: sıradaki versiyonu planla (durağan)
- **stale:verify/gwv2-all-lanes** [conduct]: verify/gwv2-all-lanes 515s commitsiz (idle)
  → verify/gwv2-all-lanes: sıradaki versiyonu planla (durağan)
- **stale:integration/all-lanes** [conduct]: integration/all-lanes 37s commitsiz (idle)
  → integration/all-lanes: sıradaki versiyonu planla (durağan)
- **stale:cookbook** [conduct]: cookbook 34s commitsiz (idle)
  → cookbook: sıradaki versiyonu planla (durağan)
- **stale:documents** [conduct]: documents 34s commitsiz (idle)
  → documents: sıradaki versiyonu planla (durağan)
- **stale:research** [conduct]: research 34s commitsiz (idle)
  → research: sıradaki versiyonu planla (durağan)
- **stale:shell** [conduct]: shell 13s commitsiz (idle)
  → shell: sıradaki versiyonu planla (durağan)
- **stale:agent/odysseus-task-1** [conduct]: agent/odysseus-task-1 12s commitsiz (idle)
  → agent/odysseus-task-1: sıradaki versiyonu planla (durağan)
- **stale:backend** [conduct]: backend 11s commitsiz (idle)
  → backend: sıradaki versiyonu planla (durağan)
- **stale:odysseus** [conduct]: odysseus 10s commitsiz (idle)
  → odysseus: sıradaki versiyonu planla (durağan)

## Kaynak tazelik (eşik 60dk)
| Kaynak | ts | Durum |
|---|---|---|
| conduct | (canlı exec) | ✓ taze |
| critic | 2026-07-12T07:52:30.703Z | ✓ taze |
| dod | 2026-07-12T07:52:31.097Z | ✓ taze |
| quality | 2026-07-12T07:52:30.458Z | ✓ taze |

## Optimal working-prompt (en-kritik eyleme)
_(bench verisi yok)_

<next-action>
v1.25 durumunu DONE'a güncelle (roadmap-gerçek reconcile)
</next-action>

---
_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._
