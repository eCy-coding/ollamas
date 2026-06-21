import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderUI, mockFetch } from './helpers';
import { UsagePanel } from '../../src/components/UsagePanel';
import { activateLocale } from '../../src/lib/i18n';

describe('UsagePanel (vF12)', () => {
  beforeEach(() => activateLocale('en'));

  it('renders the quota meter, percent, plan and a usage trend', async () => {
    mockFetch({
      '/api/saas/self/usage': { tenantId: 't1', plan: 'pro', quota: 100, used: 80, period: '2026-06' },
      '/api/saas/usage/timeseries': { tenantId: 't1', series: [{ day: '2026-06-01', calls: 5, tokens: 1 }, { day: '2026-06-02', calls: 9, tokens: 2 }] },
    });
    renderUI(<UsagePanel />);

    const meter = await screen.findByRole('meter', { name: /Quota usage/i });
    expect(meter).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText(/pro/)).toBeInTheDocument();
    expect(document.querySelectorAll('svg[role="img"]').length).toBeGreaterThan(0); // sparkline
  });

  it('shows the connect-key state on 401 (no tenant key)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/saas/self/usage')) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      return new Response('{}', { status: 200 });
    });
    renderUI(<UsagePanel />);
    expect(await screen.findByText(/Connect a tenant API key/i)).toBeInTheDocument();
  });

  it('Manage billing POSTs to the portal and shows not-configured when no url', async () => {
    const spy = mockFetch({
      '/api/saas/self/usage': { tenantId: 't1', plan: 'free', quota: 50, used: 10, period: '2026-06' },
      '/api/saas/usage/timeseries': { tenantId: 't1', series: [] },
      '/api/billing/portal': {}, // no url → billing not configured (dry-run)
    });
    renderUI(<UsagePanel />);

    const btn = await screen.findByRole('button', { name: /Manage billing/i });
    await userEvent.click(btn);

    expect(
      spy.mock.calls.some(
        ([u, init]) => String(u).includes('/api/billing/portal') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
    expect(await screen.findByText(/Billing not configured/i)).toBeInTheDocument();
  });
});
