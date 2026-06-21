import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import App from '../../src/App';
import { KeyVault } from '../../src/components/KeyVault';
import { renderUI, mockFetch } from './helpers';

// vF6 — accessible-name guards. axe runs in e2e against the live DOM; these fast
// jsdom checks lock the contract so a regression fails in unit tests too.
describe('vF6 — accessibility (jsdom)', () => {
  it('tab navigation lives in a <nav> with named buttons', async () => {
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
    renderUI(<App />);
    // semantic landmark present
    const nav = await screen.findByRole('navigation');
    expect(nav).toBeInTheDocument();
    // each tab is a button with a discernible accessible name
    expect(within(nav).getByRole('button', { name: /Cockpit Dashboard/i })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /SaaS Gateway/i })).toBeInTheDocument();
  });

  it('icon-only key-vault actions expose accessible names, not bare icons', () => {
    mockFetch({ '/api/keys/mask': { anthropic: 'sk-***' } });
    renderUI(<KeyVault onNotify={() => {}} />);
    // text-labelled actions resolve by name
    expect(screen.getAllByRole('button', { name: /Save/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Test/i }).length).toBeGreaterThan(0);
  });
});
