import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUI } from './helpers';

// Mock the api client (hoisted so vi.mock can reference it): root probe → reachable; analytics →
// counts; search → results.
// The panel drives UP/DOWN off /api/ecysearcher/status (supervisor.running) and only probes the feature
// endpoints when the stack is running — so the default mock reports it running.
const { get } = vi.hoisted(() => ({
  get: vi.fn(async (ep?: string) => {
    const e = ep || '';
    if (e === '/api/ecysearcher/status') return { state: 'running', running: true, ready: true };
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
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/', { soft: true });
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/api/search/search/analytics', { soft: true });
  });

  it('when the supervisor is stopped: shows DOWN + never hits a feature endpoint (no 502 flood)', async () => {
    get.mockImplementation(async (ep?: string) => {
      if ((ep || '') === '/api/ecysearcher/status') return { state: 'stopped', running: false, ready: false };
      return {};
    });
    renderUI(<ECySearcherPanel />);
    await waitFor(() => expect(screen.getByText(/erişilemiyor/i)).toBeInTheDocument());
    // status was polled, but the root probe + analytics were gated off → no dead-upstream calls
    expect(get).toHaveBeenCalledWith('/api/ecysearcher/status', { soft: true });
    expect(get).not.toHaveBeenCalledWith('/api/ecysearcher/', { soft: true });
    expect(get).not.toHaveBeenCalledWith('/api/ecysearcher/api/search/search/analytics', { soft: true });
  });
});
