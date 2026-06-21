import { test, expect } from '@playwright/test';

// Fully offline + deterministic: every backend call the ReAct chat makes is
// route-stubbed, so this never touches a real LLM / ollama. The chat reads a
// streamed body via response.body.getReader(); each event is `data: {json}\n\n`
// and type:"message" with `text` becomes the assistant reply.
test.describe('agent chat flow (mocked)', () => {
  test('sends a prompt and renders the streamed assistant reply', async ({ page }) => {
    await page.route('**/api/models/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '["mock-model"]' }),
    );
    await page.route('**/api/agent/sessions', (route) => {
      // GET (mount) expects an array of sessions; POST (auto-create) expects one session object.
      const body = route.request().method() === 'POST' ? { id: 'e2e-session', messages: [] } : [];
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/agent/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"message","text":"E2E mock reply confirmed"}\n\n',
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /ReAct Specialist/i }).click();

    // greeting proves the tab mounted
    await expect(page.getByText(/I am your ReAct specialist agent/i)).toBeVisible();

    await page.getByPlaceholder(/Inject a prompt/i).fill('e2e ping');
    await page.getByRole('button', { name: /EXECUTE/i }).click();

    await expect(page.getByText(/E2E mock reply confirmed/i)).toBeVisible();
  });
});
