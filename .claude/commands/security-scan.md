---
description: $0 güvenlik taraması — Semgrep (SAST) + Trivy (vuln/misconfig) + Gitleaks (secrets) → severity-sıralı bulgu tablosu
---

Repo'yu üç ücretsiz keyless araçla tara. Hepsi permissions.allow'da. Read-only — hiçbir şey değiştirme.

Çalıştır (her biri ayrı, çıktıyı yakala):
1. `semgrep --config auto --severity ERROR --severity WARNING --json --quiet .` — SAST (kod zafiyetleri). Çok yavaşsa `--config auto cli/ server.ts` ile daralt.
2. `trivy fs --severity CRITICAL,HIGH --scanners vuln,misconfig --quiet .` — bağımlılık zafiyeti + yanlış-yapılandırma.
3. `gitleaks detect --no-banner --redact -v` — sızmış secret (VALUE asla yazdırma, --redact zorunlu).

Sonra TEK tablo bas:
| sev | araç | dosya:satır | bulgu | fix |
|---|---|---|---|---|

Kurallar:
- CRITICAL/HIGH önce, asla gizleme.
- Secret bulgusunda VALUE gösterme (yalnız konum + tür).
- Bulgu yoksa "0 bulgu (X dosya tarandı)" de — uydurma yok.
- Evidence-first: gerçek araç çıktısına dayan, tahmin etme. Düzeltme önerisi tek-satır + dosya:satır.
- Kapanış: en kritik 3 bulgu + önerilen sıradaki aksiyon.
