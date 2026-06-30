import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderUI } from './helpers';

// Logged-out auth state: the Sheets tab should render the connect prompt, not crash.
vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    needsAuth: true,
    token: null,
    user: null,
    isLoggingIn: false,
    handleLogin: vi.fn(),
    handleLogout: vi.fn(),
    resetAuth: vi.fn(),
    isReady: true,
    isConfigured: true,
    authError: null,
  }),
}));

import { GoogleSheetsBrowser } from '../../src/components/GoogleSheetsBrowser';

describe('GoogleSheetsBrowser', () => {
  it('renders connect prompt when logged out', () => {
    renderUI(<GoogleSheetsBrowser />);
    expect(screen.getByText(/Connect Google Sheets/i)).toBeInTheDocument();
  });
});
