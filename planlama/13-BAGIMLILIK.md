# 13-BAGIMLILIK — mikro-görev bağımlılık DAG'ı + kritik yol

> 10-MIKRO düğümleri arası bağımlılık, topolojik sıra, paralelleştirilebilir kümeler, kritik yol,
> faz-geçiş barrier'ları, fable-5→Opus→Sonnet dispatch sırası. Damga: 2026-07-10.

## §1 Bağımlılık grafiği (M-xxx → gerektirdiği)

```
P2 (çoğu bağımsız — paralel):
  M-001 ──▶ M-002            (guard testi → allowlist invariant)
  M-003  M-004  M-005  M-006  M-007  M-008  M-009  M-010  M-011   (hepsi bağımsız)

P3:
  M-012  (bağımsız)
  M-012 ──▶ M-015           (migration netliği → divergent-lane reconcile)
  M-014  M-016  (bağımsız)
  [M-001..M-012 hepsi] ──▶ M-013   (yeni testler yazılınca FRESH suite)

P4:
  M-013 ──▶ M-018           (suite yeşil → Lighthouse RUN)
  M-017  M-019  (bağımsız)

P5:
  M-020  M-024  M-025  (bağımsız)
  M-021 ──▶ M-022           (VERSION → README komut spot-check)
  M-021 ──▶ M-023           (VERSION → install.sh temiz-dizin)
```

## §2 Topolojik sıra (geçerli bir yürütme)

```
Dalga-A (P2 paralel, 10 görev):  M-001 M-003 M-004 M-005 M-006 M-007 M-008 M-009 M-010 M-011
Dalga-B (P2):                    M-002                    (M-001 sonrası)
Dalga-C (P3 paralel):            M-012 M-014 M-016
Dalga-D (P3):                    M-015                    (M-012 sonrası)
── BARRIER: tüm yeni P2/P3 testleri yazıldı ──
Dalga-E (P3):                    M-013  (FRESH suite — barrier)
Dalga-F (P4 paralel):            M-017 M-019
Dalga-G (P4):                    M-018                    (M-013 sonrası)
Dalga-H (P5 paralel):            M-020 M-021 M-024 M-025
Dalga-I (P5):                    M-022 M-023              (M-021 sonrası)
Dalga-J (P6a kimlik, paralel):   M-026 M-028             (M-027 M-026 sonrası)
Dalga-K (P6b DX+UX, paralel):    M-029 M-031 M-032 M-033 M-034 M-035 M-036 M-037 M-038 M-040
Dalga-L (P6b):                   M-030 M-039             (M-030←M-029/034/035 · M-039←M-033)
── BARRIER: P-FINAL Opus gate ──
```

P6 bağımlılıkları: M-027←M-026 (setup README ile senkron) · M-030←M-029/034/035 (extension-guide
linklediği docs) · M-039←M-033 (GGUF import model-guide sonrası). Gerisi bağımsız → yüksek paralellik.
P6 çoğu doküman = hızlı; P6a (kimlik) adoption-blocker → önce.

## §3 Kritik yol (en uzun zincir)

```
M-001 → M-002 → [test-barrier] → M-013 → M-018 → [gate]
                                    ▲
                    (M-013 tüm P2/P3 testlerini bekler = gerçek barrier)
```

- **Kritik yol uzunluğu:** M-013 (FRESH suite) darboğaz — tüm test yazımı (M-001..012,014,016) bitmeden
  koşulamaz. M-013 sonrası M-018 (Lighthouse) tek zincir.
- **En pahalı düğümler:** M-013 (M · suite), M-015 (M · konsolidasyon+Emre), M-017 (M · billing e2e),
  M-020 (M · cloud-key), M-023 (M · install), M-024 (M · rollback).

## §4 Paralelleştirilebilir kümeler (fleet dispatch)

| Küme | Görevler | Lane/sekme | Not |
|---|---|---|---|
| K1 (P2 regresyon) | M-002..M-008, M-012 | gateway-v2 tek sekme (test-only, ⊘) | kod FP — hızlı |
| K2 (P2 gerçek) | M-009, M-010, M-011 | colab, scripts | ayrı python/compose |
| K3 (P3 lane) | M-014, M-015, M-016 | converge | git+belge; M-015 Emre-gate |
| K4 (P4) | M-017, M-019 | revenue, frontend | bağımsız |
| K5 (P5) | M-020, M-021, M-024, M-025 | shipgate | M-021 K5-içi öncelik |
| K6 (P6a kimlik) | M-026, M-027, M-028 | shipgate/scripts | adoption-blocker; M-027←M-026 |
| K7 (P6b DX+UX) | M-029..040 (M-030/039 hariç sona) | frontend/cli/shipgate | çoğu bağımsız doküman + UX |

BARRIER kuralı: K1..K7 içi paralel; M-013 (BARRIER-E) tüm test-yazımı sonrası TEK; M-018 M-013 sonrası;
K6 (P6a) adoption-blocker → K7'den önce başlar; P-FINAL tüm fazlar sonrası.

## §5 Dispatch sırası (hiyerarşi — 00-ANAYASA §2)

```
fable-5 (bu plan) → faz prompt'u (07-PROMPTLAR) → Sonnet sekmesi (K1..K5 paralel)
  → her küme bitince Opus gate (kabul komutu bağımsız koşar, implementer≠verifier)
  → gate ✅ → 08-PROTOKOL §1 ritüel → sonraki dalga
M-015 & M-025: Emre (T0) eskalasyon — karar-gerektiren (branch sil, canonical not).
⊘ test-only görevler (M-002..008,012): local-worker ($0) yazabilir, Sonnet review — verimlilik kuralı.
P6 docs (M-028..036,040): çoğu $0 local-worker + Sonnet review; M-031/037/038 UX = Sonnet kod.
```

## §6 Faz-geçiş barrier'ları (04-FAZLAR ile senkron)

| Barrier | Şart | Kanıt |
|---|---|---|
| P2→P3 | M-001..011 kapalı; semgrep ERROR=0 | `semgrep scan --severity ERROR` = 0 |
| P3→P4 | M-013 yeşil (FRESH suite + e2e 0 fail) | `vitest run` + `npm run test:e2e` |
| P4→P5 | M-017,018,019 kapalı | billing/lighthouse/i18n kabul |
| P5→P-FINAL | M-020..025 kapalı | install exit0 + version + rollback |
| P-FINAL | 02-DOD %100 + 06-KOR-NOKTA 13-boyut taze + Opus onay | 09-SEYIR onay kaydı |

## §7 Döngü denetimi (DAG doğrulama)

Grafik asiklik: her kenar düşük-faz → yüksek-faz veya aynı-faz-içi tek-yön (M-001→M-002, M-012→M-015,
M-021→M-022/023). Geri-kenar YOK. `M-013` yalnız gelen-kenar (barrier), giden yok (M-018 hariç). ✓
