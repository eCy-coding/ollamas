import { describe, it, expect, vi, afterEach } from "vitest";
import { ecyBaseUrl, ecyTargetUrl, ecysearcherProxy, ecysearcherOfflineGate, ecyOfflinePayload } from "../server/ecysearcher-proxy";

describe("ecysearcher-proxy — pure URL helpers", () => {
  it("ecyBaseUrl default (remapped :5055) + env override (trailing slash stripped)", () => {
    expect(ecyBaseUrl({} as NodeJS.ProcessEnv)).toBe("http://localhost:5055");
    expect(ecyBaseUrl({ ECYSEARCHER_API_PORT: "5099" } as any)).toBe("http://localhost:5099");
    expect(ecyBaseUrl({ ECYSEARCHER_URL: "http://h:5050/" } as any)).toBe("http://h:5050");
  });
  it("ecyTargetUrl joins base + sub-path (carrying the query string)", () => {
    expect(ecyTargetUrl("http://localhost:5000", "/api/search?q=x")).toBe("http://localhost:5000/api/search?q=x");
    expect(ecyTargetUrl("http://localhost:5000/", "api/threats")).toBe("http://localhost:5000/api/threats");
  });
});

function mockRes() {
  const r: any = { statusCode: 0, headers: {}, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.set = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}

describe("ecysearcherProxy — forward + graceful-down", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards the upstream status + body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200, text: async () => JSON.stringify({ ok: true }), headers: new Map([["content-type", "application/json"]]),
    })));
    const res = mockRes();
    await ecysearcherProxy({ method: "GET", url: "/api/search?q=x", headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true }));
  });

  it("returns an HONEST 502 when eCySearcher is down BUT the supervisor thinks it's running (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = mockRes();
    await ecysearcherProxy({ method: "GET", url: "/api/search", headers: {} } as any, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unreachable/i);
  });
});

describe("ecysearcherOfflineGate — circuit-breaker (no 502 flood when stack is down)", () => {
  it("short-circuits to a 200 offline payload when the supervisor is NOT running (never proxies)", () => {
    const res = mockRes();
    const next = vi.fn();
    ecysearcherOfflineGate(() => false)({ method: "GET", url: "/api/search" } as any, res, next);
    expect(next).not.toHaveBeenCalled();       // never reached the real proxy → no dead-upstream fetch → no 502
    expect(res.statusCode).toBe(200);          // benign "offline", so RUM won't count it as api_error
    expect(res.body.offline).toBe(true);
    expect(res.body.ready).toBe(false);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it("falls through to the proxy when the supervisor IS running", () => {
    const res = mockRes();
    const next = vi.fn();
    ecysearcherOfflineGate(() => true)({ method: "GET", url: "/api/search" } as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);     // real proxy handles it (may still 502 on a genuine fetch fault)
    expect(res.statusCode).toBe(0);            // gate wrote nothing
  });

  it("ecyOfflinePayload is a well-formed empty result for every consumer", () => {
    const p = ecyOfflinePayload();
    expect(p).toMatchObject({ offline: true, ready: false, running: false, total: 0, analytics: null });
    expect(p.results).toEqual([]);
    expect(p.hits).toEqual([]);
  });
});
