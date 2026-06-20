import test from "node:test";
import assert from "node:assert/strict";
import { classify, internetReachable } from "./connectivity.ts";

test("classify: internet → online (regardless of lan)", () => {
  assert.equal(classify({ lan: true, internet: true }), "online");
  assert.equal(classify({ lan: false, internet: true }), "online");
});

test("classify: lan only → lan-only", () => {
  assert.equal(classify({ lan: true, internet: false }), "lan-only");
});

test("classify: nothing → offline", () => {
  assert.equal(classify({ lan: false, internet: false }), "offline");
});

const fakeFetch = (status: number): typeof fetch =>
  (async () => new Response("Success", { status })) as unknown as typeof fetch;

test("internetReachable true on 200", async () => {
  assert.equal(await internetReachable({ fetchImpl: fakeFetch(200) }), true);
});

test("internetReachable false on non-200 (captive portal redirect etc.)", async () => {
  assert.equal(await internetReachable({ fetchImpl: fakeFetch(302) }), false);
});

test("internetReachable false on network error (never throws)", async () => {
  const throwing = (async () => {
    throw new Error("ENOTFOUND");
  }) as unknown as typeof fetch;
  assert.equal(await internetReachable({ fetchImpl: throwing }), false);
});

test("internetReachable probes a public endpoint (guard bypass — connectivity, not tunnel)", async () => {
  let seen = "";
  const capturing = (async (url: string) => {
    seen = url;
    return new Response("Success", { status: 200 });
  }) as unknown as typeof fetch;
  await internetReachable({ fetchImpl: capturing });
  assert.match(seen, /captive\.apple\.com/); // public host reached (would be refused by the private guard)
});
