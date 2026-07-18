import { test, expect } from '@playwright/test';

// K4 (v18) — e2e coverage for the eCy chat/ecym surfaces (K2/K3 fixes):
//   (1) chat tab opens the message composer
//   (2) ecym tab renders its status card without crashing
//   (3) enabled module tabs (cookbook/research/documents) render + click through cleanly
//   (4) K2 proof: the "eCy" nav-rail section header sits above the chat tab
//
// Module tabs are env-gated (MODULE_COOKBOOK/RESEARCH/DOCUMENTS) and read at
// server boot from .env — this repo's .env enables all three for dev, but that's
// not guaranteed everywhere this spec runs. Case (3) checks the live /api/modules
// payload first and skips with a clear message instead of going false-red when
// modules are off.

const ERROR_BOUNDARY = /Something went wrong|Bir şeyler ters gitti|Uygulama çöktü/i;

test.describe('eCy surfaces (chat / ecym / module tabs)', () => {
  test('chat tab ("Chat (eCy)") opens the message composer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Chat \(eCy\)/i }).click();
    await expect(page.getByPlaceholder(/Message eCy/i)).toBeVisible();
    await expect(page.getByText(ERROR_BOUNDARY)).toHaveCount(0);
  });

  test('ecym tab ("eCy Studio") renders the status card without an error boundary', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /eCy Studio/i }).click();
    await expect(page.getByRole('heading', { name: /eCy Studio/i })).toBeVisible();
    await expect(page.getByText(ERROR_BOUNDARY)).toHaveCount(0);
  });

  test('nav groups chat under an "eCy" section header (K2)', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: /Primary/i });
    await expect(nav).toBeVisible();

    const chatButton = nav.getByRole('button', { name: /Chat \(eCy\)/i });
    const ecyHeader = nav.getByText(/^eCy$/);
    await expect(chatButton).toBeVisible();
    await expect(ecyHeader).toBeVisible();

    // Header must precede the chat button in DOM order (proves it's the group
    // label for chat/ecym, not an unrelated "eCy" occurrence elsewhere in the nav).
    const headerBox = await ecyHeader.boundingBox();
    const chatBox = await chatButton.boundingBox();
    expect(headerBox, 'eCy header did not render').not.toBeNull();
    expect(chatBox, 'chat button did not render').not.toBeNull();
    expect(headerBox!.y).toBeLessThan(chatBox!.y);
  });

  test('enabled module tabs (cookbook/research/documents) render and click through cleanly', async ({ page, request }) => {
    const res = await request.get('/api/modules');
    expect(res.ok(), `GET /api/modules returned ${res.status()}`).toBeTruthy();
    const { modules } = (await res.json()) as { modules: { id: string; tab?: { labelKey: string } }[] };

    const wanted: Record<string, RegExp> = {
      cookbook: /Cookbook/i,
      research: /Research/i,
      documents: /Documents/i,
    };
    const enabledIds = modules.map((m) => m.id).filter((id) => id in wanted);

    test.skip(
      enabledIds.length === 0,
      'no MODULE_COOKBOOK/RESEARCH/DOCUMENTS module enabled on this server — skipping module-tab assertions (see .env)',
    );

    // Ignore vite dev-server HMR websocket noise (see tests/e2e/panels.spec.ts) — a second
    // dev server on the machine can steal the HMR port, which is dev tooling, not app code.
    const isDevNoise = (s: string) => /WebSocket closed without opened|vite|__vite_hmr|24678/i.test(s);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => { const s = String(e); if (!isDevNoise(s)) pageErrors.push(s); });

    await page.goto('/');
    const nav = page.getByRole('navigation', { name: /Primary/i });

    for (const id of enabledIds) {
      const btn = nav.getByRole('button', { name: wanted[id] });
      await expect(btn, `module tab "${id}" not found in nav`).toBeVisible();
      await btn.click();
      await expect(nav, `nav vanished after clicking module tab "${id}"`).toBeVisible();
      await expect(page.getByText(ERROR_BOUNDARY), `error boundary shown on module tab "${id}"`).toHaveCount(0);
    }

    expect(pageErrors, `uncaught page errors while touring module tabs: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
