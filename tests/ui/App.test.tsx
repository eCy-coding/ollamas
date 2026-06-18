import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { renderUI, mockFetch } from './helpers';

describe('App shell', () => {
  beforeEach(() => {
    mockFetch({
      '/api/health': {
        mode: 'live',
        isLive: true,
        os: { platform: 'darwin', release: '24.6.0', arch: 'arm64', uptime: 1 },
        metrics: { cpuLoad1Min: 0.5, memory: { total: 16, free: 8, percentageUsed: 50 } },
        workspacePath: '/tmp',
        permissions: {},
        hasBackupEnabled: false,
      },
    });
  });

  it('renders the tab navigation', async () => {
    renderUI(<App />);
    // Cockpit Dashboard is the default tab label — proves nav rendered.
    expect(await screen.findByRole('button', { name: /Cockpit Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /P2P Computing Swarm/i })).toBeInTheDocument();
  });

  it('switches panels when a tab is clicked', async () => {
    const user = userEvent.setup();
    renderUI(<App />);
    await user.click(await screen.findByRole('button', { name: /Virtual/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Virtual Controller/i })).toBeInTheDocument(),
    );
  });
});
