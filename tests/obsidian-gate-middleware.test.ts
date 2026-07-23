// Mandatory SOFT Obsidian gate — middleware wiring, in-process HTTP against the REAL exported
// app (server.ts), following the tests/routes-hardening.test.ts technique
// (http.createServer + :0, OLLAMAS_NO_AUTOBOOT=1, no vite/store boot).
//
// server/obsidian-rest.ts and server/orchestra-roles.ts are mocked OFFLINE so this proves the
// SOFT contract end-to-end: the gate attempts a vault write on every gated route, but an
// unreachable vault never blocks the request (no 500 caused by the gate itself, downstream
// handlers still run to their own natural outcome).
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";

vi.mock("../server/obsidian-rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/obsidian-rest")>();
  return { ...actual, vaultWrite: vi.fn().mockResolvedValue(false) };
});
vi.mock("../server/orchestra-roles", () => ({
  obsidianContribute: vi.fn().mockResolvedValue({ ok: false, findings: [], reason: "offline" }),
}));

let server: Server;
let base = "";
let db: typeof import("../server/db").db;
let vaultWrite: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  ({ db } = await import("../server/db"));
  ({ vaultWrite } = (await import("../server/obsidian-rest")) as unknown as { vaultWrite: ReturnType<typeof vi.fn> });
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

beforeEach(() => {
  vaultWrite.mockClear();
  db.data.permissions.obsidianGate = true;
});

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("obsidian gate middleware — SOFT, mounted on curated operation routes", () => {
  test("POST /api/generate: gate attempts a vault write, and an offline vault does not block the request", async () => {
    const res = await fetch(base + "/api/generate", postJson({}));
    // Empty body is invalid input for the downstream handler (400), but that 400 proves the
    // gate let the request through to its own handler rather than hanging or 500ing.
    expect(res.status).not.toBe(500);
    expect(vaultWrite).toHaveBeenCalledTimes(1);
  });

  test("a non-operation route (GET /api/health) does not trigger a vault write", async () => {
    await fetch(base + "/api/health");
    expect(vaultWrite).not.toHaveBeenCalled();
  });

  test("GET /api/keys/pool (read-only poll) does not trigger a vault write", async () => {
    await fetch(base + "/api/keys/pool");
    expect(vaultWrite).not.toHaveBeenCalled();
  });

  test("toggle off (db.data.permissions.obsidianGate = false) skips the gate entirely", async () => {
    db.data.permissions.obsidianGate = false;
    const res = await fetch(base + "/api/generate", postJson({}));
    expect(res.status).not.toBe(500);
    expect(vaultWrite).not.toHaveBeenCalled();
  });
});
