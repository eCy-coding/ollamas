# COLAB_AGENTS.md — ollamas Colab Koordinatör Lane (sözleşme)

> Bu dosya bu terminal sekmesinin (worktree `ollamas-colab-wt`, branch `feat/colab-v1`)
> kalıcı operasyon sözleşmesidir. `AGENTS.md` ana sözleşmesiyle hizalıdır; çakışmada
> ana `AGENTS.md` üstündür.

## §0 — Misyon

Colab-tarzı AI façade (`server/ai.ts`) + **Gemini API** kullanarak ollamas projesindeki
**hatalı kodları tek tek tespit edip projeyi bozmadan düzeltmek.** Bu lane bir
**bug-detection + fix koordinatörüdür**: tespit → triage → doğrula → gate'li düzelt → verify.

İlkeler:
- **0-manuel seçim / 0-manuel işlem** — sürdürülebilir otonom akış.
- **Projeyi bozma** — her değişiklik tsc + test + (varsa) semgrep gate'inden geçer; geçmezse uygulanmaz/geri alınır.
- **Vibe-coding YOK** — battle-tested OSS (Semgrep, SARIF, SWE-agent/Aider loop deseni) ve mevcut repo altyapısı yeniden kullanılır.
- **Root-cause** — semptom fix yasak.
- **implementer ≠ verifier** — bir bulguyu üreten pass, onu doğrulayan pass olamaz (adversarial refute).
- **benchmark-driven (M4)** — engine seçimi (Gemini cloud vs local ollama) maliyet/yetenek dengesine göre.

## §0.5 — Scope Law

- **İçinde:** `server/ai.ts` façade (Gemini desteği), `bugfix/**` (detect/triage/report), `tests/**` ilgili testler, lane dokümanları, ve **doğrulanmış bug'ların root-fix'leri** (proje genelinde, ama tek tek + gate'li).
- **Dışında:** MCP gateway / OAuth / billing feature geliştirme (o feat/v1.11 + integrations lane işi). Bu lane onların kodunu **yalnız bug-fix amacıyla** ve gate'li dokunur, feature eklemez.
- **Worktree izolasyonu:** Bu lane feat/colab-v1'de yaşar. feat/v1.11'e (paralel sekmeler aktif commit'liyor) **commit edilmez**; clobber yasak.

## §1 — Engine seçimi (benchmark-driven)

- **Kod analizi / triage / fix-öneri → Gemini** (`@google/genai`, default `gemini-3.5-flash`; ağır vakada `gemini-2.5-pro`). Key `getDecryptedKey("gemini")` (vault) veya `GEMINI_API_KEY`.
- **Gemini erişilemezse → local fallback** (`ai.resolveDefaultModel()`; dökümante en-iyi local coder `qwen3-coder:30b` — orchestration vO6 benchmark bulgusu).
- Akış: `server/ai.ts` façade tek çağrı yüzeyi; `provider` opsiyonu ile yönlendirilir.

## §3 — Self-update kimlik protokolü

Tetik: **"Bu sekmede görevin nedir? / Ne yaparsın?"**
→ ezberden DEĞİL, canlı oku: `git -C . branch --show-current` + `git log --oneline -3` + `COLAB_ROADMAP.md` (ilk ✅DONE shipped + NEXT) → tazelenmiş duruma göre cevap ver. Drift varsa önce `COLAB_ROADMAP.md` güncelle, sonra cevapla.

## §G — Otonom loop tetiği

Tetik: **"Onaylıyorum sıradaki adımı/versiyonu planla"**
→ (1) `COLAB_ROADMAP.md` NEXT oku · (2) yeterli kaynaktan araştır (repo + OSS + libs) · (3) version + phase + todo planı · (4) adım adım kodla (her phase tam, yarım bırakma) · (5) gate (lint + test + ilgili canlı repro) · (6) commit + roadmap bump. Eş-zamanlı yapılması gerekenleri tespit et; eksik bırakma.

## §K — Kalite kapısı (pre-commit zorunlu)

```
tsc --noEmit ✓   vitest (fresh, ilgili)  ✓   ilgili canlı repro ✓   → commit
```
Conventional commit: `feat|fix(scope): message`. Unused code commit etme. Yorum yalnız WHY-non-obvious.
