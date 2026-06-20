# Frontend Seyir Defteri — ollamas Frontend Lane

Bu defter ollamas **frontend lane**'inin (HTML5 / JavaScript / CSS) adım adım kaydıdır.
Sözleşme: [`FRONTEND_AGENTS.md`](./FRONTEND_AGENTS.md). Üst sözleşme: [`AGENTS.md`](./AGENTS.md).

Her versiyon/faz: **ne** yapıldı, **nasıl**, **niçin**, kanıt (commit + test/benchmark çıktısı).
Kayda değer hatalar ayrıca aşağıdaki **Hata Sicili**'ne; çalışma-zamanı notlar
`~/.llm-mission-control/seyir-defteri.jsonl`'e (`/api/logbook`, `kind:"note"`).

---

## Faz vF0 — Governance kuruldu
- **Ne:** Frontend lane sözleşmesi (`FRONTEND_AGENTS.md` §0-§9) + bu seyir defteri + 10-versiyon roadmap (vF1→vF10) kuruldu.
- **Nasıl:** ollamas keşfi (3 paralel Explore) → kör nokta tespiti (test/e2e/iOS/perf/a11y/governance boşlukları) → AGENTS.md sub-contract'ı olarak hibrit (React cockpit + vanilla iOS/PWA alt-lane) tasarım.
- **Niçin:** kesintisiz/sürdürülebilir, ölçülmüş-verimli, tekrar-eden-hatasız bir frontend şeridi. Tek görev alanı HTML5/JS/CSS; backend dokunulmaz (Scope Law §1).
- **Kanıt:** `ls FRONTEND_*.md` → 2 dosya; hiçbir backend/kod dosyası değişmedi.
- **Sonraki:** vF1 Test Foundation.

---

## Faz vF1 — Test Foundation (DONE)
- **Ne:** jsdom tabanlı React component test katmanı kuruldu. 13 component kapsandı, **17 UI testi** yeşil. Kalite kapısı frontend'e genişledi.
- **Nasıl:**
  - devDeps: `@testing-library/react@16` + `@testing-library/dom@10` + `@testing-library/jest-dom@6` + `@testing-library/user-event@14` + `jsdom@26`.
  - `vitest.config.ts` `test.projects` ile node/jsdom izolasyonu (Vitest 4 `environmentMatchGlobs` kaldırıldığı için). node = `tests/**/*.test.ts` (exclude `tests/ui`), jsdom = `tests/ui/**/*.test.tsx` + `tests/ui/setup.ts`. (Scripts lane 3. proje `scripts` ekledi — shared dosya.)
  - `tests/ui/setup.ts`: jest-dom matchers + jsdom stub'lar (matchMedia, ResizeObserver, EventSource, scrollIntoView, default empty-ok fetch) + afterEach cleanup.
  - `tests/ui/helpers.tsx`: `renderUI()` + `mockFetch(routes)` (substring route→body, `vi.spyOn`; MSW yok).
  - Testler: `App.test.tsx` (13 tab nav + tab-switch etkileşim), `TelemetryCockpit` (PURE null+data), `VirtualController` (PURE + buton→POST assert), `GoogleDriveBrowser` (useAuth mock), `components.smoke.test.tsx` (9 network component `it.each` anchor + crash-yok).
- **Niçin:** frontend regresyonu artık sessizce kaçmaz; §4 kapısı tsc + UI test içerir.
- **Kanıt:** `npx tsc --noEmit` OK · `npx vitest run` → **108 pass / 1 skip / 0 fail** (node+jsdom+scripts); `--project jsdom` → 17/17; `--project node` → 73/1 (backend bozulmadı). Backend kodu git-diff'te YOK (selective commit).
- **Sonraki (önceden hesaplandı):** vF2 E2E Harness.

---

## Faz vF2 — E2E Harness (Playwright) (DONE)
- **Ne:** Playwright e2e harness; çalışan app'e (port 3100) karşı **4 spec yeşil**: smoke + workspace + saas + agent-chat (deterministik/offline). Lane-owned CI job.
- **Nasıl:**
  - devDep `@playwright/test@1.61` + chromium-1228 + headless-shell.
  - `playwright.config.ts`: `testDir:tests/e2e`, `testMatch:*.spec.ts`, `webServer:'PORT=3100 npm run dev'` (reuseExistingServer !CI), `trace:on-first-retry`, `screenshot:only-on-failure`, chromium projesi.
  - `tests/e2e/`: `smoke` (4 tab nav görünür), `workspace` (Files Explorer→"Target Directory Explorer"), `saas` (SaaS Gateway→"SaaS Gateway Control"), `agent-chat` (`page.route` ile /api/models + /api/agent/sessions [GET array / POST obj] + /api/agent/chat streamed `data:{json}\n\n` stub → greeting → EXECUTE → mock yanıt DOM'da). LLM/ollama bağımlılığı YOK.
  - `.github/workflows/e2e.yml` (YENİ, shared ci.yml'e dokunmadan): node24 + `playwright install --with-deps` + `playwright test` + report artifact.
  - `.gitignore` += test-results/playwright-report. `package.json` += `test:e2e`.
- **Niçin:** gerçek tarayıcıda boot + kritik akış doğrulaması; unit/jsdom'un göremediği entegrasyon.
- **Kanıt:** `npx playwright test` → 4 passed (3.7s) · `npx vitest run` → 90 pass/1 skip (vF1 intact, e2e specleri vitest'e sızmadı) · `npx tsc --noEmit` OK.
- **⚠️ Ortam pivotu:** Ana dizinde sync daemon hijack (branch flip + working-tree revert) → frontend işi **izole worktree** `~/Desktop/ollamas-frontend-wt` (branch `feat/frontend-vf2`, vF1/ad07cbe tabanlı) taşındı. Daemon worktree'ye dokunmuyor.
- **Sonraki (önceden hesaplandı):** **vF3 Perf Baseline & Budget** — Lighthouse CI + bundle analyzer; bütçe (JS<300KB hedef, baz 477KB → code-split ağır component). İlk adım: `rollup-plugin-visualizer` veya `vite build --metafile` ile bundle haritası + `@lhci/cli` config + MacBook benchmark scripti. İzole worktree'de devam.

---

## Faz vF3 — Perf Baseline & Budget + ApiClient choke-point (DONE)
- **Ne:** Frontend için tek I/O choke-point (`src/lib/apiClient.ts`) + perf bütçe sistemi (size-limit + lighthouse-ci) + web-vitals field telemetri kuruldu. 13 component'in 10'u `api.*`'e taşındı.
- **Nasıl:**
  - `src/lib/apiClient.ts`: `api.get/post/put/del` (auth header lokalStorage'dan, GET 5xx/429 retry, hata→`logClientEvent`→`/api/logbook`) + `streamPost` (SSE-over-POST `getReader` decode). `ApiError(status)`. 7 test (`tests/ui/apiClient.test.ts`).
  - `src/lib/vitals.ts`: web-vitals (Apache-2.0) lazy import → LCP/INP/CLS/FCP/TTFB → `navigator.sendBeacon('/api/logbook')`. `main.tsx`'te wired (ayrı 2.6KB gz chunk).
  - Migration: App/VirtualController/WorkspaceTree/SelfTestGates/CommandLineTerminal/BackupControl/ClusterManager/SecurityPolicies/MultiAgentPipeline/ReactAgentTab → `api.*`. **İstisna:** GoogleDriveBrowser (harici googleapis), SaaSAdmin (lokal token-wrapper) — yorumla işaretli.
  - Perf gate: `.size-limit.json` (JS<140KB / CSS<12KB gz), `budget.json` + `lighthouserc.json` (LCP<2.5s, CLS<0.1), `.github/workflows/frontend-perf.yml` (build→size→lhci; shared ci.yml'e dokunmadan).
- **Niçin:** dağınık 36 fetch çağrısı tek denetlenebilir noktaya indi (auth/retry/hata/telemetri); perf regresyonu artık CI'da kırmızı.
- **Kanıt:** `tsc --noEmit` 0 · `vitest run` 97 pass/1 skip · `vite build` OK · `size-limit` 107.7KB/140 + 6.85KB/12 (brotli) · migration maliyeti +0.6KB gz. Commit `0fdbb94`.
- **Sonraki (önceden hesaplandı):** vF4 PWA.

## Faz vF4 — PWA / iOS web-clip (DONE)
- **Ne:** Cockpit yüklenebilir (installable) PWA + iOS web-clip oldu; offline shell + manifest + SW.
- **Nasıl:** `vite-plugin-pwa` (MIT) `registerType:autoUpdate` + `injectRegister:auto` → `dist/sw.js` + `workbox-*.js` + `manifest.webmanifest` üretildi. Workbox: precache (8 entry) + `/api/health` NetworkFirst (3s timeout, canlı telemetri için). `index.html` iOS meta (`apple-mobile-web-app-capable`, `status-bar-style`, `apple-touch-icon`, `viewport-fit=cover`, `theme-color`). `public/pwa-icon.svg` app mark. CSP gotcha: server.ts Helmet CSP kapalı → SW register engellenmiyor (backend dokunulmadı).
- **Niçin:** iOS Safari "Add to Home Screen" + offline kabuk; MacBook'ta standalone pencere.
- **Kanıt:** `vite build` → sw.js + manifest.webmanifest doğru içerik · 3 source-level guard test (`tests/ui/pwa.test.ts`) · `tsc` 0 · jsdom 27 pass. Commit `8d0a258`.
- **Sonraki (önceden hesaplandı):** vF5 design tokens.

## Faz vF5 — Design System & Tokens (DONE)
- **Ne:** Tema değerleri JSON token single-source'a çekildi → CSS var → Tailwind v4 `@theme`.
- **Nasıl:** `style-dictionary` (Apache-2.0) `tokens/*.json` (color/font/radius/space) → `src/styles/tokens.css` (`--ollamas-*` vars, prefix). `src/index.css` `@theme` artık hardcoded hex yerine `var(--ollamas-*)` referanslar; `@import "./styles/tokens.css"`. `npm run tokens` regen. 3 test incl. **regen-in-sync** (build no-op olmalı).
- **Niçin:** tek doğruluk kaynağı (Figma/iOS/native paylaşımlı katman, vF9 tema için hazır); tema tutarlılığı.
- **Kanıt:** `vite build` → built CSS'te `var(--ollamas-color-bg-base)` çözülüyor (zincir çalışıyor) · CSS 7.03KB/12 gz · `tsc` 0 · jsdom 30 pass. Commit `1b6eca1`.
- **Sonraki (önceden hesaplandı):** **vF6 Accessibility (WCAG AA)** — `@axe-core/playwright` e2e gate + `eslint-plugin-jsx-a11y` (+ raw-`fetch` yasağı kuralı ile choke-point mekanik denetimi) + klavye nav + ARIA + focus yönetimi. İlk adım: eslint flat-config kur (mevcut yalnız `tsc`), jsx-a11y + `no-restricted-syntax` raw-fetch, sonra axe spec.

---

## Faz vF6 — Accessibility (WCAG AA) + ESLint a11y gate + choke-point ban (DONE)
- **Ne:** Frontend'e otomatik WCAG AA kapısı kuruldu: statik a11y lint (eslint-jsx-a11y) + çalışma-zamanı axe taraması (4 tab, 0 critical/serious) + klavye nav + choke-point eslint-ban. **KeyVault'un vF3'te kaçan 4 raw fetch'i** ban ile yakalandı → migrate.
- **Nasıl:**
  - **ESLint flat-config** (`eslint.config.js`, YENİ): `jsxA11y.flatConfigs.recommended` + `react-hooks/rules-of-hooks` + `no-restricted-globals` (raw `fetch`/`EventSource` yasağı, components+App; override: apiClient/GoogleDriveBrowser/SaaSAdmin). Bilinçli dar kapsam: tsc tipleri tutar, eslint yalnız a11y+hooks+ban. `lint`=`eslint . && tsc --noEmit`. Adoption: eslint-plugin-jsx-a11y (MIT), react-hooks (MIT), typescript-eslint parser (MIT).
  - **a11y fix** (pattern, ~7 dosya): icon-only buton → `aria-label` (SaaSAdmin Copy/Trash2/Plus, WorkspaceTree refresh/create, App notification-dismiss); unlabeled input/select → `aria-label` (SaaSAdmin tenant/plan/webhook); `<label>`→input `htmlFor`/`id` (BackupControl×5, ReactAgentTab, MultiAgentPipeline); onClick-`<div>` → `role=button`+`tabIndex`+`onKeyDown` (WorkspaceTree row, ReactAgentTab session); tab-bar `<nav aria-label="Primary">` landmark + `aria-current`.
  - **axe gate** (`tests/e2e/a11y.spec.ts`, YENİ): `@axe-core/playwright` (MPL-2.0) 4 tab `withTags(wcag2a/2aa/21aa)` → 0 critical/serious. `color-contrast` devre dışı (dark-theme dekoratif düşük-kontrast = ayrı design pass, GİZLENMEDİ, aşağıda izlendi). Files tab `/api/workspace/**` stub (gerçek FS-scan paralelde takılıyor).
  - **klavye + ARIA**: `tests/e2e/keyboard.spec.ts` (focus+Enter+Tab) + `tests/ui/a11y.test.tsx` (nav landmark + accessible-name).
  - **CI**: `.github/workflows/frontend-lint.yml` (YENİ, eslint+tsc); axe/keyboard e2e mevcut `e2e.yml`'de otomatik.
- **Niçin:** ekran-okuyucu + klavye erişimi (WCAG AA, axe ~%57 issue); choke-point artık eslint ile mekanik denetimli (yeni raw fetch CI'da kırmızı) — KeyVault kaçağı bunu kanıtladı.
- **Kanıt:** `npm run lint` (eslint+tsc) 0 · `vitest run` **105 pass/1 skip** · `playwright test` **10 pass** (4 axe + 2 keyboard + 4 mevcut) · `vite build` + size 107.9KB/140 gz (+0.2KB). Commit: `74c3a99`.
- **⚠️ İzlenen açık (gizlenmedi):** axe `color-contrast` kapıdan çıkarıldı — dark cockpit teması çok sayıda düşük-kontrast dekoratif metin (`text-slate-500/600`, `text-[8-10px]`) içeriyor; tema-geneli kontrast düzeltmesi ayrı design pass gerektirir (öneri: vF için "contrast sweep" veya vF9 tema ile). %57 otomatik + %43 manuel (VoiceOver/uzman) kuralı.
- **Sonraki (önceden hesaplandı):** **vF7 Vanilla alt-lane (Landing/Embed)** — saf HTML5/CSS/JS `web/` landing + embeddable widget; API'yi `fetch` ile tüketir (apiClient React-only; vanilla'da minimal fetch-wrapper), zero-dep, iOS web-clip uyumlu. İlk adım: `web/index.html` + `web/embed.js` iskelet + landing kopya + Vite multi-page VEYA ayrı statik klasör kararı; lighthouse landing perf bütçesi.

---

## Faz vF7 — Vanilla alt-lane: Landing + embeddable chat widget (DONE)
- **Ne:** İki zero-dep vanilla yüz eklendi: (1) `web/` landing (public yüz, canlı health rozeti), (2) `public/embed.js` — herhangi siteye `<script>` ile gömülen Shadow-DOM streaming chat widget. React bundle taşınmaz; backend dokunulmaz.
- **Nasıl:**
  - **Vite multi-page** (`vite.config.ts` `build.rollupOptions.input` = app/landing/embedDemo). `web/index.html`+`landing.css`+`landing.js` semantik HTML5 (vF6 a11y: nav landmark/alt/aria-live), `@import "../src/styles/tokens.css"` → --ollamas-* token reuse (tek-kaynak). `landing.js` vanilla `fetch('/api/health')` → online/offline rozet (defensif shape).
  - **`public/embed.js`** (verbatim, zero-build): IIFE + `attachShadow` (host-CSS izolasyon) + floating bubble/panel; config `data-api-base/model/provider/title`; `POST /api/generate` SSE `getReader()` decode (apiClient.streamPost deseni reimplement — standalone kısıt). a11y: aria-label/role/log. **Adoption:** Shadow-DOM + SSE-read deseni (`chatui`/`quikchat` zero-dep widget'lar) — fikir-level reimplement, kod kopyalanmadı.
  - **Serving/e2e:** dev server Express (SPA-only) → static lane `vite preview` ile servis. `playwright.web.config.ts` (YENİ, :3101, `serviceWorkers:'block'`); `tests/e2e-web/` landing (hero+health online/offline+axe 0 critical/serious) + embed (bubble→SSE stream yanıt + hata). `test:e2e:web` script.
  - **Bütçe:** `.size-limit.json` ayrıştırıldı: cockpit app + landing + **embed widget ≤15KB**. CI `frontend-web.yml` (YENİ).
- **Niçin:** ollamas'ın public landing'i + 3.parti-site gömme yolu yoktu; ikisi de framework taşımadan, izole, ölçülü.
- **Kanıt:** `npm run lint` 0 · `vitest` 105 pass/1 skip · React e2e **10 pass** · web e2e **5 pass** (landing 3 + embed 2) · `vite build` 3-entry (dist/web/* + dist/embed.js 7.2KB) · size: embed **2.4KB** brotli / landing 403B / cockpit 108KB/140. Commit: `071ac85`.
- **Sonraki (önceden hesaplandı):** **vF8 Real-time UX Polish** — SSE/streaming hardening (apiClient.streamPost'a reconnect/abort + embed.js retry), React error boundary → `/api/logbook`, skeleton/loading state, cockpit grafik frame-budget (60fps). İlk adım: `apiClient.streamPost`'a `AbortController` + auto-reconnect/backoff + `<ErrorBoundary>` component (vF10 telemetri'ye köprü) + agent-chat skeleton.

---

## Faz vF8 — Real-time UX Polish (DONE)
- **Ne:** Streaming dayanıklılığı + crash izolasyonu + anlamlı yükleniyor + reduced-motion. Hata gözlem boşluğu kapandı (React crash + window error/rejection → logbook).
- **Nasıl:**
  - **streamPost hardening** (`apiClient.ts`): `onError` + connect-faz retry (429/5xx/network, backoff) + **`delivered` guard** — chunk aktıktan sonra yeniden bağlanmaz (LLM generation resume edilemez; mid-stream drop dürüstçe `onError`). Abort sessiz çözülür. 4 yeni test.
  - **ReactAgentTab abort**: `abortRef`+`mountedRef`+unmount cleanup; yeni-send öncesi önceki abort; catch'te `signal.aborted→return`, finally mounted+!aborted guard (state-after-unmount fix). `MultiAgentPipeline:48-73` deseni.
  - **embed.js**: ağ hatasında connect retry-once (acc boşsa, 400ms) — mid-stream resume yok.
  - **Error boundary** (`react-error-boundary` MIT adopt): `ErrorFallback.tsx` (role=alert+reset), `main.tsx` `<App/>` sarıldı, `onError→logClientEvent('react_error',{stack})` + `window.error`/`unhandledrejection`→logbook (gözlem boşluğu kapandı → vF10).
  - **Skeleton** (`Skeleton.tsx` zero-dep CSS shimmer, token, aria-hidden): `TelemetryCockpit` null→skeleton kart (aria-busy). `index.css` `.ollamas-skeleton` + **`@media (prefers-reduced-motion: reduce)`** (WCAG 2.3.3).
- **Niçin:** flaky ağ→reconnect; tab değişimi→temiz abort (leak yok); crash→izole fallback+telemetri; anlamlı loading; motion-hassas a11y.
- **Kanıt:** `npm run lint` 0 · `vitest` **111 pass/1 skip** · React e2e **10 pass** · web e2e **5 pass** · `vite build` OK · size cockpit **109.18KB/140** (react-error-boundary +1.1KB) / embed 2.51KB. Commit: `010db54`.
- **Sonraki (önceden hesaplandı):** **vF9 i18n + Theming** — `@lingui/core` (2kB MIT) TR/EN ICU + tema switch (light token seti, vF5 üzerine) + tercih kalıcılığı (localStorage). İlk adım: `[data-theme]` light/dark token override + `@lingui/core` setup + `<ThemeToggle>` + TR/EN ilk string extraction.

---

## Faz vF9 — i18n (TR/EN) + Theming (light/dark) (DONE)
- **Ne:** Gerçek light/dark tema (token-tabanlı, no-flash) + runtime TR/EN dil değişimi (kalıcı) + shell'de `ThemeToggle`+`LanguageToggle`. Ölçülü adoption (i18next ~22KB · react-intl ~13KB · **Lingui en küçük**) → `@lingui/core`+`@lingui/react` v6 **runtime** (macro/vite-plugin YOK = build riski sıfır).
- **Nasıl:**
  - **Light token katmanı** (vF5 üzerine): `tokens-light/color.json` (ayrı kaynak, key-collision yok) + `style-dictionary.light.config.js` → `src/styles/tokens-light.css` `[data-theme="light"]` scope; `npm run tokens` dark+light üretir, **dark byte-aynı** (`git diff` temiz). `index.css` light import.
  - **Theme** (`src/lib/theme.tsx`): `ThemeProvider`+`useTheme`; init no-flash DOM `data-theme`→localStorage `ollamas.theme`→`prefers-color-scheme`; effect `documentElement.dataset.theme`+persist. `index.html` `<head>` no-flash inline script (paint öncesi `data-theme`+`lang`). `ThemeToggle.tsx` (Sun/Moon, `aria-pressed`, i18n label).
  - **Shell migration** (`App.tsx`): `themeMode` state SİL → token utility (`bg-immersive-bg/sidebar`, `text-immersive-*`, `border-immersive-border`); 5 themeMode-gated nokta. Dark görünüm korunur (token dark = eski hardcoded).
  - **i18n** (`src/lib/i18n.ts`): `i18n.load({en,tr})` + `activateLocale` (persist `ollamas.locale` + `<html lang>`); init `navigator.language` fallback. `src/locales/{en,tr}.ts` ~22 key (13 tab + shell). `main.tsx` `<I18nProvider>` (ThemeProvider içinde). `App.tsx` `useLingui()._` ile shell+tab çeviri. `LanguageToggle.tsx` (TR/EN, reaktif).
  - **Test** (`helpers.tsx` renderUI → ThemeProvider+I18nProvider wrap; mevcut testler otomatik provider alır): `theme.test.tsx` (data-theme flip+persist+aria-pressed), `i18n.test.tsx` (catalog swap + LanguageToggle persist + `<html lang>`).
- **Niçin:** Eski tema toggle kozmetikti (renkler hardcoded); gerçek token-flip + no-flash. Operatör TR, cockpit EN → çift dil. En hafif i18n = bütçe-dostu.
- **Kanıt:** `npm run lint` 0 · `vitest` **114 pass/1 skip** (+3) · React e2e **10 pass** · web e2e **5 pass** · `vite build` OK · size cockpit **112.14KB/140** (@lingui+theme/i18n +~4KB) / embed 2.51KB · `npm run tokens` dark byte-aynı.
- **Açık iz (tracked, gizlenmedi):** Derin component renk-migration'ı (13 component'in hardcoded `bg-[#08090d]`/`text-slate-*`'leri — demo wizard, status bar, panel iç renkleri, badge'ler) bu versiyonda DEĞİL → ayrı **contrast/theme sweep** (vF10+ veya bağımsız). Shell theme-aware; iç paneller hâlâ dark-sabit. Status badge'leri (LIVE/DEMO) + demo wizard metni i18n DIŞI (teknik/monospace) → ikinci string batch.
- **Sonraki (önceden hesaplandı):** **vF10 Observability & Self-Heal** — vF8 client error sinyalleri (`react_error`/`window_error`/`unhandled_rejection` → `/api/logbook`) + web-vitals'ı toplayan in-cockpit RUM paneli (pure-SVG timeseries, yeni dep yok) + perf/görsel-regresyon gate. İlk adım: `/api/logbook` GET'ten son N olayı çeken `useLogbook` hook + `ObservabilityPanel` component (telemetry tab altına) + hata-oranı/p75-vitals özet kartı.

---

## Faz vF10 — Observability & Self-Heal (in-cockpit RUM) (DONE)
- **Ne:** vF3 web-vitals + vF8 client-error event'leri ZATEN `/api/logbook`'a akıyordu ama görselleştirilmiyordu (gözlem boşluğu). vF10 cockpit-içi RUM paneli: p75 web-vitals + hata-oranı + zaman-serisi sparkline + sağlık-verdict (self-heal-lite). Sovereign/offline — harici RUM yok.
- **Nasıl:**
  - **Saf logic** (`src/lib/observability.ts`, DOM'suz→testli): `vitalsSummary` (her metrik count/latest/**p75 nearest-rank**/rating, resmi web-vitals eşikleri) + `categorizeError` (react/window/unhandled/api; `api_stream_reconnect`=geçici→hariç) + `errorCounts`/`errorBuckets` (zaman-kova) + `healthVerdict` (crash≥1 veya errs≥10→critical; errs≥3 veya poor-vital≥1→degraded).
  - **Sparkline** (`Sparkline.tsx`): zero-dep SVG `<polyline>` (adopt **fnando/sparkline** MIT deseni, reimplement; `stroke=currentColor`→theme-aware; min/max normalize; boş/tek-nokta guard; `role=img`).
  - **Hook** (`useLogbook.ts`): `api.get<LogbookResponse>('/api/logbook?limit=200',{retries:2})` choke-point; opsiyonel poll (`document.hidden` skip) + unmount-guard (FE-017).
  - **Panel** (`ObservabilityPanel.tsx`): **theme-aware token** sınıfları (`bg-immersive-panel`, `text-immersive-*`, `border-immersive-border`) — verdict kartı (renk-kodlu+öneri+refetch) + 5 vital kartı (p75+rating renk) + hata kartı (kategori+Sparkline) + son 8 olay; loading→Skeleton (vF8), error→alert, boş→noData. i18n (`useLingui()._`, en+tr ~16 key). App `telemetry` tab'ına mount (yeni tab YOK).
- **Niçin:** Üretilen telemetri kör noktaydı; operatör cockpit'te hata/perf sağlığını canlı görür. Pure-SVG = 0 bundle (bütçe). Logic saf = matematiksel doğruluk test edilebilir.
- **Kanıt:** `npm run lint` 0 · `vitest` **124 pass/1 skip** (+10: 8 logic + 2 render) · React e2e **10 pass** (a11y dahil — panel WCAG AA temiz) · web e2e **5 pass** · `vite build` OK · size cockpit **114.38KB/140** (+2.24KB zero-dep) · `npm run tokens` sync.
- **Açık iz (tracked):** `errorBuckets` `Date.now()` kullanır (app-kodu, Workflow-script-ban kapsamı DIŞI); render testi sabit `now` yerine boş-kova toleranslı. p75 tek-örneklemde = o örnek (RUM yorumu: az veri = düşük güven; `count`/n gösteriliyor). Derin component renk-sweep hâlâ açık (vF9'dan devir).
- **Sonraki (önceden hesaplandı):** **vF11 Tenant-aware Cockpit** — tier-gated UI (safe/host/privileged görünürlük) + scope-gated butonlar. İlk adım: `/api/saas` veya health'ten tenant/tier oku → `useTier` hook + tier'a göre tab/aksiyon görünürlük gate (deny-by-default, backend yetkisini UI'da tekrar zorlamaz, yalnız yansıtır).

---

## Faz vF11 — Tenant/Capability-aware Cockpit (DONE)
- **Ne:** Cockpit tab'ları + aksiyonları yetki-bilinçsizdi (`commandExec` kapalıyken Interactive CLI yine tıklanır → backend reddini ancak çağrıdan sonra görürdü). vF11 UI'yi `telemetry.permissions{}` üzerinden **deny-by-default** gate eder; backend otoritesini **yansıtır** (güvenlik sınırı değil — sınır backend `ToolRegistry` tier-allowlist'tir, zaten enforce).
- **Scope-Law kararı (kritik):** tenant **tier** (`plan.allowed_tiers`) frontend'e expose EDİLMİYOR; expose `server.ts`/`/api/health` değişikliği = YASAK → **tier-gating bu lane'de DEĞİL, backend lane backlog**. Mevcut, gerçek yüzey = `telemetry.permissions{fileRead,fileWrite,commandExec,git}` (her 5sn `/api/health`'ten) → gate bunun üzerine.
- **Nasıl:**
  - **Saf logic** (`src/lib/capabilities.ts`, DOM'suz→testli): `TAB_CAPABILITY` haritası (`terminal/automation→commandExec`, `backup→fileWrite`, `files→fileRead`, diğer 9→`null`) + `hasCapability` (**deny-by-default**: `perms==null`→false) + `isTabEnabled`.
  - **AccessGate deseni** (`src/components/CapabilityGate.tsx`, adopt rbac-ui pattern zero-dep reimplement): `CapabilityProvider` (context=permissions|null) + `useCapability` + `<CapabilityGate need fallback>` (pessimistic; loading=deny).
  - **App** (`App.tsx`): içerik `<CapabilityProvider permissions={telemetry?.permissions??null}>` ile sarıldı; **tab butonları** `isTabEnabled` false→`disabled`+`aria-disabled`+Lock-ikon+title; **gated gövdeler** (terminal/automation/backup/files) `<CapabilityGate>` + `CapabilityDenied` fallback (token-aware kart + Guard Policies'e geçiş butonu, i18n). en+tr ~11 key.
- **Niçin:** Kullanıcı yetkisiz aksiyonu deneyip backend-reddi beklemez; kilitli alanı görür + nasıl açacağını öğrenir (Guard Policies). Deny-by-default = güvenlik-bilinçli (pessimistic loading).
- **Kanıt:** `npm run lint` 0 · `vitest` **132 pass/1 skip** (+8: 4 logic + 4 gate/App) · React e2e **10 pass** (a11y deterministik FE-019 fix sonrası) · web e2e **5 pass** · `vite build` OK · size cockpit **115.03KB/140** (+0.65KB zero-dep).
- **Açık iz (tracked):** **Backend backlog** — `/api/health` veya yeni `/api/session/me`'ye tenant `tier`/`plan.allowed_tiers` ekle → o zaman tier-gating (host/privileged) eklenir. `keys` (host-vault) gate'siz (permissions{} alanı yok). Derin component renk-sweep hâlâ açık.
- **Sonraki (önceden hesaplandı):** **vF12 Billing & Usage UX** — `/api/saas/self/usage` (tenant scope) + `/api/billing/{portal,checkout,preview}` tüketen usage/fatura paneli. İlk adım: `useUsage` hook (`api.get /api/saas/self/usage` → quota/used/period) + `UsagePanel` (pure-SVG usage-bar + quota %), SaaS tab altına; Stripe portal/checkout linki (yeni dep yok).

---

## Faz vF12 — Billing & Usage UX (tenant self-service) (DONE) · 🏁 12-VERSİYON ROADMAP TAMAMLANDI
- **Ne:** Backend tenant usage/quota + Stripe billing endpoint'lerinin cockpit yüzeyi yoktu. vF12 tenant-facing panel: kota-metre (WAI-ARIA `meter`) + aylık çağrı trendi (Sparkline) + Stripe portal/checkout (redirect). 401 (key yok) ve 501 (Stripe yok) zarif state.
- **Nasıl:**
  - **Saf logic** (`src/lib/usage.ts`, DOM'suz→testli): `usageRatio` (quota≤0→0 sınırsız, clamp01, NaN-guard) + `usageStatus` (<0.75 ok/<1 warn/≥1 over) + `usagePercent` + `seriesToCalls` (defansif non-array→[]).
  - **Hook** (`useUsage.ts`): `api.get /api/saas/self/usage` (Bearer apiKey) + best-effort `/api/saas/usage/timeseries`; durum `loading|ok|unauthorized(401/403)|error`; 401=first-class state (hata değil); unmount-guard.
  - **UsageMeter** (`role="meter"` + `aria-valuenow/min/max/valuetext`, adopt WAI-ARIA meter deseni zero-dep; quota=quantity→meter, progressbar değil) status-renk (emerald/amber/rose).
  - **UsagePanel** (theme-aware): loading→Skeleton, 401→connect-key kartı, ok→plan/period + UsageMeter + used/quota + Sparkline(series.calls). **Billing**: Manage billing/Upgrade → `api.post /api/billing/{portal,checkout}` → `{url}`→`window.location.assign` / no-url|501→notConfigured notu (graceful, Stripe SDK YOK). i18n en/tr ~15 key. App `saas` tab'ında SaaSAdmin ÜSTÜNE (tenant-Bearer vs admin-token bağımsız).
- **Niçin:** Tenant kotasını/faturasını cockpit'ten görür+yönetir; sovereign (redirect-url, SDK yok); 401/501 dürüst state (kör hata değil).
- **Kanıt:** `npm run lint` 0 · `vitest` **139 pass/1 skip** (+7: 4 logic + 3 render) · React e2e **10 pass** (a11y SaaS UsagePanel WCAG AA temiz, 2 koşu flake-yok) · web e2e **5 pass** · `vite build` OK · size cockpit **116.32KB/140** (+1.29KB zero-dep).
- **Açık iz (tracked):** Billing redirect gerçek Stripe gerektirir (yoksa notConfigured dry-run). `/api/billing/preview` adminGuard→tenant panelinde yok. **vF13 (derin component theme-sweep) en yüksek-değer açık-iz**: 13 component hardcoded `bg-[#08090d]`/`text-slate-*` → vF9 theming'i dürüstçe tamamlar.
- **Sonraki (önceden hesaplandı):** **vF13 Derin Component Theme-Sweep** — 13 component'in (TelemetryCockpit, SelfTestGates, demo wizard, status bar, badge'ler) hardcoded renklerini token-utility'ye (`bg-immersive-*`, `text-immersive-*`) migrate; axe `color-contrast` kuralını gate'e geri al (vF6'da çıkarılmıştı). İlk adım: en çok hardcoded-renk içeren TelemetryCockpit.tsx'i token'a çevir + `color-contrast`-only axe spot-test; sonra component-component sweep + kapıya `color-contrast` ekle.

---

## Faz vF13 — Deep Component Theme-Sweep (light/dark her yerde) (DONE)
- **Ne:** vF9 light/dark yalnız App shell'e uygulanmıştı; 22 component dark-hardcoded → light tema yarı-bozuk. vF13 ~495 yapısal-nötr sınıfı **semantik token utility**'ye migrate etti + axe `color-contrast` kuralını (vF6'dan beri kapalı) gate'e geri aldı. Light tema artık gerçekten çalışır; dark WCAG AA contrast kapı-altında.
- **Nasıl:**
  - **Token genişletme (semantik COLLAPSE, sprawl yok):** +2 token (`bg.inset` koyu-oturmuş yüzey, `border.strong` white/10) + `@theme` 2 mapping. 11 slate seviyesi 3 mevcut rol'e toplandı (100/200→bright, 300/400/450→muted, 500-800→dim); `bg-black/*`→inset, hex→bg/sidebar/panel. style-dictionary regen.
  - **Deterministik codemod** (ephemeral `/tmp/theme-codemod.mjs`, commit DIŞI): sıralı regex (`(?!\d)` prefix-collision-guard, prefix `hover:`/`md:` korunur), tüm `src/components/**/*.tsx`+`App.tsx` → 487+8 değişim/16 dosya. Status renkleri (indigo/emerald/rose/amber/cyan 324) DOKUNULMADI.
  - **Contrast tuning (token tek-kaynak):** `text-dim` dark `#64748b`→`#97a4b8` (white-overlay bg'lerde L≈.02'de ≥4.5), light `#94a3b8`→`#586477` (beyazda AA). Sadece token değişti, component değil.
  - **axe gate:** `a11y.spec` `disableRules(['color-contrast'])` KALDIRILDI; **`test.use({colorScheme:'dark'})`** (canonical dark tema taranır — headless chromium light-default'u yerine) + scan-öncesi `document.fonts.ready`+200ms settle (FE-021).
- **Niçin:** Light tema yarı-bozuktu (paneller dark-sabit); semantik token = matematiksel collapse (495 hardcode→~12 utility, sprawl yok); dark contrast borcu kapandı.
- **Kanıt:** `npm run lint` 0 · `vitest` **139 pass/1 skip** (sınıf-değişimi role/metin-testlerini etkilemedi) · React e2e **10 pass × 3 ardışık** (a11y `color-contrast` AÇIK, 4 tab) · web e2e **5 pass** · `vite build` OK · size cockpit **116.22KB/140** (CSS 7.38KB↓, arbitrary-value azaldı).
- **Açık iz (tracked):** **Light-tema STATUS renkleri** (text-emerald/cyan/amber/indigo açık-bg'de düşük-kontrast) AA değil → ayrı light-status-paleti gerek = **vF14 design-system v2** (axe canonical-dark taradı, light-status ertelendi, gizlenmedi). 2 dekoratif residual bırakıldı (logo `border-white/90`, demo ping-dot `bg-slate-500`).
- **Sonraki (önceden hesaplandı):** **vF14 Design-System v2 (light-status palette + tenant-tier gating)** — status renklerine `[data-theme=light]` koyulaştırılmış varyant (emerald/amber/rose/cyan/indigo light-AA) + a11y'yi her iki temada tara (colorScheme matrix). İlk adım: status renklerini semantik token'a çek (`--color-status-ok/warn/err/info/accent`, dark+light) + axe spec'i `['dark','light']` parametrize.

---

## Hata Sicili (root cause → önleme kuralı)

> Koda başlamadan ÖNCE oku. Aynı hatayı tekrar = ihlal (FRONTEND_AGENTS.md §6).

| # | Tarih | Hata | Root Cause | Fix | Önleme Kuralı |
|---|-------|------|-----------|-----|---------------|
| FE-000 | 2026-06-19 | — | — | — | (şablon satırı) |
| FE-001 | 2026-06-19 | Smoke test crash: `logs.filter / .map is not a function` | Mount-fetch mock'u status-ok ama **yanlış şekil** (`{}`) döndü; component array bekliyordu | Endpoint başına array route (`/api/security/log:[]`, `/api/models/:[]`) | Fetch-on-mount component'i mock'larken yanıtın **şeklini** (array vs object) ver, sadece 200-ok yetmez |
| FE-002 | 2026-06-19 | Anchor metni bulunamadı (ClusterManager/ReactAgentTab) | Başlık bir **gate/koşullu render** arkasındaydı (consent ekranı / conditional `<h3>`) | Anchor'ı gerçek default render state'inden seç (consent text, `Select Agent Provider`) | Assert öncesi component'in early-return/guard'larını oku; ilk görünen ekranın metnini hedefle |
| FE-003 | 2026-06-19 | Effect throw: `scrollIntoView is not a function` | jsdom layout API'lerini implemente etmiyor | `tests/ui/setup.ts`'e `Element.prototype.scrollIntoView` stub | Browser-only API'leri (scrollIntoView/matchMedia/ResizeObserver/EventSource) setup'ta proaktif stub'la |
| FE-004 | 2026-06-19 | Sync daemon ana dizinde branch flip + package.json/.gitignore revert | Ana repo dizini eşzamanlı daemon + diğer lane'ler tarafından sürülüyor (E-003) | Frontend işi izole worktree `~/Desktop/ollamas-frontend-wt`'ye taşındı | Multi-lane repo'da kod fazı = İZOLE WORKTREE şart (CLI/scripts lane gibi); ana dizinde çalışma |
| FE-005 | 2026-06-19 | `playwright test` → browser executable yok / `__dirlock` | Başka proje (ecypro wt) Wed03AM'den TAKILI `playwright install` lock'u tutuyordu; ayrıca PW 1.61 chromium-1228 ister (cache 1217) | Hung PID kill + stale `__dirlock` rm + `playwright install chromium` | Browser install takılırsa `ps` ile hung install ara + stale `~/Library/Caches/ms-playwright/__dirlock` temizle |
| FE-006 | 2026-06-19 | agent-chat: input `disabled`, fill timeout | GET `/api/agent/sessions` stub'u obje döndü, component array bekliyordu → `isLoading` takıldı → input disabled | `page.route` handler'ı `request().method()` ile GET→`[]` / POST→`{id}` ayır | Route-stub'ı HTTP method'a göre şekillendir (aynı path GET liste / POST tekil obje) |
| FE-007 | 2026-06-19 | apiClient testlerinde fetch call sayıları şişti + başka test'in URL'i sızdı | `setup.ts` `globalThis.fetch = vi.fn()` DOĞRUDAN atıyor; `vi.spyOn` aynı fn'i sarıp call history'i testler arası biriktiriyor | Her test `vi.stubGlobal('fetch', vi.fn())` + `afterEach vi.unstubAllGlobals()` | Paylaşılan global'i spy'lama; testte fetch izole etmek için **stubGlobal + fresh vi.fn**, spyOn değil |
| FE-008 | 2026-06-19 | `.test.ts` (JSX'siz) jsdom test hiç çalışmadı | jsdom project glob yalnız `*.test.tsx`; node project `tests/ui/**` exclude → `.ts` hiçbir yere düşmedi | jsdom include `tests/ui/**/*.test.{ts,tsx}` | Frontend test glob'u hem `.ts` hem `.tsx` kapsamalı (lib testleri JSX içermez) |
| FE-009 | 2026-06-19 | `logClientEvent` test fetch spy'ını kirletti + queued mock'ları tüketti | jsdom `navigator.sendBeacon` yok → fallback `fetch('/api/logbook')` aynı spy'a düştü | `setup.ts`'e `navigator.sendBeacon` no-op stub | Observability fallback'ı (sendBeacon→fetch) testte spy kirletir; sendBeacon'ı stub'la |
| FE-010 | 2026-06-20 | KeyVault'ta 4 raw `fetch` vF3 choke-point migration'ından kaçtı | vF3 migration manuel 10-dosya listeyle yapıldı; KeyVault listede yoktu (sessiz eksik) | eslint `no-restricted-globals` ban KeyVault'u yakaladı → `api.*`'e migrate | Toplu migration'ı **manuel liste** ile değil **mekanik kural** (eslint ban) ile bitir; ban = kaçak kanıtı |
| FE-011 | 2026-06-20 | `@axe-core/playwright` install ERESOLVE ile patladı | `@eslint/js@10` (kullanılmıyordu) peer eslint@10 ister, kurulu eslint@9 ile çakıştı | Kullanılmayan `@eslint/js` kaldırıldı | eslint flat-config'de import EDİLMEYEN paketi (`@eslint/js`) kurma; sürüm-pin uyumu (eslint↔@eslint/js major eşit) |
| FE-012 | 2026-06-20 | axe runtime'da button-name/select-name/label buldu; eslint-jsx-a11y bulmadı | Statik jsx-a11y icon-only buton (text yok) + placeholder-only input'u flag'lemez; axe runtime DOM'da yakalar | Icon buton+input'lara `aria-label`; her ikisi koş | Statik a11y lint ≠ runtime axe; **ikisi de** gerek (lint=hızlı/yapısal, axe=hesaplı isim/kontrast) |
| FE-013 | 2026-06-20 | a11y/keyboard e2e Files tab 30s timeout | `/api/workspace/tree` gerçek FS-scan paralel 4-worker yükünde takıldı (ana dizin büyük) | a11y/keyboard spec'e `**/api/workspace/**` route-stub | A11y/keyboard e2e gerçek-backend varyansından arındır; ağır endpoint'leri stub'la (deterministik tarama) |
| FE-014 | 2026-06-20 | Multi-page sonrası size-limit cockpit bütçesi landing'i de sayacaktı | Vite multi-page input-key'e göre chunk'ı yeniden adlandırır (`index-*`→`app-*`); glob `dist/assets/*.js` landing+app karıştırır | size-limit'i entry-spesifik glob'a böl (`app-*.js`/`landing-*.js`/`embed.js`) | Multi-page'de chunk adı=input-key; bütçeyi entry başına ayır, `*.js` toptan glob conflate eder |
| FE-015 | 2026-06-20 | Vanilla landing dev server'da (npm run dev) servis edilmiyor | Dev server Express (`tsx server.ts`) SPA-only; Vite multi-page yalnız `vite build`'i etkiler | Static alt-lane e2e `vite preview` (built dist) + `serviceWorkers:'block'` | Vanilla/static lane'i dev-server değil `vite preview` ile e2e; SPA SW'sini block'la (fetch intercept determinizmi) |
| FE-016 | 2026-06-20 | streamPost mid-stream reconnect LLM yanıtını çoğaltır | LLM generation stateless-resume edilemez; kör retry tüm üretimi baştan yapar (duplicate text) | `delivered` guard — yalnız connect-faz (chunk öncesi) retry; sonra `onError` | Stream retry SADECE ilk chunk'tan önce; akış başladıysa drop=error, resume etme |
| FE-017 | 2026-06-20 | ReactAgentTab stream unmount sonrası setState (leak/uyarı) | Stream component'ten uzun yaşıyordu; abort/cleanup yoktu | `abortRef`+`mountedRef`+unmount-abort + finally guard | Abortable stream consumer'ı unmount'ta abort + state-set'i mounted/aborted guard'la (Pipeline deseni) |
| FE-018 | 2026-06-20 | "chunk-sonra-drop" testi yanlış kuruldu (chunk teslim edilmeden error) | `ReadableStream.start()` enqueue-sonra-error sıradaki chunk'ı okutmadan drop eder | Pull-based stream: 1. pull enqueue, 2. pull error | Streaming-then-drop simülasyonu `pull()` ile (start()+error chunk'ı yutar) |
| FE-019 | 2026-06-20 | a11y "Cockpit Dashboard" e2e flaky (1. koşu fail, re-run pass) | vF10 ObservabilityPanel canlı `/api/logbook` fetch'i 8-worker paralel yükte yarı-render; axe async-region'ı tarıyor | a11y spec beforeEach'e `**/api/logbook**` route-stub (boş entries) | Yeni async-fetch'li panel a11y/gate testine girdiğinde endpoint'ini STUB'la (FE-013 ailesi); axe yarı-yüklü DOM taramasın, retry-ile-geçme yasak |
| FE-020 | 2026-06-20 | color-contrast AÇ → 4 tab fail; suçlu sanılan nötr DEĞİL, **status renkleri** (emerald/cyan/amber light-bg'de) | headless chromium `prefers-color-scheme: light` default → no-flash light tema seçti → axe LIGHT taradı; status renkleri light-bg'de AA değil ("theme-agnostik" varsayımı yanlış) | axe scan'i canonical **dark** tema'ya sabitle (`test.use({colorScheme:'dark'})`); light-status-paleti vF14'e ertele (tracked) | Status/accent renkleri theme-agnostik DEĞİL; light tema status-contrast ayrı palet işi. a11y-gate'i hangi temada taradığını bil (headless default=light) |
| FE-021 | 2026-06-20 | full-suite paralel yükte Cockpit a11y flaky (standalone pass) | color-contrast scan yarı-painted DOM'u (font-swap/async-panel) ölçüyor | scan-öncesi `document.fonts.ready` + 200ms settle | Contrast/visual axe scan'inden ÖNCE font+async yerleşsin (`fonts.ready`+settle); paralel-yük varyansını kök-nedenden çöz, retry değil |

### Devralınan gotcha (eklenen)
- **Semgrep pre-commit hook backend bulguları:** Commit'te repo-geneli Semgrep 17 bulgu listeledi (server.ts HTTP-fetch/GCM-tag, server/*.ts path-traversal/child_process, deploy/k8s privilege-escalation, docker-compose). **Hepsi backend** — frontend diff'te 0 bulgu, Scope Law dışı. Commit yine de geçti (hook bloke etmiyor). Frontend lane düzeltmez; backend lane backlog'u.
- **mcp-gateway.e2e flaky:** self-boot eden server e2e cold-run'da `ECONNRESET` ile 12 fail verdi, re-run'da 73/1 yeşil. Benim değişikliğim değil — timing/port. UI testleri ayrı projede izole, etkilenmez. Backend lane'e backlog: e2e boot retry.
- **Multi-tab working tree:** repo'da eşzamanlı lane'ler (scripts/backend) var; `vitest.config.ts` + `package.json` co-owned. Commit = SADECE selective `git add` (kendi dosyaların), asla `git add -A`.

### Devralınan gotcha'lar (ollamas geneli — frontend için geçerli)
- **HMR:** `vite.config.ts` HMR `DISABLE_HMR` env ile kapanabilir; test/CI'da HMR kapalı koş.
- **CSP:** `server.ts` Helmet CSP uyumluluk için kapalı; PWA/service-worker eklerken CSP'yi backend'de AÇMA (Scope Law) — gerekirse backend lane'e backlog.
- **Bundle baz:** JS 477KB / CSS 45KB — vF3 bütçesi bu bazdan ölçülür; regresyon = kapı kırmızı.
- **macOS BSD shell:** benchmark scriptlerinde `sed -i ''`, `date -v`; `timeout` yok (watchdog deseni) — bkz `bin/host-bridge/MACOS_BASH_GUIDE.md`.
