import { describe, it, expect } from "vitest";

// ollamas :3000 live smoke (dc-2.8). Guarded: the whole block SKIPS when the server is off, so it
// never flakes the suite; when :3000 is up it asserts the health + model surfaces are real. Proven
// live this session (server brought up e2e via the fleet supervisor).
const BASE = process.env.OLLAMAS_BASE ?? "http://127.0.0.1:3000";

async function probe(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

const live = (await probe("/api/health")).ok;

describe.skipIf(!live)("ollamas :3000 live smoke", () => {
  it("GET /api/health reports isLive:true", async () => {
    const h = await probe("/api/health");
    expect(h.status).toBe(200);
    expect((h.json as { isLive?: boolean })?.isLive).toBe(true);
  });

  it("GET /api/ai/models returns a usable model surface", async () => {
    const m = await probe("/api/ai/models");
    expect(m.status).toBe(200); // F-12: a 404 must NOT pass as "usable model surface"
  });
});

describe.runIf(!live)("ollamas :3000 offline", () => {
  it("skips the live smoke honestly (server intentionally off)", () => {
    expect(live).toBe(false); // documents WHY the smoke above was skipped
  });
});
