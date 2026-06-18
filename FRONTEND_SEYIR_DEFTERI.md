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
- **Sonraki (önceden hesaplandı):** **vF2 E2E Harness** — Playwright kurulumu (`@playwright/test`), çalışan app'e (port 3000) karşı kritik akış: agent-chat SSE + workspace tree + SaaS admin. İlk adım: `playwright.config.ts` + `tests/e2e/` + `webServer` ile `npm run dev` boot + smoke (sayfa açılır, Cockpit tab görünür). CI'da ayrı UI/e2e job (matrix redundancy'yi çöz).

---

## Hata Sicili (root cause → önleme kuralı)

> Koda başlamadan ÖNCE oku. Aynı hatayı tekrar = ihlal (FRONTEND_AGENTS.md §6).

| # | Tarih | Hata | Root Cause | Fix | Önleme Kuralı |
|---|-------|------|-----------|-----|---------------|
| FE-000 | 2026-06-19 | — | — | — | (şablon satırı) |
| FE-001 | 2026-06-19 | Smoke test crash: `logs.filter / .map is not a function` | Mount-fetch mock'u status-ok ama **yanlış şekil** (`{}`) döndü; component array bekliyordu | Endpoint başına array route (`/api/security/log:[]`, `/api/models/:[]`) | Fetch-on-mount component'i mock'larken yanıtın **şeklini** (array vs object) ver, sadece 200-ok yetmez |
| FE-002 | 2026-06-19 | Anchor metni bulunamadı (ClusterManager/ReactAgentTab) | Başlık bir **gate/koşullu render** arkasındaydı (consent ekranı / conditional `<h3>`) | Anchor'ı gerçek default render state'inden seç (consent text, `Select Agent Provider`) | Assert öncesi component'in early-return/guard'larını oku; ilk görünen ekranın metnini hedefle |
| FE-003 | 2026-06-19 | Effect throw: `scrollIntoView is not a function` | jsdom layout API'lerini implemente etmiyor | `tests/ui/setup.ts`'e `Element.prototype.scrollIntoView` stub | Browser-only API'leri (scrollIntoView/matchMedia/ResizeObserver/EventSource) setup'ta proaktif stub'la |

### Devralınan gotcha (eklenen)
- **mcp-gateway.e2e flaky:** self-boot eden server e2e cold-run'da `ECONNRESET` ile 12 fail verdi, re-run'da 73/1 yeşil. Benim değişikliğim değil — timing/port. UI testleri ayrı projede izole, etkilenmez. Backend lane'e backlog: e2e boot retry.
- **Multi-tab working tree:** repo'da eşzamanlı lane'ler (scripts/backend) var; `vitest.config.ts` + `package.json` co-owned. Commit = SADECE selective `git add` (kendi dosyaların), asla `git add -A`.

### Devralınan gotcha'lar (ollamas geneli — frontend için geçerli)
- **HMR:** `vite.config.ts` HMR `DISABLE_HMR` env ile kapanabilir; test/CI'da HMR kapalı koş.
- **CSP:** `server.ts` Helmet CSP uyumluluk için kapalı; PWA/service-worker eklerken CSP'yi backend'de AÇMA (Scope Law) — gerekirse backend lane'e backlog.
- **Bundle baz:** JS 477KB / CSS 45KB — vF3 bütçesi bu bazdan ölçülür; regresyon = kapı kırmızı.
- **macOS BSD shell:** benchmark scriptlerinde `sed -i ''`, `date -v`; `timeout` yok (watchdog deseni) — bkz `bin/host-bridge/MACOS_BASH_GUIDE.md`.
