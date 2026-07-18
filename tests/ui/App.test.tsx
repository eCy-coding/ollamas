import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
        permissions: { fileRead: true, fileWrite: true, commandExec: true, git: true },
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

  // ODYSSEY shell skin — sidebar groups the flat tab list into labeled sections
  // (visual only; same tabs, same order, same seam) so the nav reads like the
  // design.html nav-rail instead of one long undifferentiated list.
  it('groups the sidebar nav into labeled sections', async () => {
    renderUI(<App />);
    await screen.findByRole('button', { name: /Cockpit Dashboard/i });
    const nav = screen.getByRole('navigation', { name: /Primary/i });
    expect(within(nav).getByText(/Workspace/i)).toBeInTheDocument();
    expect(within(nav).getByText(/Data & Integrations/i)).toBeInTheDocument();
    expect(within(nav).getByText(/Ops & Security/i)).toBeInTheDocument();
  });

  // K2 (v18) — chat/ecym previously rendered with no section header (dead
  // idx===0 branch). NAV_GROUP_START now maps chat -> "app.sidebar.group.ecy"
  // so the "eCy" header sits above the first tab, and the group appears before
  // "Workspace" since chat is the first tab in the flat list.
  it('groups chat + ecym under an "eCy" section header at the top of the nav', async () => {
    renderUI(<App />);
    const chatButton = await screen.findByRole('button', { name: /Chat \(eCy\)/i });
    const nav = screen.getByRole('navigation', { name: /Primary/i });
    expect(within(nav).getByText(/^eCy$/)).toBeInTheDocument();

    // The header must precede the chat tab in DOM order (proves it labels the
    // chat/ecym group, not some unrelated "eCy" substring elsewhere in the nav).
    const position = chatButton.compareDocumentPosition(within(nav).getByText(/^eCy$/));
    // eslint-disable-next-line no-bitwise -- DOM Node.compareDocumentPosition bitmask check
    expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
