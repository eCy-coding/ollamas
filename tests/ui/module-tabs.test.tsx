// O0 Faz 4 (02-o0-foundation.md §3 FAZ 4, RED 3-5) — the frontend module-tab
// choke-point. GET /api/modules drives sidebar tabs: visible when enabled,
// hidden when the list is empty, silently absent on a fetch error (honest-empty,
// capabilities.ts deny-by-default parity), and AND-gated by requiresCap.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import App from '../../src/App';
import { renderUI } from './helpers';

const HEALTH = {
  mode: 'live',
  isLive: true,
  os: { platform: 'darwin', release: '24.6.0', arch: 'arm64', uptime: 1 },
  metrics: { cpuLoad1Min: 0.5, memory: { total: 16, free: 8, percentageUsed: 50 } },
  workspacePath: '/tmp',
  permissions: { fileRead: true, fileWrite: true, commandExec: true, git: true },
  hasBackupEnabled: false,
};

// Route-map fetch mock that can return a NON-ok status for a chosen path (the
// shared helper always returns 200, but this suite needs a 403/500 case).
function routeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const key = Object.keys(routes).find((k) => url.includes(k));
    const hit = key ? routes[key] : { status: 200, body: {} };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

let consoleErr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('module tabs (O0 /api/modules choke-point)', () => {
  it('renders a module tab when /api/modules lists it', async () => {
    routeFetch({
      '/api/health': { body: HEALTH },
      '/api/modules': { body: { modules: [{ id: 'demo', tab: { labelKey: 'Demo Module', icon: 'Box' } }] } },
    });
    renderUI(<App />);
    expect(await screen.findByRole('button', { name: /Demo Module/i })).toBeInTheDocument();
  });

  it('shows no module tab when the list is empty (toggle-off = hidden)', async () => {
    routeFetch({
      '/api/health': { body: HEALTH },
      '/api/modules': { body: { modules: [] } },
    });
    renderUI(<App />);
    // A known static tab proves the shell mounted before we assert absence.
    await screen.findByRole('button', { name: /Cockpit Dashboard/i });
    expect(screen.queryByRole('button', { name: /Demo Module/i })).not.toBeInTheDocument();
  });

  it('is honest-empty on a 403/fetch error — no tab, no console error', async () => {
    routeFetch({
      '/api/health': { body: HEALTH },
      '/api/modules': { status: 403, body: { error: 'forbidden' } },
    });
    renderUI(<App />);
    await screen.findByRole('button', { name: /Cockpit Dashboard/i });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Demo Module/i })).not.toBeInTheDocument(),
    );
    expect(consoleErr).not.toHaveBeenCalled();
  });

  it('AND-gates a module tab by requiresCap (denied capability → disabled)', async () => {
    routeFetch({
      // commandExec denied → a module tab that requires it must be disabled.
      '/api/health': { body: { ...HEALTH, permissions: { fileRead: true, fileWrite: true, commandExec: false, git: true } } },
      '/api/modules': { body: { modules: [{ id: 'termmod', tab: { labelKey: 'Terminal Module', icon: 'Box', requiresCap: 'commandExec' } }] } },
    });
    renderUI(<App />);
    const btn = await screen.findByRole('button', { name: /Terminal Module/i });
    expect(btn).toBeDisabled();
  });
});
