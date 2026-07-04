import { defineConfig, devices } from '@playwright/test';

// Frontend lane (vF2) e2e harness. Isolated from Vitest: e2e files are *.spec.ts
// under tests/e2e; Vitest only globs *.test.{ts,tsx}. Boots the real app on a
// dedicated port so it never collides with a dev server on 3000. 3100 is NOT
// safe on this machine: ~/Desktop/ecysearch listens on 127.0.0.1:3100 long-term
// and reuseExistingServer adopts whatever answers on the port → every spec ran
// against the wrong app (19 red, snapshot rendered "ecysearch", not ollamas).
const PORT = Number(process.env.E2E_PORT) || 3170;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${PORT} npm run dev`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
