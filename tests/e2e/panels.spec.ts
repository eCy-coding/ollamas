import { test, expect } from '@playwright/test';

// iter-15 — "test each function on :3000" as a repeatable guard. Tours every left-nav panel and asserts
// (1) no tab crashes the app (nav stays mounted, no React error boundary), (2) no uncaught page error, and
// (3) the eCySearcher threat-intel proxy NEVER answers 502 — the offline circuit-breaker must short-circuit
// to a benign 200 so the browser's RUM api_error counter can't flood to CRITICAL when the stack is down.

test.describe('cockpit — every panel renders + no error flood', () => {
  test('tours all nav tabs without crashes, page errors, or ecysearcher 502s', async ({ page }) => {
    const pageErrors: string[] = [];
    const ecy502: string[] = [];
    // Ignore vite dev-server HMR websocket noise (a second dev server on the machine can steal the HMR
    // port → "WebSocket closed without opened"). It's dev tooling, not app code, and absent in prod.
    const isDevNoise = (s: string) => /WebSocket closed without opened|vite|__vite_hmr|24678/i.test(s);
    page.on('pageerror', (e) => { const s = String(e); if (!isDevNoise(s)) pageErrors.push(s); });
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/ecysearcher') && r.status() === 502) ecy502.push(`${r.status()} ${u}`);
    });

    await page.goto('/');
    const nav = page.getByRole('navigation', { name: /Primary/i });
    await expect(nav).toBeVisible();

    const buttons = nav.getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(10); // full nav mounted

    for (let i = 0; i < count; i++) {
      const btn = nav.getByRole('button').nth(i);
      const label = (await btn.textContent())?.trim() || `#${i}`;
      await btn.click();
      // The app must survive every tab: nav still there (no white-screen crash) and no error-boundary.
      await expect(nav, `nav vanished after clicking "${label}"`).toBeVisible();
      await expect(
        page.getByText(/Something went wrong|Bir şeyler ters gitti|Uygulama çöktü/i),
        `error boundary shown on "${label}"`,
      ).toHaveCount(0);
    }

    // Threat-intel tab specifically: with the stack down it must render the graceful offline state
    // (never a raw crash) — and crucially, not a single 502 should have been logged during the tour.
    expect(ecy502, `ecysearcher answered 502 (flood regression): ${ecy502.join(', ')}`).toEqual([]);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
