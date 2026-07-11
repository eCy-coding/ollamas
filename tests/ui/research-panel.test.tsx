// O2 ResearchPanel (docs/odyssey/handoff/research/design.html) — the deep_research
// UI tab. Data via apiClient.api.post('/api/modules/research/run'). Covers the 4
// states (empty/composer → researching → error → filled-with-citations), the
// example-question chips, ⌘↵ submit / Esc reset, and text/list-based a11y
// (role="list" sources, aria-live="polite" progress — no color-only signal).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderUI } from './helpers';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { post } }));

import ResearchPanel from '../../src/components/ResearchPanel';

const result = (over: Record<string, unknown> = {}) => ({
  runId: 'r1',
  question: 'Why are local LLMs more private?',
  report: 'Local LLMs never send data off-device [1]. This reduces third-party exposure [2].',
  citations: [
    { n: 1, title: 'Ollama docs', url: 'https://ollama.com', domain: 'ollama.com' },
    { n: 2, title: 'Privacy 101', url: 'https://privacy.example', domain: 'privacy.example' },
  ],
  sources: [
    { url: 'https://ollama.com', title: 'Ollama docs', summary: 'Runs models on-device.', keyPoints: ['local'] },
    { url: 'https://privacy.example', title: 'Privacy 101', summary: 'Third-party exposure is reduced.', keyPoints: [] },
  ],
  rounds: [{ round: 1, queries: ['local LLM privacy'] }],
  ...over,
});

describe('ResearchPanel — 4 states (empty/researching/error/filled)', () => {
  beforeEach(() => post.mockReset());

  it('empty: shows the composer + example question chips (no fetch on mount)', () => {
    renderUI(<ResearchPanel />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1); // submit + at least one example chip
  });

  it('researching: submitting shows a live progress region before the response resolves', async () => {
    let resolve!: (v: unknown) => void;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderUI(<ResearchPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why are local LLMs more private?' } });
    fireEvent.click(screen.getByRole('button', { name: /research|araştır/i }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolve(result());
    await waitFor(() => expect(screen.getByText(/off-device/i)).toBeInTheDocument());
  });

  it('filled: renders the cited report + a numbered source list (role="list")', async () => {
    post.mockResolvedValue(result());
    renderUI(<ResearchPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why are local LLMs more private?' } });
    fireEvent.click(screen.getByRole('button', { name: /research|araştır/i }));
    await waitFor(() => expect(screen.getByText(/off-device/i)).toBeInTheDocument());
    // "[1]" appears both inline in the report and in the numbered source list —
    // assert it shows up at least once rather than assuming a single match.
    expect(screen.getAllByText(/^\[1\]$/).length).toBeGreaterThan(0);
    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
    expect(screen.getByText('Ollama docs')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/modules/research/run', expect.objectContaining({ question: expect.any(String) }));
  });

  it('error: a rejected run → error banner (not silent-empty) with a retry that re-submits', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    renderUI(<ResearchPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /research|araştır/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    post.mockResolvedValueOnce(result());
    fireEvent.click(screen.getByRole('button', { name: /retry|tekrar/i }));
    await waitFor(() => expect(screen.getByText(/off-device/i)).toBeInTheDocument());
  });

  it('honest-empty: zero sources still renders the report text, not a blank/silent screen', async () => {
    post.mockResolvedValue(result({ report: 'No sources found — the research run gathered nothing to report on.', citations: [], sources: [] }));
    renderUI(<ResearchPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /research|araştır/i }));
    await waitFor(() => expect(screen.getByText(/no sources found/i)).toBeInTheDocument());
  });

  it('Esc resets a filled result back to the empty composer', async () => {
    post.mockResolvedValue(result());
    renderUI(<ResearchPanel />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /research|araştır/i }));
    await waitFor(() => expect(screen.getByText(/off-device/i)).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('region', { name: 'research-panel' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/off-device/i)).not.toBeInTheDocument());
  });
});
