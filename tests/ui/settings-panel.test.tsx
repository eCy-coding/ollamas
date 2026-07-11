// O8 SettingsPanel (docs/odyssey/handoff/settings-2fa/design.html) — ported UI.
// Data via apiClient (/api/modules/settings/*). Mirrors
// tests/ui/notes-tasks-panel.test.tsx / email-panel.test.tsx: the apiClient is
// mocked (api.{get,put,post}), and the mock TOLERATES a non-string endpoint
// (theme/i18n provider mounts may hit api.get on mount — PIPELINE-LESSONS
// TEST-MOCK gotcha: `if (typeof endpoint !== 'string') return {}`). Covers the
// 5-section switch, the 2FA enroll flow (enroll → verify → backup codes), the
// RBAC matrix (owner locked), tool policy + sandbox toggle, and session revoke.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderUI } from './helpers';

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { get, put, post } }));

import SettingsPanel from '../../src/components/SettingsPanel';

const general = { theme: 'dark', density: 'comfortable', language: 'en-US', reduceMotion: false };
const twoFaDisabled = { enabled: false, backupCodesRemaining: 0 };
const sessions = {
  sessions: [
    { id: 'local-current', client: 'This device (local workspace)', ip: '127.0.0.1', location: 'Local', lastActive: '2026-01-01T00:00:00.000Z', current: true },
    { id: 'sess-2', client: 'Firefox on Linux', ip: '10.0.0.9', location: 'Remote', lastActive: '2026-01-01T00:00:00.000Z', current: false },
  ],
};
const roles = {
  roles: [
    { name: 'owner', locked: true, kind: 'Full access', perms: { models: 'allow', tools: 'allow', vault: 'allow', users: 'allow', daemon: 'allow' } },
    { name: 'operator', locked: false, kind: 'Operator', perms: { models: 'allow', tools: 'scoped', vault: 'deny', users: 'deny', daemon: 'deny' } },
  ],
};
const tools = {
  tools: [
    { tool: 'net', policy: 'ask', scope: '*', tierRef: 'safe' },
    { tool: 'sh', policy: 'ask', scope: 'workspace', tierRef: 'safe' },
  ],
};

// Default happy-path mock; individual tests override before rendering.
function mockDefault() {
  get.mockImplementation(async (endpoint?: string) => {
    if (typeof endpoint !== 'string') return {}; // provider mount tolerance (TEST-MOCK gotcha)
    if (endpoint.includes('/security/2fa')) return twoFaDisabled;
    if (endpoint.includes('/security/sessions')) return sessions;
    if (endpoint.includes('/roles')) return roles;
    if (endpoint.includes('/tools/policy')) return tools;
    if (endpoint.includes('/sandbox')) return { enforced: true };
    if (endpoint.includes('/general')) return general;
    return {};
  });
}

describe('SettingsPanel — section switch + panels', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    mockDefault();
  });

  it('defaults to the Security section and lists sessions', async () => {
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());
    // The seeded current device + a revocable remote session are both shown.
    expect(screen.getByText('This device (local workspace)')).toBeInTheDocument();
    expect(screen.getByText('Firefox on Linux')).toBeInTheDocument();
  });

  it('section switch: General shows theme controls; Roles shows the matrix', async () => {
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^General$/i }));
    await waitFor(() => expect(screen.getByText('Theme')).toBeInTheDocument());
    expect(screen.getByText('Interface density')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Roles$/i }));
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    // Operator row rendered — assert via its unique permission-cell button
    // ("Operator" appears twice: the role-name label and the role `kind`).
    expect(screen.getByRole('button', { name: 'operator-vault-deny' })).toBeInTheDocument();
  });

  it('roles: the locked Owner permission cells are disabled; a mutable role cell cycles', async () => {
    put.mockResolvedValue({ ...roles.roles[1], perms: { ...roles.roles[1].perms, vault: 'scoped' } });
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Roles$/i }));
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());

    // Owner (locked) vault cell is disabled — cannot be downgraded from the table.
    expect(screen.getByRole('button', { name: 'owner-vault-allow' })).toBeDisabled();

    // Operator vault cell cycles deny → allow via PUT.
    fireEvent.click(screen.getByRole('button', { name: 'operator-vault-deny' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/modules/settings/roles/operator', { vault: 'allow' }));
  });

  it('tools: sandbox banner shows Enforced (TEXT) and policy button cycles via PUT', async () => {
    put.mockResolvedValue({ tool: 'net', policy: 'deny', scope: '*', tierRef: 'safe' });
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Tools$/i }));
    await waitFor(() => expect(screen.getByText('Execution sandbox')).toBeInTheDocument());
    // a11y: sandbox state is TEXT, not color-only.
    expect(screen.getByText('Enforced')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'net-policy-ask' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/modules/settings/tools/policy/net', { policy: 'deny' }));
  });

  it('sessions: revoking a non-current session posts to /revoke and reloads', async () => {
    post.mockResolvedValue({ ok: true });
    // After revoke, the reload returns only the current session.
    let revoked = false;
    get.mockImplementation(async (endpoint?: string) => {
      if (typeof endpoint !== 'string') return {};
      if (endpoint.includes('/security/2fa')) return twoFaDisabled;
      if (endpoint.includes('/security/sessions')) return revoked ? { sessions: [sessions.sessions[0]] } : sessions;
      if (endpoint.includes('/roles')) return roles;
      if (endpoint.includes('/tools/policy')) return tools;
      if (endpoint.includes('/sandbox')) return { enforced: true };
      if (endpoint.includes('/general')) return general;
      return {};
    });
    post.mockImplementation(async () => { revoked = true; return { ok: true }; });

    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Firefox on Linux')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/modules/settings/security/sessions/sess-2/revoke'));
    await waitFor(() => expect(screen.queryByText('Firefox on Linux')).not.toBeInTheDocument());
  });

  it('2FA flow: enable → enter code → activate → backup codes shown', async () => {
    post.mockImplementation(async (endpoint?: string) => {
      if (typeof endpoint !== 'string') return {};
      if (endpoint.includes('/2fa/enroll')) return { secret: 'ABCDEFGHIJKLMNOP', otpauthUrl: 'otpauth://totp/ollamas:local-owner?secret=ABCDEFGHIJKLMNOP' };
      if (endpoint.includes('/2fa/activate')) return { enabled: true, backupCodes: ['AAAAA-11111', 'BBBBB-22222'] };
      return {};
    });
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());

    // Step 0 → enroll
    fireEvent.click(screen.getByRole('button', { name: /Enable two-factor/i }));
    await waitFor(() => expect(screen.getByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument());

    // Step 1 → continue to verify
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
    const input = await screen.findByLabelText(/Enter the 6-digit code/i);
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));

    // Step 3 → backup codes shown
    await waitFor(() => expect(screen.getByTestId('backup-codes')).toBeInTheDocument());
    const codesEl = screen.getByTestId('backup-codes');
    expect(within(codesEl).getByText('AAAAA-11111')).toBeInTheDocument();
    expect(within(codesEl).getByText('BBBBB-22222')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/modules/settings/security/2fa/activate', { token: '123456' });
  });

  it('2FA flow: a wrong code surfaces an error and does not advance to backup codes', async () => {
    post.mockImplementation(async (endpoint?: string) => {
      if (typeof endpoint !== 'string') return {};
      if (endpoint.includes('/2fa/enroll')) return { secret: 'ABCDEFGHIJKLMNOP', otpauthUrl: 'otpauth://x' };
      if (endpoint.includes('/2fa/activate')) throw new Error('invalid or expired code');
      return {};
    });
    renderUI(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Two-factor authentication/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Enable two-factor/i }));
    await waitFor(() => expect(screen.getByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
    const input = await screen.findByLabelText(/Enter the 6-digit code/i);
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByTestId('backup-codes')).not.toBeInTheDocument();
  });
});
