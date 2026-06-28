import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderUI } from './helpers';

// Controllable apiClient mock — drives sessions/models + the SSE stream so we can
// assert the ReAct Specialist tab's run/stop/trace behaviour deterministically.
const getMock = vi.fn();
const postMock = vi.fn();
const delMock = vi.fn();
const streamPostMock = vi.fn();

vi.mock('../../src/lib/apiClient', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    del: (...a: unknown[]) => delMock(...a),
    streamPost: (...a: unknown[]) => streamPostMock(...a),
  },
  ApiError: class ApiError extends Error {
    constructor(public status = 500) { super('api'); this.name = 'ApiError'; }
  },
}));

import { ReactAgentTab } from '../../src/components/ReactAgentTab';

const session = {
  id: 's1', title: 'T', modelId: 'gemini-3.5-flash', providerId: 'gemini',
  messages: [], updatedAt: new Date(0).toISOString(),
};

type Notify = (msg: string, type: 'error' | 'info' | 'success') => void;
let onNotify: Notify & ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  onNotify = vi.fn() as Notify & ReturnType<typeof vi.fn>;
  getMock.mockImplementation((url: string) => {
    if (url.includes('/api/models/')) return Promise.resolve(['gemini-3.5-flash', 'gemini-3.1-pro']);
    if (url.includes('/api/agent/sessions/')) return Promise.resolve(session);
    if (url.includes('/api/agent/sessions')) return Promise.resolve([]); // empty → no auto-select
    return Promise.resolve({});
  });
  postMock.mockResolvedValue(session);
  delMock.mockResolvedValue({});
  streamPostMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() }, configurable: true, writable: true,
  });
});

// Build a streamPost mock that pushes the given SSE frames through onChunk.
function streamWith(frames: Array<Record<string, unknown>>) {
  return async (_url: string, _body: unknown, opts: { onChunk: (s: string) => void }) => {
    await act(async () => {
      for (const f of frames) opts.onChunk(`data: ${JSON.stringify(f)}\n\n`);
    });
  };
}

async function send(text: string) {
  await typePrompt(text);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });
}

async function typePrompt(text: string) {
  const box = screen.getByRole('textbox');
  fireEvent.change(box, { target: { value: text } });
  return box;
}

describe('ReactAgentTab — ReAct Specialist', () => {
  it('renders the multi-line prompt + execute control', async () => {
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EXECUTE/i })).toBeInTheDocument();
  });

  it('Enter submits the prompt; Shift+Enter does NOT', async () => {
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const box = await typePrompt('list bugs');

    // Shift+Enter = newline, never a submit.
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(streamPostMock).not.toHaveBeenCalled();

    // Enter = run.
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(streamPostMock).toHaveBeenCalledTimes(1));
    expect(streamPostMock.mock.calls[0][0]).toBe('/api/agent/chat');
  });

  it('Stop aborts an in-flight run', async () => {
    // Stream that never settles → run stays in-flight → Stop control appears.
    streamPostMock.mockImplementation(() => new Promise(() => {}));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await typePrompt('do work');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });

    const stop = await screen.findByRole('button', { name: /STOP/i });
    fireEvent.click(stop);

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(expect.any(String), 'info'),
    );
    // Execute control returns once the run is stopped.
    expect(screen.getByRole('button', { name: /EXECUTE/i })).toBeInTheDocument();
  });

  it('expands a trace step to show full args/result', async () => {
    // Emit one step + done frame through the SSE onChunk callback.
    streamPostMock.mockImplementation(async (_url: string, _body: unknown, opts: { onChunk: (s: string) => void }) => {
      await act(async () => {
        opts.onChunk(`data: ${JSON.stringify({ type: 'step', stepNum: 1, tool: 'read_file', args: { path: 'readme.md' }, ok: true, latency: 7, result: 'loaded' })}\n\n`);
        opts.onChunk(`data: ${JSON.stringify({ type: 'done', text: 'VERDICT: DONE' })}\n\n`);
      });
    });
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await typePrompt('read it');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });

    // Trace row for the tool appears.
    const expandBtn = await screen.findByRole('button', { name: /Expand step detail/i });
    fireEvent.click(expandBtn);

    // Expanded detail shows the pretty-printed args path.
    await waitFor(() => expect(screen.getAllByText(/readme\.md/).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Collapse step detail/i })).toBeInTheDocument();
  });

  it('surfaces an error SSE frame as an error notification', async () => {
    streamPostMock.mockImplementation(streamWith([{ type: 'error', message: 'boom' }]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('go');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error'));
  });

  it('surfaces the verifier verdict (previously dropped verify event)', async () => {
    streamPostMock.mockImplementation(streamWith([{ type: 'verify', verdict: 'PASS', reason: 'looks correct' }]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('go');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('PASS'), 'success'));
  });

  it('opens the approval wizard on a write_file step and POSTs the approved content', async () => {
    streamPostMock.mockImplementation(streamWith([
      { type: 'step', stepNum: 1, tool: 'write_file', ok: true, latency: 4, args: { path: 'a.ts', content: 'X' }, diff: '+X', applied: false },
    ]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('write it');

    const approve = await screen.findByRole('button', { name: /APPROVE WRITE/i });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/agent/approve-write', { path: 'a.ts', content: 'X' }),
    );
  });

  it('renders fenced code from an assistant message as a <pre> block', async () => {
    streamPostMock.mockImplementation(streamWith([{ type: 'message', text: 'Here:\n```js\nconst x = 1\n```' }]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('show code');
    const code = await screen.findByText(/const x = 1/);
    expect(code.closest('pre')).not.toBeNull();
  });

  it('copy button writes the message to the clipboard', async () => {
    streamPostMock.mockImplementation(streamWith([{ type: 'message', text: 'hello world' }]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('hi');
    await screen.findByText('hello world');
    fireEvent.click(screen.getAllByRole('button', { name: /Copy/i })[0]);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('upserts a re-emitted step (applied flip) instead of duplicating it', async () => {
    streamPostMock.mockImplementation(streamWith([
      { type: 'step', stepNum: 1, tool: 'read_file', ok: true, latency: 1, args: { p: 1 }, result: 'first' },
      { type: 'step', stepNum: 1, tool: 'read_file', ok: true, latency: 2, args: { p: 1 }, result: 'second' },
    ]));
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await send('read');
    // Exactly one trace row (no duplicate), and it shows the UPDATED result.
    const expanders = await screen.findAllByRole('button', { name: /Expand step detail/i });
    expect(expanders).toHaveLength(1);
    fireEvent.click(expanders[0]);
    await waitFor(() => expect(screen.getAllByText(/second/).length).toBeGreaterThan(0));
  });

  it('deletes a session and clears active state', async () => {
    getMock.mockImplementation((url: string) => {
      if (url.includes('/api/models/')) return Promise.resolve(['gemini-3.5-flash']);
      if (url.includes('/api/agent/sessions/')) return Promise.resolve(session);
      if (url.includes('/api/agent/sessions')) return Promise.resolve([session]);
      return Promise.resolve({});
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderUI(<ReactAgentTab onNotify={onNotify} />);
    await waitFor(() => expect(screen.getByText('T')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Delete.*T/i }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith('/api/agent/sessions/s1'));
  });
});
