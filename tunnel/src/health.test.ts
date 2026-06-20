import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { probeHttp, probeHttps, type HttpsRequestImpl } from "./health.ts";

// Fake node:https request: an EventEmitter doubling as ClientRequest.
// `behavior` decides what happens after .end() is called.
function fakeHttps(behavior: { status?: number; error?: boolean; hang?: boolean }): {
  impl: HttpsRequestImpl;
  lastOpts: () => Record<string, unknown>;
} {
  let captured: Record<string, unknown> = {};
  const impl = ((url, options, callback) => {
    captured = options as Record<string, unknown>;
    const req = new EventEmitter() as unknown as {
      setTimeout: (ms: number, cb: () => void) => void;
      destroy: () => void;
      end: () => void;
      on: (e: string, cb: (...a: unknown[]) => void) => void;
      emit: (e: string, ...a: unknown[]) => void;
    };
    let timeoutCb: (() => void) | null = null;
    req.setTimeout = (_ms, cb) => {
      timeoutCb = cb;
    };
    req.destroy = () => {};
    req.end = () => {
      queueMicrotask(() => {
        if (behavior.hang) {
          timeoutCb?.();
          return;
        }
        if (behavior.error) {
          (req as unknown as EventEmitter).emit("error", new Error("ECONNREFUSED"));
          return;
        }
        const res = { statusCode: behavior.status ?? 200, resume: () => {} } as never;
        callback(res);
      });
    };
    return req as never;
  }) as HttpsRequestImpl;
  return { impl, lastOpts: () => captured };
}

const fakeFetch = (status: number): typeof fetch =>
  (async () => new Response(null, { status })) as unknown as typeof fetch;

test("probe returns true on 200", async () => {
  assert.equal(await probeHttp("http://x:3000", "/healthz", { fetchImpl: fakeFetch(200) }), true);
});

test("probe returns false on 500", async () => {
  assert.equal(await probeHttp("http://x:3000", "/healthz", { fetchImpl: fakeFetch(500) }), false);
});

test("probe honors custom okStatuses (404 allowed)", async () => {
  assert.equal(
    await probeHttp("http://x:3000", "/", { fetchImpl: fakeFetch(404), okStatuses: [200, 404] }),
    true,
  );
});

test("probe returns false on network error (never throws)", async () => {
  const throwingFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  assert.equal(await probeHttp("http://x:3000", "/healthz", { fetchImpl: throwingFetch }), false);
});

test("probe returns false on timeout/abort", async () => {
  const hangingFetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;
  assert.equal(
    await probeHttp("http://x:3000", "/healthz", { fetchImpl: hangingFetch, timeoutMs: 20 }),
    false,
  );
});

test("probe strips trailing slash from base", async () => {
  let seen = "";
  const capturing = (async (url: string) => {
    seen = url;
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  await probeHttp("http://x:3000/", "/healthz", { fetchImpl: capturing });
  assert.equal(seen, "http://x:3000/healthz");
});

test("https: 200 → true", async () => {
  const { impl } = fakeHttps({ status: 200 });
  assert.equal(await probeHttps("https://m.local", "/healthz", { requestImpl: impl }), true);
});

test("https: 503 → false", async () => {
  const { impl } = fakeHttps({ status: 503 });
  assert.equal(await probeHttps("https://m.local", "/healthz", { requestImpl: impl }), false);
});

test("https: connection error → false (never throws)", async () => {
  const { impl } = fakeHttps({ error: true });
  assert.equal(await probeHttps("https://m.local", "/healthz", { requestImpl: impl }), false);
});

test("https: timeout/hang → false", async () => {
  const { impl } = fakeHttps({ hang: true });
  assert.equal(
    await probeHttps("https://m.local", "/healthz", { requestImpl: impl, timeoutMs: 10 }),
    false,
  );
});

test("https: VERIFIES TLS by default (rejectUnauthorized true)", async () => {
  const { impl, lastOpts } = fakeHttps({ status: 200 });
  await probeHttps("https://m.local", "/healthz", { requestImpl: impl });
  assert.equal(lastOpts().rejectUnauthorized, true);
});

test("https: insecure:true opt-in disables verification", async () => {
  const { impl, lastOpts } = fakeHttps({ status: 200 });
  await probeHttps("https://m.local", "/healthz", { requestImpl: impl, insecure: true });
  assert.equal(lastOpts().rejectUnauthorized, false);
});
