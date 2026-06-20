# Frontend Adoption Catalog — ollamas Frontend Lane

> En çok yıldız alan, güvenilir, **macOS + iOS Safari'de çalışan**, projemizle eşleşen
> tamamlanmış açık-kaynak repo'lar. Kural (FRONTEND_AGENTS.md §11): **çalışan kodu** adopte
> et, vibe-coding yeni mimari icat etme. MIT/Apache → kod kopyala (attribution); lisanssız
> → yalnız fikir. Her giriş bir roadmap versiyonuna (vF) bağlı.

## Adopte edilenler

| Repo | Lisans | vF | Ne için | Durum |
|------|--------|----|---------|-------|
| `GoogleChrome/web-vitals` | Apache-2.0 | vF3 | LCP/INP/CLS/FCP/TTFB field metrics → `/api/logbook` (MacBook + iOS Safari) | ✅ `src/lib/vitals.ts` |
| `GoogleChrome/lighthouse-ci` (`@lhci/cli`) | Apache-2.0 | vF3 | `budget.json` perf bütçesi + PR gate | ✅ `lighthouserc.json` + CI |
| `ai/size-limit` (+`@size-limit/file`) | MIT | vF3 | Bundle bütçesi (gzip/brotli), CI fail-on-regress | ✅ `.size-limit.json` |
| `vite-pwa/vite-plugin-pwa` (+Workbox 7) | MIT | vF4 | Zero-config PWA, SW, offline shell, iOS web-clip | ✅ `vite.config.ts` |
| `amzn/style-dictionary` | Apache-2.0 | vF5 | JSON token → CSS var → Tailwind v4 `@theme` | ✅ `tokens/` + config |
| `dequelabs/axe-core` (`@axe-core/playwright`) | MPL-2.0 | vF6 | WCAG AA otomatik tarama (4 tab, 0 critical/serious) | ✅ `tests/e2e/a11y.spec.ts` |
| `jsx-eslint/eslint-plugin-jsx-a11y` | MIT | vF6 | Statik JSX a11y lint (flat-config) | ✅ `eslint.config.js` |
| `jsx-eslint/eslint-plugin-react-hooks` + `typescript-eslint` | MIT | vF6 | Flat-config temel (rules-of-hooks + TSX parser) | ✅ `eslint.config.js` |
| `lesichkovm/chatui` + `deftio/quikchat` (desen) | fikir-level | vF7 | Zero-dep **Shadow-DOM** kapsülleme + `getReader()` SSE okuma deseni — kod kopyalanmadı, reimplement | ✅ `public/embed.js` |
| `bvaughn/react-error-boundary` | MIT | vF8 | `<ErrorBoundary>` + `FallbackComponent` + `onError`→`logClientEvent`→/api/logbook | ✅ `src/main.tsx` + `ErrorFallback.tsx` |
| `lingui/js-lingui` (`@lingui/core`+`@lingui/react` v6) | MIT | vF9 | **Runtime** TR/EN i18n (macro/vite-plugin YOK = build riski sıfır); ölçülen en küçük bundle (vs i18next ~22KB / react-intl ~13KB); `i18n.load/activate` + `useLingui()._` + `<I18nProvider>` | ✅ `src/lib/i18n.ts` + `src/locales/{en,tr}.ts` + `LanguageToggle.tsx` |
| `[data-theme]` + CSS-var + no-flash (standart desen) | — (pattern) | vF9 | Tailwind v4 token-flip; `<head>` inline FOUC-guard script; component'ler theme-agnostik (`dark:` prefix yok) | ✅ `src/lib/theme.tsx` + `tokens-light/` + `index.html` + `ThemeToggle.tsx` |
| `fnando/sparkline` (desen) | MIT | vF10 | Zero-dep SVG `<polyline>` sparkline deseni (normalize→points) — kod kopyalanmadı, reimplement; `stroke=currentColor`→theme-aware; 0 bundle. RUM lib'leri (baselime/react-rum, aws-rum-web) REDDEDİLDİ (ağır+harici, sovereign ihlali) | ✅ `src/components/Sparkline.tsx` |
| `rbac-ui` **AccessGate deseni** | desen (zero-dep) | vF11 | Declarative capability gate (`<CapabilityGate need fallback>` + `useCapability`, deny-by-default/pessimistic) — kod kopyalanmadı, reimplement. `@rbac-ui/react`/`@casl/react`/`ra-rbac` REDDEDİLDİ (dep + role/claim modeli yok, bizde boolean permission map) | ✅ `src/components/CapabilityGate.tsx` + `src/lib/capabilities.ts` |
| WAI-ARIA **`meter` rolü** deseni (react-aria `useMeter` fikri) | desen (zero-dep) | vF12 | Erişilebilir kota-metre (`role="meter"`+`aria-valuenow/min/max/valuetext`) — quota=quantity→meter (progressbar değil). `react-circular-progressbar`/`@react-aria/meter`/Stripe-SDK REDDEDİLDİ (dep; billing `{url}` redirect→`window.location` yeter) | ✅ `src/components/UsageMeter.tsx` + `UsagePanel.tsx` |

## Backend backlog (bu lane çözemez — Scope Law)
- **Tenant tier expose**: `/api/health` veya yeni `/api/session/me` per-session `tier`/`plan.allowed_tiers` döndürmeli → frontend tier-gating (host/privileged görünürlük) ancak o zaman eklenir. vF11 yalnız `permissions{}` üzerinden gate eder.

## Sıradaki adopsiyonlar (planlı)

| Repo | Lisans | vF | Ne için |
|------|--------|----|---------|
| (vF13) `dequelabs/axe-core` `color-contrast` (mevcut, MPL-2.0) | MPL-2.0 | vF13 | Derin component theme-sweep — 13 component hardcoded renk→token; `color-contrast` kuralını axe gate'ine geri al (vF6'da çıkarılmıştı) |

## Notlar
- **iOS uyumluluğu** her adopsiyonun ön-koşulu: Safari/web-clip'te çalışmayan kütüphane alınmaz.
- **Perf bütçesi** (vF3) her yeni bağımlılığı kapılar: bundle artışı `npm run size`'ı kırarsa reddedilir.
- web-vitals ayrı chunk'a split olur (+2.6KB gz) — kritik bundle'ı şişirmez.
