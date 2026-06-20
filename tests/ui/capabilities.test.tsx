import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderUI, mockFetch } from './helpers';
import App from '../../src/App';
import { CapabilityProvider, CapabilityGate } from '../../src/components/CapabilityGate';
import { activateLocale } from '../../src/lib/i18n';
import type { Permissions } from '../../src/lib/capabilities';

const perms = (o: Partial<Permissions> = {}): Permissions => ({
  fileRead: false,
  fileWrite: false,
  commandExec: false,
  git: false,
  ...o,
});

describe('CapabilityGate (vF11)', () => {
  it('renders children when the capability is granted', () => {
    render(
      <CapabilityProvider permissions={perms({ commandExec: true })}>
        <CapabilityGate need="commandExec" fallback={<span>denied</span>}>
          <span>granted</span>
        </CapabilityGate>
      </CapabilityProvider>,
    );
    expect(screen.getByText('granted')).toBeInTheDocument();
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
  });

  it('renders the fallback when the capability is denied', () => {
    render(
      <CapabilityProvider permissions={perms({ commandExec: false })}>
        <CapabilityGate need="commandExec" fallback={<span>denied</span>}>
          <span>granted</span>
        </CapabilityGate>
      </CapabilityProvider>,
    );
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('is deny-by-default with no provider', () => {
    render(
      <CapabilityGate need="commandExec" fallback={<span>denied</span>}>
        <span>granted</span>
      </CapabilityGate>,
    );
    expect(screen.getByText('denied')).toBeInTheDocument();
  });
});

describe('App capability gating (vF11)', () => {
  beforeEach(() => activateLocale('en'));

  it('disables a tab whose capability the backend has not granted', async () => {
    mockFetch({
      '/api/health': {
        mode: 'live',
        isLive: true,
        os: { platform: 'darwin', release: '24.6.0', arch: 'arm64', uptime: 1 },
        metrics: { cpuLoad1Min: 0.5, memory: { total: 16, free: 8, percentageUsed: 50 } },
        workspacePath: '/tmp',
        permissions: { fileRead: true, fileWrite: true, commandExec: false, git: true },
        hasBackupEnabled: false,
      },
    });
    renderUI(<App />);
    const terminalTab = await screen.findByRole('button', { name: /Interactive CLI/i });
    expect(terminalTab).toBeDisabled();
    // an ungated tab stays enabled
    expect(screen.getByRole('button', { name: /Cockpit Dashboard/i })).toBeEnabled();
  });
});
