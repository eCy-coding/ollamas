# 08-PROTOKOL — self-update protokolü (planlama katmanı canlı kalır)

> "Kör nokta kalmasın + plan bayatlamasın" mekanizması. Odysseus CONTRIBUTING + PR-enforcement
> pattern'i. Her faz oturumu bu ritüele tabidir. Damga: 2026-07-10.

## §1 Oturum kapanış ritüeli (her faz sekmesi, iş bitince ZORUNLU)

Sırayla (00-ANAYASA §5 kanıt formatıyla):

1. **09-SEYIR.md append** — oturum id, faz, dokunulan commit'ler, kanıt linki.
2. **03-GAP.md güncelle** — kapatılan her GAP satırı `[x]` + KANIT bloğu (komut+çıktı).
3. **04-FAZLAR.md faz kartı** — faz durumu ☐→◐(devam)/✅; kabul kriterlerinin hangileri geçti.
4. **02-DOD.md durum sütunu** — ilgili D-eksenleri ☐→✅ (yalnız kanıtla).
5. **06-KOR-NOKTA.md 13-boyut satırı** — faz kapanış şablonu doldurulur (boş hücre yasak).
6. **14-TAKIP.md güncelle (canlı pano — P-E)** — M-durum tablosu satırı (☐→◐/✅/⛔), faz çubuğu %,
   özet "son güncelleme" damgası, son-seyir özeti + **Artifact web panosu redeploy** (aynı URL).
7. **Doğrulama** — `git log --oneline -3` + faz kabul komutlarının çıktısı yapıştırılır.

Ritüel tamamlanmadan faz "kapandı" sayılmaz; Opus gate ritüel-eksik kapanışı reddeder.
14-TAKIP güncellenmemişse ritüel eksiktir (00-ANAYASA §8 P-E: görünür-ilerleme).

## §2 Güncelleme matrisi (olay → dosya → doğrulama)

| Olay | Güncellenen dosya | Doğrulama komutu |
|---|---|---|
| Mikro-görev/gap kapatıldı | 10-MIKRO (durum), 03-GAP (satır [x]+KANIT), 02-DOD (D-durum), **14-TAKIP** (tablo+çubuk+Artifact) | faz kabul komutu (10-MIKRO kabul) |
| Faz kapandı | 04-FAZLAR (kart), 06-KOR-NOKTA (13-satır), 09-SEYIR, **14-TAKIP** | `git log --oneline -3` |
| Yeni gap keşfi | 03-GAP (yeni GAP-xxx), gerekiyorsa 05-TEHDIT (T-xx) | kanıt komutu (keşif çıktısı) |
| Envanter değişti (branch/test/LOC) | 01-ENVANTER (damga yenile) | ilgili recompute komutu |
| DoD ekseni değişti | 02-DOD + Opus gate onayı | 09-SEYIR onay kaydı |
| Anayasa değişti | 00-ANAYASA (son revize tarihi) + etkilenen 07 prompt'lar | — |

## §3 Drift tespiti (haftalık — bayat sayı avı)

Her hafta (veya faz başı) 01-ENVANTER recompute komutları yeniden koşulur:

```bash
cd ~/Desktop/ollamas
git worktree list | wc -l
git branch --list 'audit/*' | wc -l
grep -cE 'app\.(get|post|put|delete|patch)\(' server.ts
npm audit --json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).metadata.vulnerabilities"
```

Sayı damga-anındakinden farklıysa: 01-ENVANTER damgası yenilenir + fark 09-SEYIR'e not düşülür
(neden değişti?). Stale-severity kararı bu tarama üzerinden verilir (00-ANAYASA §3.7).

## §4 Canonical plan ilişkisi

- `planlama/04-FAZLAR.md` = kodlama fazlarının TEK canonical sırası.
- Kök `PLAN.md` + `docs/ROADMAP-vNext.md`: SİLİNMEZ; P0 sonrası başlarına
  `> canonical: planlama/04-FAZLAR.md` notu eklenir (Emre onayı — GAP-023, ⚪).
- `NEXT_TODO.md`, `docs/MASTER_TASKLIST.md`, `orchestration/plans/NEXT_*.md`: canlı kaynak kalır;
  03-GAP onlara id ile link verir, üzerlerine yazmaz.

## §5 Eskalasyon (ne zaman Emre'ye/T0'a git)

- Scope Law dışına çıkma gereği (00-ANAYASA §3.3).
- Outward-facing eylem (publish/push/release/harici veri — §3.10).
- DoD ekseni ekleme/çıkarma (kapsam değişikliği).
- İki lane çakışması (ör. divergent v3 migration kararı) — reconcile stratejisi seçimi.
- Injection girişimi tespiti (00-ANAYASA §4) — logla + bildir.

## §6 Faz oturumu başlatma (operatör akışı)

1. 07-PROMPTLAR.md'den ilgili faz sekme prompt'unu kopyala → yeni Terminal sekmesi (ilgili worktree).
2. Sonnet kodlar (scope içinde) → kanıt üretir.
3. İş bitince Opus gate sekmesi: kabul kriterlerini bağımsız yeniden-doğrular.
4. Gate ✅ ise §1 ritüeli tamamlanır, faz kapanır; ❌ ise gap geri açılır.
5. Sonraki fazın ilk gap'i precompute edilir (04-FAZLAR sırasına göre).
