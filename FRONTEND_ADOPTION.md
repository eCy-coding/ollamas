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

## Sıradaki adopsiyonlar (planlı)

| Repo | Lisans | vF | Ne için |
|------|--------|----|---------|
| `lingui/js-lingui` (`@lingui/core`) | MIT | vF9 | 2kB compile-time i18n (TR/EN), dead-code elim |

## Notlar
- **iOS uyumluluğu** her adopsiyonun ön-koşulu: Safari/web-clip'te çalışmayan kütüphane alınmaz.
- **Perf bütçesi** (vF3) her yeni bağımlılığı kapılar: bundle artışı `npm run size`'ı kırarsa reddedilir.
- web-vitals ayrı chunk'a split olur (+2.6KB gz) — kritik bundle'ı şişirmez.
