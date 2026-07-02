import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderUI } from './helpers';

// Mutable auth state so one mock serves logged-out and signed-in cases. The
// spread returns a FRESH object (and fresh vi.fn callbacks) every render —
// mirroring the real useAuth() instability that caused the refetch loop.
const authState: Record<string, unknown> = {
  needsAuth: true,
  token: null,
  user: null,
  isLoggingIn: false,
  isReady: true,
  isConfigured: true,
  authError: null,
};
vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState, handleLogin: vi.fn(), handleLogout: vi.fn(), resetAuth: vi.fn() }),
}));

import { GmailBrowser } from '../../src/components/GmailBrowser';

const DISABLED_BODY = JSON.stringify({
  error: {
    code: 403,
    message:
      'Gmail API has not been used in project 393156926657 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=393156926657 then retry.',
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  authState.needsAuth = true;
  authState.token = null;
});

describe('GmailBrowser', () => {
  it('renders connect prompt when logged out', () => {
    renderUI(<GmailBrowser />);
    expect(screen.getByText(/Connect Gmail/i)).toBeInTheDocument();
  });

  it('shows persistent enable-API error on 403-disabled and fetches exactly once (loop regression)', async () => {
    authState.needsAuth = false;
    authState.token = 'test-token';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(DISABLED_BODY, { status: 403 }));

    renderUI(<GmailBrowser />);

    await screen.findByText(/Gmail API is disabled/i);
    const link = screen.getByRole('link', { name: /Enable the Gmail API/i });
    expect(link.getAttribute('href')).toContain('gmail.googleapis.com');

    // The 685-request regression: error/busy state updates re-render the
    // component; the [token]-scoped effect must NOT refire on re-renders.
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
