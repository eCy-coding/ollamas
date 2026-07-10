# 14-TAKIP — canlı interaktif ilerleme panosu

> **Emre'nin takip yüzeyi.** Bu dosya CANLI tutulur: her faz/mikro-görev oturumu kapanışında
> 08-PROTOKOL §1 ritüeliyle güncellenir. Görsel ayna: Artifact web panosu (bu md'den türetilir).
> Durum kaynağı = 10-MIKRO (M-durum) + 04-FAZLAR (faz) + 09-SEYIR (kayıt). El-ile güncellenir
> (kodlama fazında `bin/takip.ts` canlı-türetme scripti eklenecek — CLAUDE.md role.ts benzeri).
>
> **Son güncelleme:** 2026-07-10 · branch `feat/v-final-train` · faz: **V1·V2·V3·V4·V5 ✅ TAMAM → V6 sırada** · yöntem: subagent-driven + slash (§9/§10)
>
> 📚 Kodlama referansı: `17-KAYNAK-KOD-ORNEKLERI.md`. Otonom protokol: `18-SUREKLI-YURUTME.md`.

---

## ⏱ Özet (bir bakışta)

| Alan | Değer |
|---|---|
| Aktif aşama | **V1–V5 ✅ TAMAM** (branch feat/v-final-train, 14 commit) |
| Kodlama durumu | ✅ V1–V5 (M-015 audit/* 67→arşiv-tag+sil, branch 137→73) → **V6 sırada** |
| Genel ilerleme (kod) | **32 / 50 mikro-görev** · **5 / 10 versiyon (YARI)** |
| Sürüm | ollamas@**1.24.0** · **KULLANICI ARTIK KENDİ MODELİNİ KULLANABİLİR** (V2) |
| Sıradaki adım | **V3 Kendi Geliştirmeni Yap** → M-029 (docs/adding-a-tool.md) |
| Bloke / Emre-gate | M-015 (branch-sil, V5), V10 git-tag (outward) — ikisi de ileride |
| Kullanıcı kullanabilir mi | ✅ **EVET** (V2: custom-openai+catalog dropdown, first-run onboarding, model-guide) |

## 🚂 Versiyon ilerleme (release-train — yürütme sırası)

```
V1  Dürüst Kimlik        ██████████ ✅ v1.24.0  5/5 (M-026,027,021,028,025)
V2  Kendi Modelini Getir ██████████ ✅ v1.25.0  3/3 KULLANILABİLİR (M-031,037,033)
V3  Kendi Geliştirmeni.. ██████████ ✅ v1.26.0  6/6 (adding-a-tool/extension-guide/HOWTO/CLI/api/troubleshoot)
V4  Güvenlik Kanıtı      ██████████ ✅ v1.27.0  11/11 (M-004/006 V5'te açıldı)
V5  Test Bütünlüğü       ██████████ ✅ v1.28.0  9/9 (M-015 audit/* arşivlendi · FRESH 1518)
V6  Ürün & Gelir         ░░░░░░░░░░ ☐  v1.29.0  ◀ SIRADA (M-017 billing,018 Lighthouse,019 i18n + M-047/048)
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
| M-001 | V4 | localOwnerGuard SAAS testi | ✅ | 5da6452 | — |
| M-002 | V4 | allowlist tamlık invariant | ✅ | 5da6452 | — |
| M-003 | V4 | commander execFile regresyon | ✅⊘ | 5da6452 | — |
| M-004 | V5 | pipeline validate-order testi | ✅ | boot-harness · 06e27f4 | — |
| M-005 | V4 | record swallow testi | ✅⊘ | 5da6452 | — |
| M-006 | V5 | adminGuard brute-force testi | ✅ | boot-harness · 06e27f4 | — |
| M-007 | V4 | providers safeParse testi | ✅⊘ | 5da6452 | — |
| M-008 | V4 | workflow lint (ref_name) | ✅ | env-only grep · 5da6452 | — |
| M-009 | V4 | ReDoS audit (threatfeed) | ✅ | name-literal→nosemgrep · 5da6452 | — |
| M-010 | V4 | colab urllib scheme guard | ✅ | python 8/8 · 5da6452 | — |
| M-011 | V4 | docker-compose read-only | ✅ | read_only+tmpfs · 5da6452 | — |
| M-012 | V5 | migration uniqueness testi | ✅ | 06e27f4 | — |
| M-013 | V5 | FRESH suite (BARRIER) | ✅ | 1518 pass · M-037 regr-fix · 06e27f4 | — |
| M-014 | V5 | skipped test gerekçe-belge | ✅ | 21 gated + TESTING.md · 06e27f4 | — |
| M-015 | V5 | audit/* konsolidasyon | ✅ | 67→archive-tag+sil · branch 137→73 | — |
| M-016 | V5 | iç worktree prune | ✅ | 6→5 audit-cont · 06e27f4 | — |
| M-017 | P4 | billing e2e zincir testi | ☐ | — | — |
| M-018 | P4 | Lighthouse RUN + doğrula | ☐ | — | M-013 |
| M-019 | P4 | i18n key-count parite assert | ☐ | — | — |
| M-020 | P5 | cloud master-key fail-closed | ☐ | — | — |
| M-021 | V1 | VERSION + package semver | ✅ | ollamas@1.24.0 · vitest 2/2 · 4a9cc28 | — |
| M-022 | P5 | README/QUICKSTART spot-check | ☐ | — | M-021 |
| M-023 | P5 | install.sh temiz-dizin | ☐ | — | M-021 |
| M-024 | P5 | RELEASE_ROLLBACK tatbikat | ☐ | — | — |
| M-025 | V1 | canonical plan notu | ✅ | PLAN.md+ROADMAP canonical-not · 1ccdbed | — |
| M-026 | V1 | README gerçek-ürün | ✅ | kurgu-grep=0 · gerçek başlık · QUICKSTART link · 4a9cc28 | — |
| M-027 | V1 | setup.sh düzelt/yönlendir | ✅ | go-build=0 · ready-wrapper · bash-n OK · 4a9cc28 | — |
| M-028 | V1 | CONTRIBUTING + CoC | ✅ | iki dosya + CoC-2.1 · 4a9cc28 | — |
| M-029 | V3 | docs/adding-a-tool.md | ✅ | be79cb9 | — |
| M-030 | V3 | Extension Guide (indeks) | ✅ | be79cb9 | — |
| M-031 | V2 | custom-openai+catalog dropdown+server | ✅ | server-branch + 11 dropdown + 21/21 test · e0edba4 | — |
| M-032 | V3 | docs/troubleshooting.md | ✅ | be79cb9 | — |
| M-033 | V2 | docs/model-guide.md | ✅ | VRAM tablosu+BYO+GGUF · e0edba4 | — |
| M-034 | V3 | HOWTO-ADD-SKILL.md | ✅ | be79cb9 | — |
| M-035 | V3 | CLI alt-komut rehberi | ✅ | be79cb9 | — |
| M-036 | P6b | deploy-guide + stack-update | ☐ | — | — |
| M-037 | V2 | first-run model onboarding | ✅ | ai.ts aksiyon-mesajı + 2/2 test · e0edba4 | — |
| M-038 | P6b | per-model ayar UI | ☐ | — | — |
| M-039 | P6b | GGUF/Modelfile import | ☐ | — | M-033 |
| M-040 | V3 | API quickstart | ✅ | be79cb9 | — |
| M-041 | V9 | CHANGELOG.md | ☐ | — | — |
| M-042 | V9 | full-E2E acceptance | ☐ | — | M-013/023 |
| M-043 | V9 | docs cross-link sweep | ☐ | — | M-026/030 |
| M-044 | V10 | GA-gate (Opus) | ☐ | — | tüm önceki |

**Sayaç:** kapandı **32/50** (V1–V5) · ⊘ test-only 4 · ⛔ Emre-gate 0 (M-015 çözüldü) · outward tag V10 · aktif-yol 18.

## ▶ Aktif versiyon + sonraki adım (16-VERSIYON)

- **Şu an:** V1–V5 kapandı (32/50, YARI YOL). Yöntem: subagent-driven (§9) + slash (§10, TDD-skill).
- **Sonraki versiyon: V6 Ürün & Gelir (v1.29.0)** — M-017 (billing e2e, stripe.ts), M-018 (Lighthouse RUN), M-019 (i18n key-parite) + M-047 (GDPR erasure), M-048 (i18n RTL).
- **Barrier:** M-018←M-013(✅). Kalan Emre-gate: yalnız V10 git-tag (outward).

## ⛔ Bloke / Emre-gate bekleyenler

| M | Ne için karar | Neden Emre |
|---|---|---|
| ~~M-015~~ ✅ | çözüldü: 67 audit/* arşiv-tag+sil (Emre onayı) | — |
| divergent-lane | V10-sonrası ertelendi (Emre) | GA bloklamaz |
| V10 git-tag | GA `git tag v1.33.0` (outward) | ileride |

## 🕘 Son seyir (09-SEYIR özeti)

- **S-009** (2026-07-10) · V3 subagent-driven: 6 dev-doküman (adding-a-tool/extension-guide/HOWTO-ADD-SKILL/CLI-guide/api-quickstart/troubleshooting), tsc-0, commit be79cb9. Yöntem 18-§9.
- **S-008** (2026-07-10) · V1 kapandı + V2 TAMAM (kullanılabilir): custom-openai+catalog dropdown+server, first-run onboarding, model-guide. 23/23 test.
- **S-007** (2026-07-10) · V1 4/5 (README/setup/VERSION/CONTRIBUTING) — kod başladı, branch feat/v-final-train.
- **S-006** (2026-07-10) · sürekli-yürütme protokolü (18) + completeness 5 gap (GAP-041..045).

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
