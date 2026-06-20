import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// vF6 — automated WCAG 2.x AA gate (adopted: dequelabs/axe-core, MPL-2.0).
// Scans each main tab and blocks on critical/serious structural violations
// (missing labels, ARIA misuse, broken roles). `color-contrast` is disabled
// here: the dark cockpit theme has many low-contrast decorative texts that need
// a dedicated design pass — tracked in FRONTEND_SEYIR_DEFTERI, NOT silently hidden.
const TABS = ['Cockpit Dashboard', 'SaaS Gateway', 'ReAct Specialist', 'Files Explorer'];

// Files Explorer triggers a real filesystem walk via /api/workspace/tree which can
// stall under parallel load; stub it so the scan is deterministic and fast.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/workspace/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tree: [], mode: 'demo', workspaceRoot: '/mock' }),
    }),
  );
  // vF10 ObservabilityPanel (Cockpit Dashboard tab) fetches /api/logbook live;
  // stub it so the panel renders deterministically and axe never scans a
  // half-loaded async region under parallel load (FE-013 pattern).
  await page.route('**/api/logbook**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, total: 0, entries: [] }),
    }),
  );
});

for (const tab of TABS) {
  test(`a11y: "${tab}" has no critical/serious WCAG AA violations`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(tab, 'i') }).click();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const summary = blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    expect(blocking, `axe violations on ${tab}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
  });
}
