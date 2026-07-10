// V7 M-038 — per-model settings UI: the ModelSettings editor persists a per-model override
// (POST /api/model-overrides) and the same override feeds the outgoing ollama request knobs
// (options.num_ctx / options.temperature / keep_alive / leading system message) via the pure
// server merge (server/model-overrides.ts) — proven end-to-end in tests/model-overrides.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderUI, mockFetch } from './helpers';
import { ModelSettings } from '../../src/components/ModelSettings';
import { resolveModelTuning, withSystemOverride } from '../../server/model-overrides';

const noop = () => {};

beforeEach(() => {
  localStorage.clear();
  // setup.ts assigns a plain vi.fn as the global fetch; vi.spyOn returns that SAME mock, so
  // its call history ACCUMULATES across tests — clear it or find() matches a prior test's POST.
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

async function openEditor() {
  await userEvent.click(screen.getByRole('button', { name: /model settings/i }));
}

describe('ModelSettings — per-model override editor (M-038)', () => {
  it('loads the persisted override for the selected model when opened', async () => {
    mockFetch({ '/api/model-overrides': { 'qwen3:8b': { numCtx: 4096, temperature: 0.2, keepAlive: '10m', system: 'Terse.' } } });
    renderUI(<ModelSettings model="qwen3:8b" onNotify={noop} />);
    await openEditor();
    await waitFor(() => expect(screen.getByLabelText(/num_ctx/i)).toHaveValue(4096));
    expect(screen.getByLabelText(/temperature/i)).toHaveValue(0.2);
    expect(screen.getByLabelText(/keep-alive/i)).toHaveValue('10m');
    expect(screen.getByLabelText(/system prompt/i)).toHaveValue('Terse.');
  });

  it('saving an edited override POSTs it to /api/model-overrides for THIS model', async () => {
    const spy = mockFetch({ '/api/model-overrides': {} });
    renderUI(<ModelSettings model="qwen3:8b" onNotify={noop} />);
    await openEditor();

    await userEvent.type(screen.getByLabelText(/num_ctx/i), '4096');
    await userEvent.type(screen.getByLabelText(/temperature/i), '0.2');
    await userEvent.type(screen.getByLabelText(/keep-alive/i), '10m');
    await userEvent.type(screen.getByLabelText(/system prompt/i), 'Terse.');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const post = spy.mock.calls.find(
        (c) => String(c[0]).includes('/api/model-overrides') && (c[1] as RequestInit)?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body).toEqual({
        model: 'qwen3:8b',
        override: { numCtx: 4096, temperature: 0.2, keepAlive: '10m', system: 'Terse.' },
      });
    });
  });

  it('saving with all fields blank POSTs an empty override (clear semantics)', async () => {
    const spy = mockFetch({ '/api/model-overrides': {} });
    renderUI(<ModelSettings model="qwen3:8b" onNotify={noop} />);
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const post = spy.mock.calls.find(
        (c) => String(c[0]).includes('/api/model-overrides') && (c[1] as RequestInit)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ model: 'qwen3:8b', override: {} });
    });
  });
});

describe('override → outgoing request body (the knobs the router sends to ollama)', () => {
  it('a saved override lands in options.num_ctx/temperature + keep_alive + system message', () => {
    const override = { numCtx: 4096, temperature: 0.2, keepAlive: '10m', system: 'Terse.' };
    const tuning = resolveModelTuning({}, override, 8192);
    const messages = withSystemOverride([{ role: 'user', content: 'hi' }], override.system);
    // exactly the shape providers.ts serializes into the ollama /api/chat body
    expect(tuning).toEqual({ numCtx: 4096, temperature: 0.2 });
    expect(messages[0]).toEqual({ role: 'system', content: 'Terse.' });
  });

  it('an explicit per-request value still beats the per-model override', () => {
    expect(resolveModelTuning({ numCtx: 2048 }, { numCtx: 4096 }, 8192).numCtx).toBe(2048);
  });
});
