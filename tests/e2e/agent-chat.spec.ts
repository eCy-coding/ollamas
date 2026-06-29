import { test, expect, type Page } from '@playwright/test';

// Fully offline + deterministic: every backend call the ReAct chat makes is
// route-stubbed, so this never touches a real LLM / ollama. The chat reads a
// streamed body via response.body.getReader(); each event is `data: {json}\n\n`
// and type:"message" with `text` becomes the assistant reply.

// Stub the mount-time routes (models list + sessions) every test needs.
async function stubBase(page: Page) {
  await page.route('**/api/models/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '["mock-model"]' }),
  );
  await page.route('**/api/agent/sessions', (route) => {
    // GET (mount) expects an array; POST (auto-create) expects one session object.
    const body = route.request().method() === 'POST' ? { id: 'e2e-session', messages: [] } : [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Stub /api/agent/chat with a fixed SSE body (one or more `data: {…}\n\n` frames).
async function stubChat(page: Page, body: string) {
  await page.route('**/api/agent/chat', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body }),
  );
}

async function openTabAndSend(page: Page, prompt: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /ReAct Specialist/i }).click();
  await expect(page.getByText(/I am your ReAct specialist agent/i)).toBeVisible();
  await page.getByPlaceholder(/Inject a prompt/i).fill(prompt);
  await page.getByRole('button', { name: /EXECUTE/i }).click();
}

test.describe('agent chat flow (mocked)', () => {
  test('sends a prompt and renders the streamed assistant reply', async ({ page }) => {
    await stubBase(page);
    await stubChat(page, 'data: {"type":"message","text":"E2E mock reply confirmed"}\n\n');
    await openTabAndSend(page, 'e2e ping');
    await expect(page.getByText(/E2E mock reply confirmed/i)).toBeVisible();
  });

  test('renders a trace step and expands it to full detail', async ({ page }) => {
    await stubBase(page);
    await stubChat(
      page,
      'data: {"type":"step","stepNum":1,"tool":"read_file","ok":true,"latency":7,"args":{"path":"readme.md"},"result":"loaded"}\n\n' +
        'data: {"type":"message","text":"done reading","step":1}\n\n',
    );
    await openTabAndSend(page, 'read the readme');

    // The trace row exposes a unique "Expand step detail" control (the tool name itself
    // also appears in the static tools panel, so target the row's button instead).
    const expander = page.getByRole('button', { name: /Expand step detail/i });
    await expect(expander).toBeVisible();
    await expander.click();
    await expect(page.getByText(/readme\.md/).first()).toBeVisible();
  });

  test('retains assistant messages from different steps (no overwrite)', async ({ page }) => {
    await stubBase(page);
    await stubChat(
      page,
      'data: {"type":"message","text":"first step reply","step":1}\n\n' +
        'data: {"type":"message","text":"second step reply","step":3}\n\n',
    );
    await openTabAndSend(page, 'multi step');
    await expect(page.getByText('first step reply')).toBeVisible();
    await expect(page.getByText('second step reply')).toBeVisible();
  });

  test('shows the approval wizard for a write and POSTs on approve', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/agent/approve-write', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }),
    );
    await stubChat(
      page,
      'data: {"type":"step","stepNum":1,"tool":"write_file","ok":true,"latency":4,"args":{"path":"a.ts","content":"X"},"diff":"+X","applied":false}\n\n',
    );
    await openTabAndSend(page, 'write a file');

    const approve = page.getByRole('button', { name: /APPROVE WRITE/i });
    await expect(approve).toBeVisible();
    const reqP = page.waitForRequest('**/api/agent/approve-write');
    await approve.click();
    await reqP;
  });
});
