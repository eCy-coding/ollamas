# DISCOURSE — persona çapraz-tartışma ledger'ı

> open-code-review (Apache-2.0) "discourse" fazının dosya-konvansiyonu uyarlaması: persona'lar
> birbirinin notunu çürütür (challenge) / destekler (support). Canlı agent YOK — bu ledger +
> her notun `debate` alanı kaynaktır. `rank.ts` sentezde kullanır:
> ≥2 challenge + 0 support → `unresolvedDebates` (rank düşer); ≥2 support → güven artar.

## Format

Her satır: `<challenger-persona> --(challenge|support)--> <noteId> : gerekçe`

## Ledger

<!-- örnek (gerçek run'da doldurulur):
backend --challenge--> project-architect-repo-1 : backend/ orphan değil, daemon runtime'da lazy-load ediliyor
fullstack --support--> backend-backend-2 : aynı seam'i bağımsız gördüm, consensus
-->

## Çözüm (verdict)

Tartışma kapandığında ilgili notun `debate.verdict` alanına yaz: `upheld` | `dropped` | `merged:<noteId>`.
