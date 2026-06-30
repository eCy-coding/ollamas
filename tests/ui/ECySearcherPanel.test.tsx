import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUI } from './helpers';

// Mock the api client (hoisted so vi.mock can reference it): root probe → reachable; analytics →
// counts; search → results.
const { get } = vi.hoisted(() => ({
  get: vi.fn(async (ep?: string) => {
    const e = ep || '';
    if (e === '/api/ecysearcher/') return { service: 'eCySearcher API', version: '1.0.0' };
    if (e.includes('/analytics/dashboard')) return { data: { counts: { threats: 3, domains: 2, ips: 1 } } };
    if (e.includes('/api/search')) return { query: 'example.com', count: 1, data: { domains: [{ name: 'example.com', status: 'active' }] } };
    return {};
  }),
}));
vi.mock('../../src/lib/apiClient', () => ({ api: { get } }));

import ECySearcherPanel from '../../src/components/ECySearcherPanel';

describe('ECySearcherPanel — threat-intel tab via the ollamas proxy', () => {
  beforeEach(() => get.mockClear());

  it('probes reachability through /api/ecysearcher/ and shows UP + analytics counts', async () => {
    renderUI(<ECySearcherPanel />);
    expect(screen.getByText(/threat intelligence/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/UP/)).toBeInTheDocument());
    // analytics counts rendered (3 threats)
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    // it talked to the proxy, not eCySearcher directly
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/');
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/api/analytics/dashboard');
  });
});
