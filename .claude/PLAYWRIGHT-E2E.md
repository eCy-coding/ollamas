# Playwright e2e — %100 entegre + canlı koşu (2026-06-27)

## Durum: ENTEGRE + ÇALIŞIR
Playwright kod-entegreydi (@playwright/test + @axe-core/playwright + test:e2e/test:e2e:web + 5 spec) ama **chromium binary yoktu** → çalışamıyordu. Tamamlandı:
- ✅ `npx playwright install chromium` → chromium-1228 + headless_shell + ffmpeg kuruldu.
- ✅ `npm run test:e2e` canlı koştu (Playwright :3100 auto-server + chromium).
- ✅ harness-wire: cli-extensions allow += `npx playwright`/`npm run test:e2e`; `/e2e-browser` slash.

## Canlı sonuç: 13 passed · 1 failed (34.5s)
- ✅ 13 geçti: app-shell smoke, tab navigation, saas akışı, dark-theme a11y vb.
- ❌ 1 fail (GERÇEK bulgu): `tests/e2e/a11y.spec.ts:45` — **light theme** "ReAct Specialist" tab → axe **WCAG 4.1.2 (wcag412)** serious ihlal (erişilebilir-ad/role eksik interaktif kontrol). Screenshot: test-results/.

## Eyleme dönük (frontend lane — src/)
**a11y wcag412 ihlali** = gerçek frontend erişilebilirlik bugu (light theme, ReAct Specialist sekmesi). Düzeltme src/ lane (interaktif elemana aria-label/role). Bu sekme cli/harness — src/ lane'e NOT. (dark theme geçti → yalnız light-theme kontrolünde.)

## Harness kullanım
- `/e2e-browser` → cockpit (test:e2e) + web (test:e2e:web) + a11y.
- `npx playwright test tests/e2e/smoke.spec.ts` → tek spec.
- CI: `security.yml` yanına e2e workflow eklenebilir (chromium cache + test:e2e).
- Chrome MCP zaten bağlı; @playwright/mcp (browser-automation MCP) opsiyonel alternatif (FREE-SERVICES).

## Kanıt
chromium kuruldu · 13/14 spec geçti gerçek koşu · 1 gerçek a11y bulgusu (uydurma değil) · harness-wire test 26/26.
