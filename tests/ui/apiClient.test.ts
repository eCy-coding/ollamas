import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, logClientEvent } from '../../src/lib/apiClient';

// Build a real Response so we exercise the same parse path as production.
function res(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init, headers });
}

// Fresh fetch per test. setup.ts assigns globalThis.fetch = vi.fn() directly, so
// vi.spyOn would re-wrap one shared fn and accumulate calls across tests; stubbing
// a brand-new mock guarantees isolated call history.
function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('apiClient — choke-point', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('GET parses JSON body', async () => {
    stubFetch().mockResolvedValue(res({ status: 'ok' }));
    const data = await api.get<{ status: string }>('/api/health');
    expect(data.status).toBe('ok');
  });

  it('POST sends method + JSON body + Content-Type', async () => {
    const spy = stubFetch().mockResolvedValue(res({ done: true }));
    await api.post('/api/cluster/execute', { toolName: 'x' });
    const [url, opts] = spy.mock.calls[0];
    expect(url).toBe('/api/cluster/execute');
    expect(opts).toMatchObject({ method: 'POST' });
    expect((opts as RequestInit).body).toBe(JSON.stringify({ toolName: 'x' }));
    expect(new Headers((opts as RequestInit).headers).get('content-type')).toBe('application/json');
  });

  it('injects auth headers from localStorage', async () => {
    localStorage.setItem('ollamas.adminToken', 'AAA');
    localStorage.setItem('ollamas.apiKey', 'BBB');
    const spy = stubFetch().mockResolvedValue(res({}));
    await api.get('/api/saas/tenants');
    const h = new Headers((spy.mock.calls[0][1] as RequestInit).headers);
    expect(h.get('x-admin-token')).toBe('AAA');
    expect(h.get('authorization')).toBe('Bearer BBB');
  });

  it('throws ApiError with status on non-ok and does NOT retry 4xx', async () => {
    const spy = stubFetch().mockResolvedValue(res({ error: 'nope' }, { status: 403 }));
    await expect(api.get('/api/saas/audit')).rejects.toMatchObject({ name: 'ApiError', status: 403 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries transient 503 then succeeds', async () => {
    const spy = stubFetch()
      .mockResolvedValueOnce(res({}, { status: 503 }))
      .mockResolvedValueOnce(res({ ok: 1 }));
    const data = await api.get<{ ok: number }>('/api/ready', { retries: 1, backoffMs: 0 });
    expect(data.ok).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('streamPost reads chunks until done', async () => {
    const chunks = ['data: {"a":1}\n\n', 'data: {"b":2}\n\n'];
    const enc = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
        else ctrl.close();
      },
    });
    stubFetch().mockResolvedValue(new Response(stream, { status: 200 }));
    const got: string[] = [];
    await api.streamPost('/api/agent/chat', { msg: 'hi' }, { onChunk: (c) => got.push(c) });
    expect(got.join('')).toContain('"a":1');
    expect(got.join('')).toContain('"b":2');
  });

  it('logClientEvent never throws when sendBeacon missing', () => {
    const orig = navigator.sendBeacon;
    // force fallback branch
    navigator.sendBeacon = undefined as unknown as typeof navigator.sendBeacon;
    stubFetch().mockResolvedValue(res({}));
    expect(() => logClientEvent('test note')).not.toThrow();
    navigator.sendBeacon = orig;
  });
});
