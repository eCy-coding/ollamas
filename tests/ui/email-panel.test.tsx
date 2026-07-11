// O4 EmailPanel (docs/odyssey/handoff/email/design.html "MailPanel") — ported
// UI. Data via apiClient.api.{get,post}('/api/modules/email/*'). Covers the
// 5 design states (notconnected/syncing/error/filled/compose), the TEXT-based
// triage badges (a11y, PIPELINE-LESSONS #9 — no color-only signal), the AI
// summary card, and the compose modal's Send action (mocked — SMTP must NEVER
// actually fire in tests).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderUI } from './helpers';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { get, post } }));

import EmailPanel from '../../src/components/EmailPanel';

const message = (over: Record<string, unknown> = {}) => ({
  id: 'INBOX:1',
  folder: 'INBOX',
  from: 'priya@ollamas.dev',
  to: 'me@ollamas.dev',
  subject: 'Please review PR #412',
  date: '2026-01-01T09:24:00.000Z',
  snippet: 'Can you review before Friday?',
  bodyText: 'Hey — can you review PR #412 before Friday? Thanks!',
  bodyHtml: null,
  triage: 'action',
  createdAt: '2026-01-01T09:24:00.000Z',
  ...over,
});

// Providers (theme/i18n) may hit api.get on mount — tolerate non-panel calls
// (PIPELINE-LESSONS: TEST-MOCK tolerate provider mount get).
function mockGet(impl: (endpoint: string) => unknown) {
  get.mockImplementation(async (endpoint?: string) => {
    if (typeof endpoint !== 'string') return {};
    return impl(endpoint);
  });
}

describe('EmailPanel — 5 states (notconnected/syncing/error/filled/compose)', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('syncing: shows a status indicator before /status resolves', async () => {
    let resolveStatus!: (v: unknown) => void;
    get.mockImplementation((endpoint?: string) => {
      if (typeof endpoint !== 'string') return Promise.resolve({});
      if (endpoint.includes('/status')) return new Promise((r) => { resolveStatus = r; });
      return Promise.resolve({ messages: [], connected: true });
    });
    renderUI(<EmailPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolveStatus({ connected: false });
    await waitFor(() => expect(screen.getByText(/no mailbox connected/i)).toBeInTheDocument());
  });

  it('notconnected: /status connected:false, no error → "no mailbox" state with a setup hint', async () => {
    mockGet((endpoint) => (endpoint.includes('/status') ? { connected: false } : { messages: [] }));
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByText(/no mailbox connected/i)).toBeInTheDocument());
    expect(screen.getByText(/EMAIL_IMAP_HOST/)).toBeInTheDocument();
    // Compose is disabled — nothing to send from/to yet.
    expect(screen.getByRole('button', { name: /compose/i })).toBeDisabled();
  });

  it('error: /status connected:false + error (535 auth) → error banner + retry', async () => {
    mockGet((endpoint) =>
      endpoint.includes('/status') ? { connected: false, error: '535 5.7.8 auth rejected' } : { messages: [] },
    );
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/535/)).toBeInTheDocument();

    mockGet((endpoint) =>
      endpoint.includes('/status') ? { connected: true, folders: ['INBOX'] } : { messages: [message()], connected: true },
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Please review PR #412')).toBeInTheDocument());
  });

  it('filled: renders messages with TEXT triage badges (not color-only, a11y)', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/status')) return { connected: true, folders: ['INBOX'] };
      if (endpoint.includes('/messages')) return { messages: [message(), message({ id: 'INBOX:2', subject: 'Weekly digest', triage: 'archive', from: 'news@example.com' })], connected: true };
      return {};
    });
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByText('Please review PR #412')).toBeInTheDocument());
    expect(screen.getByText('Weekly digest')).toBeInTheDocument();

    const actionRow = screen.getByText('Please review PR #412').closest('[data-message-row]') as HTMLElement;
    expect(within(actionRow).getByText(/action/i)).toBeInTheDocument();
    const archiveRow = screen.getByText('Weekly digest').closest('[data-message-row]') as HTMLElement;
    expect(within(archiveRow).getByText(/archive/i)).toBeInTheDocument();
  });

  it('filled + AI summary: selecting a message and clicking AI Summary renders the $0/qwen3:8b card', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/status')) return { connected: true, folders: ['INBOX'] };
      if (endpoint.includes('/messages')) return { messages: [message()], connected: true };
      return {};
    });
    post.mockResolvedValue({ summary: 'Priya needs your review by Friday.', bullets: ['Blocks release'] });
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByText('Please review PR #412')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Please review PR #412'));
    fireEvent.click(screen.getByRole('button', { name: /ai summary/i }));

    await waitFor(() => expect(screen.getByText('Priya needs your review by Friday.')).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith('/api/modules/email/messages/INBOX:1/summarize');
    expect(screen.getByText(/qwen3:8b/)).toBeInTheDocument();
  });

  it('compose: opens the modal, sends via POST /send (mocked — SMTP never fires for real)', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/status')) return { connected: true, folders: ['INBOX'] };
      if (endpoint.includes('/messages')) return { messages: [message()], connected: true };
      return {};
    });
    post.mockResolvedValue({ ok: true, messageId: 'sent-1' });
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByText('Please review PR #412')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /compose/i }));
    const dialog = screen.getByRole('dialog', { name: /email-compose-modal/i });
    expect(within(dialog).getByText(/privileged/i)).toBeInTheDocument(); // Send is clearly the privileged action

    fireEvent.change(within(dialog).getByPlaceholderText('name@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/modules/email/send', expect.objectContaining({ to: ['a@b.com'] })));
    await waitFor(() => expect(within(dialog).getByText(/sent/i)).toBeInTheDocument());
  });

  it('compose: SMTP not configured (503-shaped rejection) → error message, form stays open', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/status')) return { connected: true, folders: ['INBOX'] };
      if (endpoint.includes('/messages')) return { messages: [message()], connected: true };
      return {};
    });
    post.mockRejectedValue(new Error('SMTP not configured (set EMAIL_SMTP_HOST)'));
    renderUI(<EmailPanel />);
    await waitFor(() => expect(screen.getByText('Please review PR #412')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /compose/i }));
    const dialog = screen.getByRole('dialog', { name: /email-compose-modal/i });
    fireEvent.change(within(dialog).getByPlaceholderText('name@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument());
    expect(within(dialog).getByText(/smtp not configured/i)).toBeInTheDocument();
  });
});
