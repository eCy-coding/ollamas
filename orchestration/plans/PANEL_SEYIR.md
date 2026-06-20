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

---

## vO4.1 — Panel Coverage Expansion

5 boş personaya (frontend/fullstack/integrations/macos/mcp) gerçek deterministik detector + coverage-critic
+ `panel.ts --refresh` sürdürebilir tek-komut. 10 yeni saf detector (detectors.ts) + `lineCount`/`stripComments`
util + `collectMatchingFiles` (sınırlı read-only enumerator, graph.ts import ETMEDİ → vO5-depgraph coupling yok).
orphan-API detector DROP edildi (vO5-depgraph territory). OSS: Gitleaks(MIT regex)/ShellCheck(GPL ref-only)/
eslint-jsx-a11y(MIT). Canlı: detected 8→29 (frontend 13 choke-point-bypass + 2 oversized, macos 4 shell-strict,
mcp 2 DesktopCommander-direct); integrations/fullstack 0 = **taranıp temiz, FALSE-POSITIVE YOK**.
coverage-critic: yetenek-bazlı (target'sız persona) — vO4.1 sonrası 8'in hepsinde detector → uncovered [].

### ERR-ORCH-007 — choke-point detector kendi choke-point'ini bypass sandı
- **category:** detection (FP) · **severity:** med · **applies_version:** vO4.1 · **recurrence:** 1
- **root cause:** `chokepointBypassExec` generic `.execute(` aradı → kanonik `ToolRegistry.execute(name,args)`
  (choke-point'in DOĞRU kullanımı) bypass olarak işaretlendi (server/mcp/server.ts false-positive).
- **prevention_rule:** Choke-point detector kanonik çağrıyı muaf tutmalı: `.execute(`/`.handler(` ara
  AMA `ToolRegistry.execute` içeren satırı HARİÇ tut. Genelde: bir "X-bypass" detector'ı X'in kendisini flag'lememeli.
- **test:** `detectors2.test.ts` "kanonik ToolRegistry.execute muaf"; canlı kalibrasyonda yakalandı (commit öncesi).
- **GOTCHA (FP #2, ders, ERR değil):** `stripComments` satıriçi `//` silerken `http://`yi bozdu → insecureHttp 0 verdi;
  fix lookbehind `(?<!:)//` (URL'deki `://` korunur). TDD ile yakalandı.

### Kanıt (P6 canlı + P8 gate)
- `panel.ts --refresh`: 29 detected + 9 authored; severity blocker:0/high:1/med:21/low:9; uncovered [].
- Test: detectors2 34 + rank uncovered 1 yeni; **full 163/163**. tsc --strict temiz. Scope: ollamas lane tree 0 yazım (yalnız 1 pre-existing worker değişikliği, benim değil).

---

## vO4.2 — Panel Trend & History (daefe19)

Panel tek-snapshot'tı → append-only `panel-history.jsonl` + run-to-run delta. `trend.ts` (pure):
snapshotOf/diffSnapshots/renderTrend/parseHistory/lastSnapshot. SARIF baselineState (new/unchanged/
updated/absent) deseni → new/resolved/regressed/improved/persistent. **KARARLI eşleştirme noteKey ile**
(id her scan yeniden numaralanır → KARARSIZ; içerik-tabanlı key kullan). panel.ts: history oku→diff→
Trend bölümü→jsonl append. noteKey (note.ts)+severityWeight (rank.ts) reuse, zero-dep.

### Kanıt (idempotency = key-kararlılık ispatı)
- run1 baseline: new=31 resolved=0 (false-resolved YOK); run2: **new=0 resolved=0 persistent=31** →
  id-churn'e rağmen 0 sahte-delta (kritik içgörü doğrulandı). history 2 satır.
- Test: trend 10 yeni; **full 173/173**. tsc --strict temiz. Scope: ollamas lane tree 0 yazım.
- Worker collision yok: trend.ts YENİ + panel.ts MENİM; eşzamanlı vO6-bench worker (`bench.ts` untracked)
  dokunulmadı; explicit-path commit (worker dosyası İÇERMEZ).
- GOTCHA (ders): note.ts `Severity`yi re-export ETMİYOR → trend.ts `Severity`yi detectors.ts'ten import etmeli (rank.ts deseni).
