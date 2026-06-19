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
- **Kanıt:** `npm run lint` 0 · `vitest` **111 pass/1 skip** · React e2e **10 pass** · web e2e **5 pass** · `vite build` OK · size cockpit **109.18KB/140** (react-error-boundary +1.1KB) / embed 2.51KB. Commit: `<vF8 commit>`.
- **Sonraki (önceden hesaplandı):** **vF9 i18n + Theming** — `@lingui/core` (2kB MIT) TR/EN ICU + tema switch (light token seti, vF5 üzerine) + tercih kalıcılığı (localStorage). İlk adım: `[data-theme]` light/dark token override + `@lingui/core` setup + `<ThemeToggle>` + TR/EN ilk string extraction.

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

### Devralınan gotcha (eklenen)
- **Semgrep pre-commit hook backend bulguları:** Commit'te repo-geneli Semgrep 17 bulgu listeledi (server.ts HTTP-fetch/GCM-tag, server/*.ts path-traversal/child_process, deploy/k8s privilege-escalation, docker-compose). **Hepsi backend** — frontend diff'te 0 bulgu, Scope Law dışı. Commit yine de geçti (hook bloke etmiyor). Frontend lane düzeltmez; backend lane backlog'u.
- **mcp-gateway.e2e flaky:** self-boot eden server e2e cold-run'da `ECONNRESET` ile 12 fail verdi, re-run'da 73/1 yeşil. Benim değişikliğim değil — timing/port. UI testleri ayrı projede izole, etkilenmez. Backend lane'e backlog: e2e boot retry.
- **Multi-tab working tree:** repo'da eşzamanlı lane'ler (scripts/backend) var; `vitest.config.ts` + `package.json` co-owned. Commit = SADECE selective `git add` (kendi dosyaların), asla `git add -A`.

### Devralınan gotcha'lar (ollamas geneli — frontend için geçerli)
- **HMR:** `vite.config.ts` HMR `DISABLE_HMR` env ile kapanabilir; test/CI'da HMR kapalı koş.
- **CSP:** `server.ts` Helmet CSP uyumluluk için kapalı; PWA/service-worker eklerken CSP'yi backend'de AÇMA (Scope Law) — gerekirse backend lane'e backlog.
- **Bundle baz:** JS 477KB / CSS 45KB — vF3 bütçesi bu bazdan ölçülür; regresyon = kapı kırmızı.
- **macOS BSD shell:** benchmark scriptlerinde `sed -i ''`, `date -v`; `timeout` yok (watchdog deseni) — bkz `bin/host-bridge/MACOS_BASH_GUIDE.md`.
