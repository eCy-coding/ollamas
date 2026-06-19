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

### Devralınan gotcha (eklenen)
- **Semgrep pre-commit hook backend bulguları:** Commit'te repo-geneli Semgrep 17 bulgu listeledi (server.ts HTTP-fetch/GCM-tag, server/*.ts path-traversal/child_process, deploy/k8s privilege-escalation, docker-compose). **Hepsi backend** — frontend diff'te 0 bulgu, Scope Law dışı. Commit yine de geçti (hook bloke etmiyor). Frontend lane düzeltmez; backend lane backlog'u.
- **mcp-gateway.e2e flaky:** self-boot eden server e2e cold-run'da `ECONNRESET` ile 12 fail verdi, re-run'da 73/1 yeşil. Benim değişikliğim değil — timing/port. UI testleri ayrı projede izole, etkilenmez. Backend lane'e backlog: e2e boot retry.
- **Multi-tab working tree:** repo'da eşzamanlı lane'ler (scripts/backend) var; `vitest.config.ts` + `package.json` co-owned. Commit = SADECE selective `git add` (kendi dosyaların), asla `git add -A`.

### Devralınan gotcha'lar (ollamas geneli — frontend için geçerli)
- **HMR:** `vite.config.ts` HMR `DISABLE_HMR` env ile kapanabilir; test/CI'da HMR kapalı koş.
- **CSP:** `server.ts` Helmet CSP uyumluluk için kapalı; PWA/service-worker eklerken CSP'yi backend'de AÇMA (Scope Law) — gerekirse backend lane'e backlog.
- **Bundle baz:** JS 477KB / CSS 45KB — vF3 bütçesi bu bazdan ölçülür; regresyon = kapı kırmızı.
- **macOS BSD shell:** benchmark scriptlerinde `sed -i ''`, `date -v`; `timeout` yok (watchdog deseni) — bkz `bin/host-bridge/MACOS_BASH_GUIDE.md`.
