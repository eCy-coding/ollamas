# 18-SUREKLI-YURUTME — otonom yürütme protokolü (V1→V10 kesintisiz)

> "Proje tamamlanana kadar sürdürülebilir mantıkla kesintisiz çalış" (Emre). Bu dosya, fable-5/Sonnet'in
> planlama katmanını (00-17) otonom KOD'a çevirdiği döngüyü tanımlar. Özerklik = **versiyon-checkpoint**
> (Emre kararı). Damga: 2026-07-10.

## §1 Otonom döngü (her versiyon Vn için, sırayla V1→V10)

```
1. YÜKLE    16-VERSIYON Vn kartı + 10-MIKRO M-görevleri + 17-cookbook ref + 11-MIMARI anchor
2. BRANCH   feat/v-final-train (tek dal; V1'de oluştur, tüm release-train burada)
3. KODLA    her M-görev: scope-law dosyaları (16/10 anchor) + 17-cookbook uyarla (verbatim değil)
            → evidence (00-ANAYASA §5): her iddia komut+çıktı
            → ⊘ test-only = regresyon (kod FP), mutasyonla doğrula; UX/kod = gerçek değişiklik
4. GATE     npm run lint (tsc --noEmit) → vitest run (FRESH, ilgili testler) → versiyon kabul-komutu (16)
            kırmızı → systematic-debugging (kök-neden) → yeşil olmadan commit YOK
5. GÜNCELLE 10-MIKRO durum ☐→✅+KANIT · 03-GAP [x] · 14-TAKIP tablo+çubuk · Artifact redeploy ·
            06-KOR-NOKTA etkilenen boyut · 02-DOD ilgili D-eksen
6. COMMIT   yerel conventional (feat|fix|docs(scope): msg, EN) — PUSH YOK
7. CHECKPOINT  Emre'ye versiyon-özeti: ne yapıldı + kanıt-çıktısı + sonraki versiyon → devam
```

Döngü V10 (GA-gate) bitene kadar durmaz — **STOP koşulları hariç**.

## §2 STOP koşulları (YALNIZ bunlar durdurur; gerisi otonom devam)

| Koşul | Örnek | Aksiyon |
|---|---|---|
| **Emre-gate** | M-025 (canonical-PLAN notu, V1) · M-015 (67 audit/* branch-sil, V5) | dur, sor, onay bekle |
| **Outward** | `git tag`, `git push`, npm publish, release-workflow tetik | dur, Emre onayı (00-ANAYASA §3.10) |
| **Çözülemez blocker** | 3-strike: systematic-debugging 3 deneme → hâlâ takılı | dur, kanıtla raporla, sor |
| **Kalite-kapısı kırmızı** | tsc/vitest fail, kök-neden çözülemiyor | dur, çıktı+analiz raporla |
| **Kapsam belirsizliği** | scope-law dışı zorunlu değişiklik gerekiyor | dur, 09-SEYIR'e not, sor |

STOP olmayan durumlar (otonom devam): reversible kod, doküman, test, yerel commit, versiyon-geçişi.

## §3 Blocker kuralı (3-strike)

Bir M-görev takılırsa: (1) systematic-debugging (kök-neden hipotezi + kanıt) — 3 deneme; (2) hâlâ
takılıysa 17-cookbook + WebSearch ile ek araştırma (P-C); (3) yine takılı → **DUR**, blocker'ı kanıtla
(komut+çıktı+denenen) 09-SEYIR'e yaz + Emre'ye sor. Asla "çalışıyor"a zorlama (P-B).

## §4 Sürdürülebilirlik (uzun-koşu)

- **Context yönetimi:** >%80 doluluk → checkpoint + `/compact` öner; resume = 14-TAKIP ilk ☐/◐ satır.
- **Memory-checkpoint:** her versiyon sonu `project_ollamas_planlama_layer.md` güncelle (hangi V bitti).
- **Kaldığın-yer daima 14-TAKIP'te:** M-durum tablosu + faz/versiyon çubuğu = tek-kaynak.
- **Resume komutu:** yeni oturum → `planlama/14-TAKIP.md` oku → ilk açık M-görev → 18 §1 döngü.

## §5 Branch & commit stratejisi

- **Dal:** `feat/v-final-train` (V1'de `git switch -c`). Tüm V1→V10 burada; her versiyon ≥1 commit.
- **Commit:** versiyon-içi mantıksal-birim başına yerel conventional commit (ör. `docs(readme): real product onboarding [M-026]`). **PUSH YOK** — outward.
- **Yabancı-WIP koruması:** yalnız kendi scope-law dosyalarını stage'le (`git add <dosya>`, `git add -A` YASAK — SEYIR Faz 33 dersi: paralel autopilot dosyalarını kapma).
- **Kalite-kapısı geçmeden commit yok.**

## §6 Self-verify (her versiyon)

Versiyon kapanışında 16-VERSIYON'daki "Kabul (Vn shipped)" komutu KOŞULUR + çıktı 09-SEYIR'e yapıştırılır.
İmplementer kendi kanıtını üretir; **V10'da Opus (GA-gate M-044) 02-DOD'un HER satırını bağımsız
yeniden-doğrular** (implementer≠verifier).

## §7 Versiyon sırası + STOP-haritası (hızlı bakış)

| V | M-görevler | STOP var mı? |
|---|---|---|
| V1 Dürüst Kimlik | M-026,027,021,028 + **M-025 (Emre-gate)** | ⛔ M-025 sorulur |
| V2 Kendi Modelin | M-031,037,033 | otonom |
| V3 Kendi Geliştir | M-029,030,034,035,040,032 | otonom |
| V4 Güvenlik | M-001..011 | otonom |
| V5 Test | M-012,013,014,016,**045** + **M-015 (Emre-gate)** | ⛔ M-015 sorulur |
| V6 Ürün | M-017,018,019,**043,044→**047,048 | otonom |
| V7 Model+ | M-038,039 | otonom |
| V8 Dağıtım | M-020,022,023,024,036,**046** | otonom (install test) |
| V9 Cila | M-041,042,043,**049** | otonom |
| V10 GA | M-044 (Opus-gate) + **git tag (outward)** | ⛔ tag Emre onayı |

(047=GDPR, 048=RTL → V6; 045=migration-rollback → V5; 046=Linux-install → V8; 049=error-tracking → V9)

## §9 Subagent-driven mod (bağlam-verimli yürütme)

Uzun oturumlarda bağlam-verimliliği için: **ana-thread = KONDÜKTÖR**, her versiyon **taze-bağlamlı
subagent'a** dağıtılır. Subagent 16-VERSIYON Vn kartı + 10-MIKRO anchor + 17-cookbook'tan üretilmiş
tight prompt ile kodlar + kalite-kapısı koşar + **kanıt + değişen-dosya-listesi + diff-özeti** döner
(commit ETMEZ). Conductor: doğrula → **surgical-stage** (`git add <dosya>`, `-A` yasak) → commit →
14-TAKIP/Artifact → checkpoint → sonraki. Kod-okuma yükü subagent'ta kalır → ana-context yalın.

## §RESUME-KIT — yeni oturum / yeni terminal.app başlatıcı

Taze bir Claude Code oturumu (yeni terminal.app) ollamas'ta bu prompt'la kaldığı yerden devam eder:

```text
ollamas otonom yürütme — kaldığın yerden devam. Branch: feat/v-final-train.
1. OKU: planlama/14-TAKIP.md (tek-kaynak durum) — ilk ☐/◐ satır = sıradaki M-görev.
2. OKU: planlama/18-SUREKLI-YURUTME.md (protokol §1 döngü + §2 STOP) + planlama/00-ANAYASA.md (yasalar+§8 prensipler).
3. Sıradaki versiyonu YÜKLE: planlama/16-VERSIYON-YOLHARITASI.md#<Vn> + 10-MIKRO M-görevleri + 17-KAYNAK-KOD-ORNEKLERI ref.
4. KODLA (scope-law anchor) → GATE (npm run lint → vitest run ilgili → versiyon kabul-komutu) →
   GÜNCELLE (10-MIKRO durum ✅ + 14-TAKIP + 09-SEYIR kanıt) → surgical COMMIT (git add <dosya>, -A YASAK, PUSH YOK).
5. STOP yoksa sonraki versiyon (kesintisiz). DUR yalnız: M-015 (V5 branch-sil) / outward git-tag (V10) / 3-strike blocker.
6. Kanıt zorunlu (00-ANAYASA §5): her iddia komut+çıktı. Yabancı-WIP (autopilot dirty dosyaları) commit'leme.
```

İki yöntem (subagent-driven §9 · yeni-terminal §RESUME-KIT) aynı tek-kaynaktan (14-TAKIP) resume eder → tutarlı.

## §10 Slash-skill orkestrasyon haritası (kondüktör kararı)

Her aşamada uygun `/` skill'i çağrılır. Ağır skill'ler SUBAGENT context'inde (ana-thread yalın); hafif
kapanış-skill'i conductor'da.

| İş | Skill | Kim |
|---|---|---|
| Test yazımı (V4-V5-V6 test) | `superpowers:test-driven-development` | subagent |
| Fail → kök-neden | `superpowers:systematic-debugging` | subagent |
| Branch/lane hijyeni (M-015/016) | `superpowers:finishing-a-development-branch` | conductor (M-015 Emre-gate) |
| Versiyon kapanış doğrulama | `superpowers:verification-before-completion` | conductor |
| Commit | `caveman:caveman-commit` (`/commit`) | conductor |
| Yerel lint/test/git | `ecydev` (eCyMCP) | ikisi |
| Domain (V6 billing/perf, V7 model) | ilgili `jeff-*`/`analytics-*` gerekirse | subagent |

## §8 Kesintisiz çalışma sözü

Her tur: net durum + kaldığın-yer + sıradaki-adım (P-E). STOP koşulu yoksa bir sonraki versiyona geç —
"bitirdim, ne yapayım?" diye sorma; protokol devam et. Yalnız §2 STOP'ta veya proje-tamamlandığında dur.
