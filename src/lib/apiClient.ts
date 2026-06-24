// Frontend choke-point (FRONTEND_AGENTS.md §1/§4): ALL backend I/O funnels here.
// Components MUST NOT call fetch/EventSource directly — single place for auth,
// retry, error→observability, and stream decoding. Backend stays untouched
// (Scope Law): every method targets an existing ollamas HTTP endpoint.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Json = Record<string, unknown> | unknown[] | null;

export interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number; // GET defaults to 2; mutations default to 0
  timeoutMs?: number; // default 30s
  backoffMs?: number; // base backoff; 0 in tests
}

// Auth tokens are set by SaaSAdmin into localStorage; injected on every call so
// no component re-implements header wiring.
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    const admin = localStorage.getItem('ollamas.adminToken');
    if (admin) h['X-Admin-Token'] = admin;
    const bearer = localStorage.getItem('ollamas.apiKey');
    if (bearer) h['Authorization'] = `Bearer ${bearer}`;
  } catch {
    /* localStorage unavailable — proceed unauthenticated */
  }
  return h;
}

// Best-effort observability → seyir defteri. MUST NOT throw into the UI path.
export function logClientEvent(note: string, meta: Record<string, unknown> = {}): void {
  try {
    // Backend POST /api/logbook requires `{ entry }` (it stores {kind:'note', entry});
    // wrap the client event so telemetry isn't rejected with 400.
    const payload = JSON.stringify({ entry: { source: 'frontend', note, ...meta } });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/logbook', new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch('/api/logbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* observability must never break UX */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

async function request<T = Json>(endpoint: string, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const backoffMs = opts.backoffMs ?? 300;

  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
        ...opts.headers,
      };
      const res = await fetch(endpoint, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal ?? ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.clone().json();
        } catch {
          body = await res.text().catch(() => undefined);
        }
        if (res.status === 401 || res.status === 403 || isTransient(res.status)) {
          logClientEvent(`api_error ${res.status} ${method} ${endpoint}`, { status: res.status });
        }
        if (isTransient(res.status) && attempt < retries) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        throw new ApiError(res.status, endpoint, `${method} ${endpoint} → ${res.status}`, body);
      }

      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      logClientEvent(`api_network_error ${method} ${endpoint}`, { error: String(e) });
      throw new ApiError(0, endpoint, `network error: ${String(e)}`);
    }
  }
}

export interface StreamOpts {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onError?: (e: unknown) => void;
  retries?: number; // connect-retries on transient failure (default 0)
  backoffMs?: number;
}

// SSE-over-POST: ollamas streams `data: {...}\n\n` frames on the response body
// (agent-chat, multi-agent pipeline). EventSource can't POST, so we read the
// ReadableStream and decode text chunks for the caller to parse.
//
// vF8 hardening: retries the CONNECT on transient failure (429/5xx/network) with
// backoff, but NEVER re-issues once chunks have streamed — an LLM generation can't
// be resumed, so a mid-stream drop surfaces as onError (honest, no duplicate text).
// Aborts (opts.signal) are intentional and resolve quietly.
async function streamPost(endpoint: string, body: unknown, opts: StreamOpts): Promise<void> {
  const retries = opts.retries ?? 0;
  const backoffMs = opts.backoffMs ?? 300;
  let delivered = false;

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) return;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...opts.headers },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!res.ok || !res.body) {
        if (isTransient(res.status) && attempt < retries) {
          logClientEvent(`api_stream_reconnect ${res.status} ${endpoint}`, { attempt: attempt + 1 });
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        logClientEvent(`api_stream_error ${res.status} ${endpoint}`, { status: res.status });
        throw new ApiError(res.status, endpoint, `stream ${endpoint} → ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          delivered = true;
          opts.onChunk(decoder.decode(value, { stream: true }));
        }
      }
      const tail = decoder.decode();
      if (tail) opts.onChunk(tail);
      return;
    } catch (e) {
      if (opts.signal?.aborted) return; // intentional cancel
      // Retry only the connect phase (no chunks yet); generation can't resume.
      if (!delivered && !(e instanceof ApiError) && attempt < retries) {
        logClientEvent(`api_stream_reconnect net ${endpoint}`, { attempt: attempt + 1 });
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      if (!(e instanceof ApiError)) logClientEvent(`api_stream_error net ${endpoint}`, { error: String(e) });
      const err = e instanceof ApiError ? e : new ApiError(0, endpoint, `stream network error: ${String(e)}`);
      opts.onError?.(err);
      throw err;
    }
  }
}

export const api = {
  get: <T = Json>(endpoint: string, opts?: RequestOpts) => request<T>(endpoint, { ...opts, method: 'GET' }),
  post: <T = Json>(endpoint: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(endpoint, { ...opts, method: 'POST', body }),
  put: <T = Json>(endpoint: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(endpoint, { ...opts, method: 'PUT', body }),
  del: <T = Json>(endpoint: string, opts?: RequestOpts) => request<T>(endpoint, { ...opts, method: 'DELETE' }),
  streamPost,
  request,

  // Binary upload: stream the raw bytes (any file type) to the workspace. Unlike
  // POST /api/workspace/file (utf-8 JSON), this preserves binary uncorrupted.
  uploadFile: async (
    relativePath: string,
    data: Blob | ArrayBuffer | Uint8Array,
    opts?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; path: string; bytes: number }> => {
    const ep = `/api/workspace/upload?relativePath=${encodeURIComponent(relativePath)}`;
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: data as BodyInit,
      signal: opts?.signal,
    });
    if (!res.ok) {
      let body: unknown; try { body = await res.json(); } catch { /* no JSON body */ }
      logClientEvent(`api_error ${res.status} ${ep}`, { status: res.status });
      throw new ApiError(res.status, ep, `upload → ${res.status}`, body);
    }
    return res.json();
  },

  // Binary download: returns a Blob the caller can save (e.g. via an <a download>).
  downloadFile: async (
    relativePath: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Blob> => {
    const ep = `/api/workspace/download?relativePath=${encodeURIComponent(relativePath)}`;
    const res = await fetch(ep, { headers: { ...authHeaders() }, signal: opts?.signal });
    if (!res.ok) {
      let body: unknown; try { body = await res.json(); } catch { /* no JSON body */ }
      logClientEvent(`api_error ${res.status} ${ep}`, { status: res.status });
      throw new ApiError(res.status, ep, `download → ${res.status}`, body);
    }
    return res.blob();
  },
};

export default api;
