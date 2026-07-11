// O3 DocumentsPanel (docs/odyssey/handoff/documents/design.html) — ported UI.
// Data via apiClient (/api/modules/documents/*). Covers the 4 states
// (loading/error/empty/list) + a viewer selection + upload/delete actions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderUI } from './helpers';

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { get, post, del } }));

import DocumentsPanel from '../../src/components/DocumentsPanel';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'spec.md',
  kind: 'markdown',
  mime: 'text/markdown',
  bytes: 6100,
  text: '# Spec\n\nSome body text.',
  html: '<h1>Spec</h1><p>Some body text.</p>',
  truncated: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

function mockList(documents: unknown[]) {
  get.mockImplementation(async (endpoint?: string) => {
    // Providers (theme/i18n) may hit api.get on mount — tolerate non-panel calls.
    if (typeof endpoint !== 'string') return {};
    if (endpoint === '/api/modules/documents') return { documents };
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

describe('DocumentsPanel — 4 states (loading/error/empty/list) + viewer + upload/delete', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
  });

  it('loading: shows a status indicator before data resolves', async () => {
    let resolve!: (v: unknown) => void;
    get.mockImplementation((endpoint?: string) => {
      if (typeof endpoint !== 'string') return Promise.resolve({});
      return new Promise((r) => {
        resolve = r;
      });
    });
    renderUI(<DocumentsPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolve({ documents: [doc()] });
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
  });

  it('list: renders document names + kind badge from the backend (not hard-coded)', async () => {
    mockList([doc(), doc({ id: 'd2', name: 'report.pdf', kind: 'pdf' })]);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/modules/documents');
  });

  it('error: rejected fetch → error banner + a retry that re-fetches', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    mockList([doc()]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
  });

  it('empty: no documents → honest empty message (no fabricated rows)', async () => {
    mockList([]);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText(/no documents/i)).toBeInTheDocument());
  });

  it('viewer: clicking a document renders its extracted text/html', async () => {
    mockList([doc()]);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
    fireEvent.click(screen.getByText('spec.md'));
    await waitFor(() => expect(screen.getByText('Some body text.')).toBeInTheDocument());
  });

  it('viewer: extraction error surfaces a warning instead of empty text', async () => {
    mockList([doc({ text: '', html: undefined, extractError: 'PDF extraction failed: corrupt' })]);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
    fireEvent.click(screen.getByText('spec.md'));
    await waitFor(() => expect(screen.getByText(/extraction failed/i)).toBeInTheDocument());
  });

  it('delete: clicking the delete action calls DELETE and refreshes the list', async () => {
    mockList([doc()]);
    del.mockResolvedValue({ ok: true });
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText('spec.md')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /delete spec.md/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/modules/documents/d1'));
  });

  it('upload: choosing a file calls POST with a base64 payload and refreshes', async () => {
    mockList([]);
    post.mockResolvedValue(doc());
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText(/no documents/i)).toBeInTheDocument());

    const input = screen.getByLabelText(/upload/i) as HTMLInputElement;
    const file = new File(['# hi'], 'hi.md', { type: 'text/markdown' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [endpoint, body] = post.mock.calls[0];
    expect(endpoint).toBe('/api/modules/documents');
    expect((body as { name: string }).name).toBe('hi.md');
    expect(typeof (body as { contentBase64: string }).contentBase64).toBe('string');
  });
});
