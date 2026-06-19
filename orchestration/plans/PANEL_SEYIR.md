# PANEL_SEYIR — vO4 Expert Diagnostic Panel seyir defteri

> Bu dosya, paylaşılan `errors_registry.json`'u (eşzamanlı vO5-adoption worker'ı değiştirdi)
> CLOBBER ETMEMEK için ayrı tutulur. T0 reconcile sonrası kanonik registry'ye merge edilebilir.

## ⚠️ VERSİYON ÇAKIŞMASI (T0 reconcile gerek)

İki paralel sekme aynı worktree'de aynı anda çalıştı:
- **Bu sekme (ben):** vO4 = **Expert Diagnostic Panel** (8 persona + discourse + OSS-ref notlar).
  Emre'nin yeni açık talebi. Dosyalar: `panel.ts`, `scan.ts`, `lib/{detectors,note,rank,personas}.ts`.
- **Diğer sekme (worker):** vO4 = **OSS Adoption Tracker + license gate** (ROADMAP'in ORİJİNAL vO4'ü).
  Dosyalar: `adopt.ts`, `adopt-gate.ts`, `lib/{licenses,sbom}.ts`, `ADOPT_GATE.md`.

İki iş ÇAKIŞMIYOR (farklı dosyalar) ama AYNI versiyon numarasını + ERR-ORCH-005'i kullandı.
**Çözüm önerisi:** worker'ın adoption-tracker'ı vO4 kalsın; bu panel **vO5 = Expert Diagnostic Panel**
olsun (worker'ın vO5=cross-lane-graph → vO6'ya kaysın). T0 onayıyla ROADMAP reconcile edilecek.
Ben paylaşılan ROADMAP/errors/ADOPTIONS dosyalarını **clobber etmedim** (worker'ın M'leri korundu).

## Hatalar (ERR-ORCH-006+)

### ERR-ORCH-006 — orphan-dir detector false-negative (gevşek import regex)
- **category:** detection · **severity:** med · **applies_version:** vO4-panel
- **root cause:** `importRefs` ilk regex'i `(import|require|from)[^\n]*<token>` → düz prose
  ("...isolated **from** local macOS **daemon**.") import sandı → `backend/daemon` orphan'ı
  yanlışlıkla "referanslı" sayıp gizledi. Ayrıca yalın token "orchestrator" `server/orchestrator.ts`
  ile çakışıp `backend/orchestrator`'ı gizledi.
- **prevention_rule:** Import-ref sayımı token'ı TIRNAK-İÇİ modül-yolunda arasın
  (`(import|from|require)[^\n]*['"][^'"\n]*<token>`); refToken yalın ad DEĞİL distinktif yol olsun
  (`backend/orchestrator`, `orchestrator` değil) → server/ aynı-ad dosyalarıyla çakışmasın.
- **test:** `tests/detectors.test.ts` orphanDir saf-fonksiyon (inboundRefs=0→bulgu); canlı grep
  doğrulaması P8'de 5/5 orphan dizin yakalandı (önce 3, fix sonrası 5).
- **recurrence_count:** 1

## Kanıt (P8 canlı run)
- `scan.ts --all`: 8 detected bulgu (project-architect 7 + backend 1); diğer 6 persona 0 (insan-not bekler).
- `panel.ts`: 10 not (8 detected + 5 authored, dedup -3 id-merge), consensus boost 1
  (`backend-backend-1` med→high, backend+fullstack), refDeficit 5, stale 0.
- Tüm pure-fn suite: detectors 13 + note 11 + rank 8 + panel 6 = 38 yeni; full 108/108.
- Typecheck: tsc --strict temiz (exit 0). Scope: scan/panel ollamas lane tree'ye 0 yazım (yalnız git-grep/read).
