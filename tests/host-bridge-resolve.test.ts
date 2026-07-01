import { describe, test, expect, beforeEach } from "vitest";
import { resolveBridgeBase, _resetBridgeBaseForTest } from "../server/host-bridge";

// concurrency-safety: cold-start base discovery is single-flighted — N concurrent callers share ONE
// probe sequence (no redundant probes, no race on the cached base).
describe("resolveBridgeBase — single-flighted cold-start discovery", () => {
  beforeEach(() => _resetBridgeBaseForTest());

  test("concurrent callers → probe runs ONCE, all resolve to the same reachable base", async () => {
    let probes = 0;
    const cands = ["http://a:1", "http://b:2"];
    // 'a' is unreachable (throws), 'b' answers → reachable
    const fetchMock = (async (url: any) => {
      probes++;
      if (String(url).startsWith("http://a:1")) throw new Error("ECONNREFUSED");
      return new Response("ok", { status: 404 }); // any HTTP response = reachable
    }) as unknown as typeof fetch;

    const [r1, r2, r3] = await Promise.all([
      resolveBridgeBase(cands, fetchMock),
      resolveBridgeBase(cands, fetchMock),
      resolveBridgeBase(cands, fetchMock),
    ]);
    expect([r1, r2, r3]).toEqual(["http://b:2", "http://b:2", "http://b:2"]);
    expect(probes).toBe(2); // one shared sequence (a fails, b ok) — NOT 3×2=6
  });

  test("once resolved, later calls return the cached base without probing", async () => {
    let probes = 0;
    const fetchMock = (async () => { probes++; return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    await resolveBridgeBase(["http://x:9"], fetchMock);
    const again = await resolveBridgeBase(["http://x:9"], fetchMock);
    expect(again).toBe("http://x:9");
    expect(probes).toBe(1); // cached → no second probe
  });

  test("none reachable → null (request loop surfaces the real error)", async () => {
    const fetchMock = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await resolveBridgeBase(["http://none:1"], fetchMock)).toBeNull();
  });
});
