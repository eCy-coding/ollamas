import { defineConfig, devices } from '@playwright/test';

// vF7 — vanilla alt-lane e2e. The landing/embed are static files, so we serve the
// BUILT dist via `vite preview` (the dev server is Express/tsx and is SPA-only).
// Separate from playwright.config.ts (React lane on :3100, npm run dev).
const PORT = Number(process.env.WEB_E2E_PORT) || 3101;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e-web',
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
    // Block the SPA service worker so static-lane assertions are deterministic.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build:client && npx vite preview --port ${PORT} --strictPort`,
    url: `${BASE_URL}/web/`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
