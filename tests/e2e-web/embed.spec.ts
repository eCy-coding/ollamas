import { expect, test } from '@playwright/test';

// vF7 — embeddable widget: mounts in a Shadow DOM on a plain host page and streams
// a reply from POST /api/generate (SSE), fully offline/route-stubbed here.
test.describe('embed chat widget', () => {
  test('opens from the bubble and streams an assistant reply', async ({ page }) => {
    await page.route('**/api/generate', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"chunk":"Hello "}\n\ndata: {"chunk":"from ollamas"}\n\ndata: {"done":true}\n\n',
      }),
    );
    await page.goto('/web/embed-demo.html');

    // the widget lives in a shadow root on a host element
    const widget = page.locator('[data-ollamas-embed]');
    await expect(widget).toBeAttached();

    // open via the bubble, type, send
    await widget.getByRole('button', { name: /Open ollamas chat/i }).click();
    await widget.getByRole('textbox', { name: /Message/i }).fill('hi');
    await widget.getByRole('button', { name: /^Send$/ }).click();

    // streamed frames accumulate into one bot message
    await expect(widget.getByText(/Hello from ollamas/i)).toBeVisible();
  });

  test('shows an error when the gateway is unreachable', async ({ page }) => {
    await page.route('**/api/generate', (route) => route.fulfill({ status: 502, body: '{}' }));
    await page.goto('/web/embed-demo.html');
    const widget = page.locator('[data-ollamas-embed]');
    await widget.getByRole('button', { name: /Open ollamas chat/i }).click();
    await widget.getByRole('textbox', { name: /Message/i }).fill('hi');
    await widget.getByRole('button', { name: /^Send$/ }).click();
    await expect(widget.getByText(/Could not reach the model/i)).toBeVisible();
  });
});
