import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUI } from './helpers';

// Mock the api client (hoisted so vi.mock can reference it): root probe → reachable; analytics →
// counts; search → results.
const { get } = vi.hoisted(() => ({
  get: vi.fn(async (ep?: string) => {
    const e = ep || '';
    if (e === '/api/ecysearcher/') return { service: 'eCySearcher API', version: '1.0.0' };
    if (e.includes('/search/analytics')) return { data: { summary: { total_threats: 3, total_domains: 2, total_ips: 1 } } };
    if (e.includes('/api/search/search')) return { query: 'example.com', count: 1, data: { domains: [{ name: 'example.com', reputation: 'malicious' }] } };
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
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/api/search/search/analytics');
  });
});
