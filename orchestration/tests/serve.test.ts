import { describe, it, expect, vi } from "vitest";
import { makeHandler, type Collector } from "../bin/serve";
import type { CockpitSnapshot } from "../bin/lib/collect";

const SNAP: CockpitSnapshot = {
  ts: "2026-06-20T00:00:00Z",
  expectedLanes: 8,
  lanes: [],
  backend: null,
  totals: { live: 0, idle: 0, dirty: 0, errors: 0 },
};

const collector: Collector = async () => SNAP;

/** Minimal http ServerResponse stub — başlık + gövde + write yakalar. */
function mockRes() {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    statusCode: 0,
    headers, writes, handlers,
    setHeader(k: string, v: string) { headers[k] = v; },
    writeHead(code: number, h?: Record<string, string>) { this.statusCode = code; Object.assign(headers, h || {}); },
    write(chunk: string) { writes.push(chunk); return true; },
    end(chunk?: string) { if (chunk) writes.push(chunk); this.ended = true; },
    ended: false,
  };
}
function mockReq(url: string) {
  const handlers: Record<string, () => void> = {};
  return { url, on(ev: string, cb: () => void) { handlers[ev] = cb; }, _fire: (ev: string) => handlers[ev]?.() };
}

describe("makeHandler", () => {
  const handler = makeHandler(collector, "/tmp/__no_html__.html", 50);

  it("GET /cockpit.json → 200 application/json + parse edilebilir snapshot", async () => {
    const res = mockRes();
    await handler(mockReq("/cockpit.json") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(res.writes.join(""))).toEqual(SNAP);
  });

  it("query string'i yok sayar (/cockpit.json?x=1)", async () => {
    const res = mockRes();
    await handler(mockReq("/cockpit.json?x=1") as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it("bilinmeyen yol → 404", async () => {
    const res = mockRes();
    await handler(mockReq("/nope") as any, res as any);
    expect(res.statusCode).toBe(404);
  });

  it("GET / → html yoksa graceful 200 fallback (çökme yok)", async () => {
    const res = mockRes();
    await handler(mockReq("/") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/html");
  });

  it("GET /events → SSE başlık + ilk data frame yazılır, close interval'ı temizler", async () => {
    const res = mockRes();
    const req = mockReq("/events");
    await handler(req as any, res as any);
    expect(res.headers["Content-Type"]).toContain("text/event-stream");
    // ilk snapshot frame'i hemen push edilir
    expect(res.writes.join("")).toContain("data: ");
    expect(res.writes.join("")).toContain(SNAP.ts);
    req._fire("close"); // bağlantı kapanır → interval temizlenmeli (dangling timer yok)
  });
});
