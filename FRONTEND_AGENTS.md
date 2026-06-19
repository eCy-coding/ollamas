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
üzerinden **tüketir**. Backend davranışı eksikse → bu lane'de çözülmez; backend lane'e
backlog notu düşülür (`FRONTEND_SEYIR_DEFTERI.md`).

**İç choke-point = `src/lib/apiClient.ts` (vF3+).** Component'ler `fetch`/`EventSource`'u
DOĞRUDAN çağırmaz; tüm backend I/O `api.get/post/put/del/streamPost` üzerinden geçer
(tek yerde auth header + retry + hata→`/api/logbook` + stream decode). İstisnalar
dosyada yorumla işaretlenir: harici API (Google Drive) + `SaaSAdmin` lokal token-wrapper.
vF6'da eslint kuralı raw `fetch`'i yasaklar (mekanik denetim — `src/**` kapsamı).

**Vanilla alt-lane istisnası (vF7+):** `web/**` (landing) + `public/embed.js` (gömülebilir
widget) React component DEĞİL, **zero-dep ayrı dağıtılabilir** — apiClient import etmez,
minimal kendi `fetch`'ini kullanır (embed.js herhangi siteye gömülür, bundler yok). eslint
`src/**` kapsamında olduğu için bu lane kuralın dışında; choke-point yalnız mantıksal
(yine sadece mevcut public endpoint'leri tüketir, backend dokunulmaz).

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
eslint (a11y + hooks + choke-point ban, vF6+)  ✓   # npm run lint = eslint && tsc
tsc --noEmit (type)                            ✓
frontend test suite (fresh, vitest/play)       ✓
a11y gate (axe-core WCAG AA e2e, vF6+)         ✓   # 0 critical/serious
perf bütçe (Lighthouse/bundle, vF3+)           ✓
→ sonra conventional commit: feat|fix|refactor|chore|docs|test(ui|web|pwa|a11y): msg + (vFn)
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
- **Client hata telemetri (vF8+):** React crash `<ErrorBoundary onError>` + `window.error`/`unhandledrejection` → `logClientEvent('react_error'|'window_error'|'unhandled_rejection')` → `/api/logbook`. `apiClient` zaten `api_error/api_stream_error/api_network_error` yollar. vF10 bu sinyalleri toplar.

---

## 7. 10-Versiyon Roadmap (vF = frontend version)

Her versiyon bir kör nokta kapatır + ollamas'a e2e fayda. Adoption = en-yıldızlı,
macOS+iOS-uyumlu, MIT/Apache repo'dan **çalışan kod** (detay: `FRONTEND_ADOPTION.md`).
Özet; tetikle tam faza açılır (§8).

| Ver | Ad | Durum | Adoption | Özet |
|-----|-----|-------|----------|------|
| **vF1** | Test Foundation | ✅ DONE | testing-library | Vitest + RTL + jsdom; 17 UI testi |
| **vF2** | E2E Harness | ✅ DONE | playwright | Playwright; SSE + workspace + saas akışı; lane CI |
| **vF3** | Perf Baseline & Budget | ✅ DONE | web-vitals, lighthouse-ci, size-limit | `apiClient` choke-point + budget.json + size-limit + frontend-perf CI + web-vitals→logbook |
| **vF4** | PWA / iOS web-clip | ✅ DONE | vite-plugin-pwa | manifest + SW + offline shell + iOS meta + apple-touch-icon |
| **vF5** | Design System & Tokens | ✅ DONE | style-dictionary | tokens/*.json → tokens.css → Tailwind v4 @theme |
| **vF6** | Accessibility (WCAG AA) | ✅ DONE | axe-core, jsx-a11y | axe Playwright gate (0 critical/serious) + eslint flat-config jsx-a11y + raw-fetch ban + klavye/ARIA/nav-landmark |
| **vF7** | Vanilla alt-lane (Landing/Embed) | ✅ DONE | shadow-dom pattern | `web/` landing (Vite multi-page, token reuse) + `public/embed.js` zero-dep Shadow-DOM streaming chat widget; vite-preview e2e |
| **vF8** | Real-time UX Polish | ✅ DONE | react-error-boundary | streamPost reconnect/onError + ReactAgentTab abort-on-unmount + `<ErrorBoundary>`→logbook + global error/unhandledrejection + Skeleton + prefers-reduced-motion |
| **vF9** | i18n + Theming | NEXT | @lingui/core | TR/EN ICU + tema switch (light tokens) + tercih kalıcılığı |
| **vF10** | Observability & Self-Heal | — | — | client error boundary→/api/logbook + RUM + perf/görsel regresyon gate |
| **vF11** | Tenant-aware Cockpit | — | — | tier-gated UI (safe/host/privileged görünürlük) + scope-gated butonlar |
| **vF12** | Billing & Usage UX | — | — | usage timeseries (pure SVG) + Stripe portal/checkout + invoice preview |

Sıra esnek değil: vF1→vF2 (test altyapısı olmadan e2e yok); vF3 `apiClient` choke-point
vF6 eslint-ban + vF10 telemetri + vF11 tenant'ı besler; vF5 token vF6 kontrast + vF9 tema'yı.

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

---

## 10. Brain / Memory / Skill / Slash Protokolü (her işlemde)

Verimliliği maksimize için her görevde sırayla:

1. **Brain** — yeni feature/davranış öncesi `superpowers-brainstorming`; bug öncesi
   `superpowers-systematic-debugging`. Süreç skill'i HER ZAMAN implementasyon skill'inden önce.
2. **Memory** — başta `project_ollamas_frontend.md` oku (stale olabilir → koda/git'e güven);
   versiyon kapanışında güncelle. Tek hafıza: bu dosya + `FRONTEND_SEYIR_DEFTERI.md`.
3. **Skill routing** (CLAUDE.md canonical): React/component → `jeff-react-expert`;
   UI tasarım → `frontend-design` / `web-design-guidelines`; e2e → `ag-awt-e2e-testing` /
   `webapp-testing`; test → `superpowers-test-driven-development`; a11y/güvenlik →
   `ag-api-security-best-practices`; commit → `caveman:caveman-commit`; PR → `create-pr`.
4. **Slash** — `/a3` SWOD analiz (sıradaki vF planı), `/a2` validate, `/verify` bitiş kontrolü.
5. **Prompt** — işe başlamadan o iş için en verimli prompt'u kur (rol + kanıt-talebi +
   "max N words"), sonra prompt'a uy. Subagent yalnız summary döner.

Kör nokta kuralı: bir işi bitirirken **bir sonraki işin ilk adımını hesapla** (§8.7),
çapraz-etki düşün (token/perf/a11y/iOS), kritik eksiği gizleme (§3.5).

---

## 11. Adoption Disiplini (vibe-coding yasak)

Yeni mimari icat etme. En-yıldızlı + macOS/iOS-uyumlu + MIT/Apache repo'dan **çalışan kod**
adopte et (`FRONTEND_ADOPTION.md` kataloğu). Akış: upstream README/örnek oku → minimal
entegrasyon kopyala → Scope Law + iç choke-point'e uyarla → test+benchmark kanıtı.
Lisanssız repo = yalnız fikir, kod kopyalama yok. Attribution yorumda.
