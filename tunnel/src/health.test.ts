import test from "node:test";
import assert from "node:assert/strict";
import { probeHttp } from "./health.ts";

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
