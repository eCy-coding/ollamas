---
description: Playwright browser e2e — cockpit (tests/e2e) + web (tests/e2e-web) + a11y (axe), chromium
allowed-tools: Bash(npx playwright:*), Bash(npm run test:e2e:*), Bash(npm run test:e2e)
---

Projenin Playwright e2e suite'ini chromium'da koş. Playwright kendi webServer'ını (:3100 / vite-preview) otomatik açar — mevcut :8090/:3000'e dokunmaz.

1. Browser hazır mı: `ls ~/Library/Caches/ms-playwright` boşsa `npx playwright install chromium` (ilk sefer).
2. Cockpit e2e: `npm run test:e2e` (tests/e2e: smoke/a11y/saas, config :3100).
3. Web e2e: `npm run test:e2e:web` (tests/e2e-web: landing/embed, vite-preview).
4. Tek spec/debug: `npx playwright test tests/e2e/smoke.spec.ts --reporter=list`.

Çıktı: spec-başı pass/fail tablosu + fail varsa hata + ekran-görüntüsü yolu (test-results/). a11y (axe) ihlalleri ayrı listele.

Kural: read-only test (suite frontend'i değiştirmez). RAM baskısında webServer yavaş olabilir — timeout artır. Evidence-first: gerçek playwright çıktısı. CI'da `security.yml`/ayrı workflow'a eklenebilir.
