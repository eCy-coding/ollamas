# FRONTEND_AGENTS.md — ollamas Frontend Lane (Master Prompt / Sub-Contract)

> Bu dosya ollamas üzerinde **yalnızca frontend** (HTML5 / JavaScript / CSS) çalışan
> agent'ın (Claude Code dahil) **değişmez operasyon sözleşmesidir**. `AGENTS.md`'nin
> **sub-contract**'ıdır: AGENTS.md §1-§8 burada geçerlidir, bu dosya yalnız frontend
> alanını daraltır/özelleştirir. Çelişki olursa AGENTS.md üst kuraldır.
> Her oturumda önce AGENTS.md'yi, sonra bunu oku, sonra çalış.
>
> **"Java" = JavaScript.** Repoda `.java` yok; alan = HTML5 + JS/TS + CSS.

---

## 0. Kuzey Yıldızı

**Frontend lane = ollamas cockpit'ini hızlı, erişilebilir, iOS-uyumlu, test+benchmark-kanıtlı yapmak.**

Bugün: React 19 + TS + Vite + Tailwind v4 SPA (`src/`, 13 component), `dist/` prod bundle,
Express `server.ts` port 3000 servis eder. Hedef: her etkileşim ölçülmüş-hızlı, WCAG AA
erişilebilir, MacBook + iOS Safari'de kanıtlanmış, test-kapılı bir arayüz.

Her commit bu hedefe yaklaştırmalı. Backend'e dokunan iş bu lane'in işi DEĞİLDİR.

---

## 1. Scope Law (değişmez — bu lane'in kalbi)

**Düzenlenebilir:**
- `index.html`, `src/**` (`.tsx`/`.ts`/`.css`), `src/components/**`, Tailwind config, `vite.config.ts` (yalnız frontend build),
- yeni vanilla alt-lane: `web/**` (saf HTML5/CSS/JS — landing, iOS web-clip, embed widget),
- frontend test dosyaları: `tests/ui/**`, `tests/e2e/**`, frontend test config.

**YASAK (dokunma):**
- `server.ts`, `server/**`, `backend/**`, `bin/**`, `deploy/**`, billing/store/mcp kodu.
- Yeni API endpoint, yeni tool, yeni dispatch yolu.

**Choke-point = ollamas HTTP API.** Frontend backend'i yalnız mevcut 67 endpoint + SSE
üzerinden **tüketir** (`fetch`/`EventSource`). Backend davranışı eksikse → bu lane'de
çözülmez; backend lane'e backlog notu düşülür (`FRONTEND_SEYIR_DEFTERI.md`).

Şüphede default = REDDET + sor.

---

## 2. Roller

İş bir role atanır; rol prensiplerini uygular. Bir oturumda geçiş serbest, her adımın sahibi net.

| Rol | Sorumluluk |
|-----|-----------|
| **Frontend Architect** | Bileşen ağacı, state akışı, route/tab tasarımı, versiyon faz planı |
| **Component Coder** | Tam, çalışır TSX/CSS + vanilla HTML/JS üretir |
| **A11y + Design Reviewer** | WCAG AA, semantic HTML, design-token tutarlılığı, kontrast |
| **Perf + Benchmark Engineer** | Bundle bütçesi, LCP/CLS/INP, code-split, MacBook+iOS ölçüm |
| **iOS + PWA Engineer** | manifest, service worker, responsive, Safari/web-clip uyumu |

---

## 3. Değişmez Prensipler (ihlal = hata)

AGENTS.md §2 (1-8) miras alınır + frontend ekleri:

1. **Root cause önce** — semptom/CSS-hack YASAK.
2. **Evidence önce** — "çalışıyor" = komutu koş + çıktı/screenshot göster. Kanıtsız tamam yok.
3. **TDD** — component testi önce, implementasyon sonra (vF1'den itibaren).
4. **Paralel Tier-1** — bağımsız işler TEK mesajda.
5. **CRITICAL gizleme YASAK** — kötü haber ilk sıra.
6. **Unused code/CSS silinir** — commit etme.
7. **Comment sadece non-obvious WHY.**
8. **A11y-first** — semantic HTML + klavye + ARIA varsayılan, sonradan değil.
9. **Perf-budget-first** — bütçe aşan değişiklik kanıtlı gerekçe ister (§5).
10. **No backend mutation** — §1 Scope Law.

---

## 4. Kalite Kapısı (pre-ship ZORUNLU)

Commit öncesi sırayla, her biri taze koşu:

```
tsc --noEmit (type)                       ✓
lint (eslint / lint_format)               ✓
frontend test suite (fresh, vitest/play)  ✓
perf bütçe (Lighthouse/bundle, vF3+)      ✓
→ sonra conventional commit: feat|fix|refactor|chore|docs|test(ui|web|pwa): msg + (vFn)
```

Biri kırmızıysa commit YOK. Atlanan adım açıkça söylenir.
**Not:** vF1 öncesi frontend test yok → o ana kadar kapı = tsc + lint + manuel kanıt.

---

## 5. Benchmark Protokolü (en verimli yöntemi ÖLÇ, varsayma)

**Hedef cihazlar:** MacBook (Apple Silicon/M4 — repo `--metal --threads 12`) + iOS Safari (web-clip).

**Metrikler:** bundle KB (JS/CSS, baz: 477/45KB) · LCP · CLS · INP · TBT · cold/warm load · frame budget (60fps=16ms) · memory.

**Kural:** İki yöntem arasında seçim = ölçülen kazanan. Kanıt `FRONTEND_SEYIR_DEFTERI.md`'ye
+ kayda değerse `~/.llm-mission-control/seyir-defteri.jsonl`'e (`/api/logbook` POST, `kind:"note"`).
iOS testi gerçek cihaz/Safari yoksa responsive emulation + not düş ("emulated").

---

## 6. Logbook & Hata Sicili

- Her faz/versiyon → `FRONTEND_SEYIR_DEFTERI.md` (ne/nasıl/niçin/kanıt+commit).
- Her hata → aynı dosyadaki **Hata Sicili** tablosu (root cause + önleme kuralı).
- **Aynı hatayı tekrar yapmak = ihlal.** Koda başlamadan Hata Sicili okunur.

---

## 7. 10-Versiyon Roadmap (vF = frontend version)

Her versiyon bir kör nokta kapatır + ollamas'a e2e fayda. Özet; tetikle tam faza açılır (§8).

| Ver | Ad | Kapatır | Özet |
|-----|-----|---------|------|
| **vF1** | Test Foundation | test boşluğu | Vitest + React Testing Library + jsdom; 13 component DOM/render testi; kapı frontend'e genişler |
| **vF2** | E2E Harness | e2e boşluğu | Playwright; agent-chat SSE + workspace tree + SaaS admin akışları; CI'ya bağla |
| **vF3** | Perf Baseline & Budget | perf boşluğu | Lighthouse CI + bundle analyzer + bütçe; ağır component code-split; MacBook benchmark script |
| **vF4** | PWA / iOS web-clip | iOS boşluğu | manifest.json + service worker + offline shell + apple-touch-icon + responsive + iOS Safari benchmark |
| **vF5** | Design System & Tokens | DS boşluğu | Tailwind token → dökümante design system; primitives kataloğu; tema tutarlılığı |
| **vF6** | Accessibility (WCAG AA) | a11y boşluğu | axe-core testlerde; klavye nav + ARIA + focus yönetimi |
| **vF7** | Vanilla alt-lane (Landing/Embed) | hibrit | saf HTML5/CSS/JS landing + embeddable widget; API'yi fetch ile tüketir; zero-dep |
| **vF8** | Real-time UX Polish | UX | SSE/streaming hardening + error boundaries + skeleton/loading + cockpit grafik perf |
| **vF9** | i18n + Theming | i18n | TR/EN i18n + tema switch + kullanıcı tercih kalıcılığı |
| **vF10** | Frontend Observability & Self-Heal | gözlem | web-vitals → /api/logbook + görsel regresyon + perf regresyon gate + hata telemetri |

Sıra esnek değil: bağımlılık zinciri vF1→vF2 (test altyapısı olmadan e2e yok),
vF3 perf bütçesi vF4 iOS'u kapılar, vF5 DS vF6 a11y'yi besler.

---

## 8. Çalışma Modeli (kalıcı)

Tetik cümlesi: **"sıradaki versiyonu planla"** →
1. Mevcut tamamlanmamış en düşük vFn alınır.
2. Tam **todo + faz listesi** üretilir (TodoWrite).
3. TDD ile **kesintisiz** kodlanır (test önce).
4. **Kalite kapısı** (§4) taze koşar.
5. Conventional commit + `(vFn)` etiketi.
6. `FRONTEND_SEYIR_DEFTERI.md` güncellenir (kanıt + hata sicili).
7. Bir sonraki versiyonun ilk adımı **önceden hesaplanır** ve faz log'a "Sonraki" notu düşülür.

Plan tek seferlik değil — sürekli, her işlemde bir adım ileri. Kural değişiyorsa
**önce bu dosya** güncellenir, sonra kod.

---

## 9. Token Disiplini

- Progressive disclosure — gereken kadar oku.
- Subagent yalnız **summary** döner; her agent prompt'a "max 200 words / bullet only".
- Bağımsız Agent() çağrıları TEK mesajda paralel.
- Tekrarlanan keşif yok — bu dosya + seyir defteri tek hafıza kaynağı.
- Min token, max performans.
