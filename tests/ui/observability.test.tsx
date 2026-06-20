import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUI, mockFetch } from './helpers';
import { ObservabilityPanel } from '../../src/components/ObservabilityPanel';
import { activateLocale } from '../../src/lib/i18n';

describe('ObservabilityPanel (vF10)', () => {
  beforeEach(() => activateLocale('en'));

  it('renders verdict, p75 vitals, error counts and a sparkline from logbook', async () => {
    const now = new Date().toISOString();
    mockFetch({
      '/api/logbook': {
        count: 3,
        total: 3,
        entries: [
          { source: 'frontend', kind: 'note', note: 'web-vital LCP', metric: 'LCP', value: 1800, rating: 'good', ts: now },
          { source: 'frontend', kind: 'note', note: 'react_error', message: 'boom', ts: now },
          { source: 'frontend', kind: 'note', note: 'api_error 500 GET /x', status: 500, ts: now },
        ],
      },
    });

    renderUI(<ObservabilityPanel />);

    // Title appears once the logbook resolves.
    expect(await screen.findByText('Observability (RUM)')).toBeInTheDocument();
    // react_error → critical verdict badge.
    await waitFor(() => expect(screen.getByText('Critical')).toBeInTheDocument());
    // LCP p75 = single sample = 1800ms (good).
    expect(screen.getByText('1800ms')).toBeInTheDocument();
    // At least one sparkline SVG is rendered.
    expect(document.querySelectorAll('svg[role="img"]').length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are no frontend signals', async () => {
    mockFetch({ '/api/logbook': { count: 0, total: 0, entries: [] } });
    renderUI(<ObservabilityPanel />);
    expect(await screen.findByText(/No telemetry yet/i)).toBeInTheDocument();
  });
});
