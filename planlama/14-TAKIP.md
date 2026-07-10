# 14-TAKIP — canlı interaktif ilerleme panosu

> **Emre'nin takip yüzeyi.** Bu dosya CANLI tutulur: her faz/mikro-görev oturumu kapanışında
> 08-PROTOKOL §1 ritüeliyle güncellenir. Görsel ayna: Artifact web panosu (bu md'den türetilir).
> Durum kaynağı = 10-MIKRO (M-durum) + 04-FAZLAR (faz) + 09-SEYIR (kayıt). El-ile güncellenir
> (kodlama fazında `bin/takip.ts` canlı-türetme scripti eklenecek — CLAUDE.md role.ts benzeri).
>
> **Son güncelleme:** 2026-07-10 · branch `feat/v-final-train` · faz: **V1 YÜRÜTMEDE (4/5 ✅, M-025 Emre-gate)**
>
> 📚 Kodlama referansı: `17-KAYNAK-KOD-ORNEKLERI.md`. Otonom protokol: `18-SUREKLI-YURUTME.md`.

---

## ⏱ Özet (bir bakışta)

| Alan | Değer |
|---|---|
| Aktif aşama | **V1 Dürüst Kimlik YÜRÜTMEDE** (branch feat/v-final-train) |
| Kodlama durumu | ◐ V1 4/5 ✅ (M-026,027,021,028) · M-025 Emre-gate bekliyor |
| Genel ilerleme (kod) | **4 / 49 mikro-görev** · **0.8 / 10 versiyon** (planlama %100) |
| Başlangıç sürümü | v1.23.0 → **package.json artık ollamas@1.24.0 ✅** (M-021) |
| Sıradaki adım | M-025 (canonical PLAN notu) = Emre-gate → onay sonrası V1 kapat → **V2** |
| Bloke / Emre-gate | **M-025 (canonical, ŞİMDİ)**, M-015 (branch, V5) |
| Kullanıcı ne zaman kullanır | **V2** (v1.25.0) — kendi modelini bağlayıp çalıştırır |

## 🚂 Versiyon ilerleme (release-train — yürütme sırası)

```
V1  Dürüst Kimlik        ████████░░ ◐  v1.24.0  4/5 ✅ (M-026,027,021,028) · M-025 Emre-gate
V2  Kendi Modelini Getir ░░░░░░░░░░ ☐  v1.25.0  ✅İLK-KULLANILABİLİR (M-031 bug,037 wizard,033 guide)
V3  Kendi Geliştirmeni.. ░░░░░░░░░░ ☐  v1.26.0  ✅dev-extensible (M-029,030,034,035,040,032)
V4  Güvenlik Kanıtı      ░░░░░░░░░░ ☐  v1.27.0  (M-001..011)
V5  Test Bütünlüğü       ░░░░░░░░░░ ☐  v1.28.0  (M-012..016 · FRESH-suite barrier)
V6  Ürün & Gelir         ░░░░░░░░░░ ☐  v1.29.0  (M-017,018,019)
V7  Gelişmiş Model Kont. ░░░░░░░░░░ ☐  v1.30.0  (M-038,039)
V8  Dağıtım Sağlamlığı   ░░░░░░░░░░ ☐  v1.31.0  (M-020,022,023,024,036)
V9  Gözlemlenebilir+Cila ░░░░░░░░░░ ☐  v1.32.0  (M-041,042,043)
V10 v-FINAL / GA         ░░░░░░░░░░ ☐  v1.33.0  ✅GA-ÜRETİME-HAZIR (M-044 Opus-gate)
```

Detay: `16-VERSIYON-YOLHARITASI.md` (her versiyon phase/todo/alt-todo/DoD/precompute).

## 📊 Faz ilerleme çubuğu (bağımlılık-referansı — 04-FAZLAR)

```
P0 Envanter      ██████████ ✅ 100%   (01-ENVANTER damgalı)
P1 DoD+Gap       ██████████ ✅ 100%   (02-DOD, 03-GAP, 05-TEHDIT, 06-KOR-NOKTA)
── planlama katmanı tamam (00-14) ──
P2 Güvenlik      ░░░░░░░░░░ ☐  0%     (M-001..011 · çoğu ⊘ regresyon, reconcile sonrası küçük)
P3 Test/Lane     ░░░░░░░░░░ ☐  0%     (M-012..016)
P4 Ürün/UX       ░░░░░░░░░░ ☐  0%     (M-017..019)
P5 Release       ░░░░░░░░░░ ☐  0%     (M-020..025)
P6 Benimseme/DX  ░░░░░░░░░░ ☐  0%     (M-026..040 · dogfooding · README-fix + custom-openai-bug + docs)
P-FINAL Gate     ░░░░░░░░░░ ☐  0%     (Opus kapanış denetimi)
```

## ✅ Mikro-görev durum tablosu (25) — durum: ☐ açık · ◐ devam · ✅ kanıtlı · ⊘ FP-testonly · ⛔ bloke

| M | Faz | Görev (kısa) | Durum | Kanıt | Blocker |
|---|---|---|---|---|---|
| M-001 | P2 | localOwnerGuard SAAS testi | ☐ | — | — |
| M-002 | P2 | allowlist tamlık invariant | ☐ | — | M-001 |
| M-003 | P2 | commander execFile regresyon | ☐⊘ | — | — |
| M-004 | P2 | pipeline validate-order testi | ☐⊘ | — | — |
| M-005 | P2 | record swallow testi | ☐⊘ | — | — |
| M-006 | P2 | adminGuard brute-force testi | ☐⊘ | — | — |
| M-007 | P2 | providers safeParse testi | ☐⊘ | — | — |
| M-008 | P2 | workflow lint (ref_name) | ☐ | — | — |
| M-009 | P2 | ReDoS audit (threatfeed) | ☐ | — | — |
| M-010 | P2 | colab urllib scheme guard | ☐ | — | — |
| M-011 | P2 | docker-compose read-only | ☐ | — | — |
| M-012 | P3 | migration uniqueness testi | ☐⊘ | — | — |
| M-013 | P3 | FRESH suite + e2e (BARRIER) | ☐ | — | M-001..012 |
| M-014 | P3 | skipped test gerekçe-belge | ☐ | — | — |
| M-015 | P3 | audit/* + divergent konsolidasyon | ⛔ | — | **Emre** |
| M-016 | P3 | iç worktree prune | ☐ | — | — |
| M-017 | P4 | billing e2e zincir testi | ☐ | — | — |
| M-018 | P4 | Lighthouse RUN + doğrula | ☐ | — | M-013 |
| M-019 | P4 | i18n key-count parite assert | ☐ | — | — |
| M-020 | P5 | cloud master-key fail-closed | ☐ | — | — |
| M-021 | V1 | VERSION + package semver | ✅ | ollamas@1.24.0 · vitest 2/2 · 4a9cc28 | — |
| M-022 | P5 | README/QUICKSTART spot-check | ☐ | — | M-021 |
| M-023 | P5 | install.sh temiz-dizin | ☐ | — | M-021 |
| M-024 | P5 | RELEASE_ROLLBACK tatbikat | ☐ | — | — |
| M-025 | V1 | canonical plan notu | ⛔ | — | **Emre — ŞİMDİ** |
| M-026 | V1 | README gerçek-ürün | ✅ | kurgu-grep=0 · gerçek başlık · QUICKSTART link · 4a9cc28 | — |
| M-027 | V1 | setup.sh düzelt/yönlendir | ✅ | go-build=0 · ready-wrapper · bash-n OK · 4a9cc28 | — |
| M-028 | V1 | CONTRIBUTING + CoC | ✅ | iki dosya + CoC-2.1 · 4a9cc28 | — |
| M-029 | P6b | docs/adding-a-tool.md | ☐ | — | — |
| M-030 | P6b | Extension Guide (indeks) | ☐ | — | M-029/034/035 |
| M-031 | P6b | custom-openai dropdown (BUG) | ☐ | — | — |
| M-032 | P6b | docs/troubleshooting.md | ☐ | — | — |
| M-033 | P6b | docs/model-guide.md | ☐ | — | — |
| M-034 | P6b | HOWTO-ADD-SKILL.md | ☐ | — | — |
| M-035 | P6b | CLI alt-komut rehberi | ☐ | — | — |
| M-036 | P6b | deploy-guide + stack-update | ☐ | — | — |
| M-037 | P6b | first-run model wizard | ☐ | — | — |
| M-038 | P6b | per-model ayar UI | ☐ | — | — |
| M-039 | P6b | GGUF/Modelfile import | ☐ | — | M-033 |
| M-040 | P6b | API quickstart | ☐ | — | — |
| M-041 | V9 | CHANGELOG.md | ☐ | — | — |
| M-042 | V9 | full-E2E acceptance | ☐ | — | M-013/023 |
| M-043 | V9 | docs cross-link sweep | ☐ | — | M-026/030 |
| M-044 | V10 | GA-gate (Opus) | ☐ | — | tüm önceki |

**Sayaç:** kapandı 0/44 · ⊘ test-only 6 · ⛔ Emre-gate 2 · doküman 15 + UX/kod 21 · aktif-yol 36.

## ▶ Aktif versiyon + sonraki adım (16-VERSIYON)

- **Şu an:** planlama v5 tamam; kodlama başlamadı.
- **Sonraki versiyon: V1 Dürüst Kimlik (v1.24.0)** — ilk todo **M-026** (README gerçek-ürün, `README.md:1`).
  Phase V1-a (kimlik docs) → V1-b (sürüm hijyeni). Sekme prompt'u: 07-PROMPTLAR §MIKRO M-026.
- **Neden V1 önce:** kimlik-borcu (README kurgusal + package react-example) adoption-blocker; hızlı kapanır.
- **Kullanıcı V2'de (v1.25.0) kendi modelini kullanmaya başlar.**
- **Barrier hatırlatma:** M-013 (V5 FRESH suite) tüm V4/V5 test-yazımı sonrası; M-044 (V10 GA) tüm önceki sonrası.

## ⛔ Bloke / Emre-gate bekleyenler

| M | Ne için karar | Neden Emre |
|---|---|---|
| M-015 | 67 `audit/*` branch (entegre/arşiv/sil) + divergent-lane OAuth seçimi | geri-alınamaz git; mimari karar (08 §5) |
| M-025 | kök PLAN.md + ROADMAP-vNext başına "canonical" notu | mevcut doküman değişikliği onayı |

## 🕘 Son seyir (09-SEYIR özeti)

- **S-005** (2026-07-10) · araştırma + implementation cookbook (17): 15 doğrulanmış dış-kaynak pattern+kod örneği (Ollama/Stripe/Lighthouse/MCP-SDK/semgrep…). İyileştirme: RE2, git-cliff, CLI-GGUF.
- **S-004** (2026-07-10) · 10-versiyon release-train: V1→V10 (v1.24→v1.33 GA), 44 mikro-görev, usability-first.
- **S-003** (2026-07-10) · dogfooding kullanıcı-ihtiyaç: P6 Benimseme/DX + GAP-024..038 (15) + M-026..040.
- **S-002** (2026-07-10) · çalışma prensipleri §8 + canlı takip 14-TAKIP + Artifact ayna kuruldu.

## 👁 Emre nasıl canlı takip eder

1. **Bu panoyu aç:** `~/Desktop/ollamas/planlama/14-TAKIP.md` (her oturum kapanışı güncel).
2. **Artifact web panosu:** https://claude.ai/code/artifact/b62c4c6a-2ad4-4fec-bfe9-ea042ccc5e74
   — görsel çubuklar + renk-kodlu M-görev tablosu (default-private; her oturum redeploy, aynı URL).
3. **Kod-dokunulmadı kanıtı:** `cd ~/Desktop/ollamas && git status --porcelain planlama/` → yalnız planlama/.
4. **Gerçek ilerleme (kodlama başlayınca):**
   ```bash
   grep -c '✅' planlama/14-TAKIP.md          # kapanan mikro-görev sayısı
   git log --oneline -10                       # son kod commit'leri
   vitest run 2>&1 | tail -3                    # canlı test durumu
   ```
5. **Kaldığım yeri gör:** §Aktif dalga + durum tablosundaki ilk ☐/◐ satır = sıradaki iş.

## 🔄 Güncelleme kuralı (08-PROTOKOL §1 ile)

Her faz/mikro oturumu kapanışında bu dosya güncellenir: (1) M-durum tablosu satırı, (2) faz çubuğu %,
(3) özet "son güncelleme" damgası, (4) son seyir özeti, (5) Artifact redeploy. Boş bırakma = P-E ihlali.
