// LIVE-HTTP test for POST /api/ingest/stage-events.
// Boots the real server (same pattern as conformance.e2e.test.ts) and drives the
// route over real HTTP to prove: raw-body parser ordering, route reachability,
// HMAC signing/verification, idempotency dedup — all wired end-to-end.
// Zero new dependencies; uses node:child_process + native fetch.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { signWebhook } from "../server/webhooks/outbound";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.TEST_UKP_HTTP_PORT || 3987);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-ukp-http-${process.pid}.db`);
const ADMIN = "test-admin-token-ukp";
const UKP_SECRET = "test_ukp_secret";

let child: ChildProcess;

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not become healthy in time");
}

beforeAll(async () => {
  child = spawn("npx", ["tsx", "server.ts"], {
    cwd: ROOT,
    detached: true,
    env: {
      ...process.env,
      PORT: String(PORT),
      // UKP ingest enabled with known secret.
      UKP_WEBHOOK_SECRET: UKP_SECRET,
      // Same SAAS vars conformance uses so the server boots cleanly.
      SAAS_ENFORCE: "1",
      SAAS_ADMIN_TOKEN: ADMIN,
      SAAS_DB_PATH: DB,
      HOST_BRIDGE_URL: "http://127.0.0.1:9",
    },
    stdio: "ignore",
  });
  await waitForHealth();
}, 40000);

afterAll(() => {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {}
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
});

/** POST /api/ingest/stage-events with the given body and signature header. */
async function postIngest(body: string, sigHeader: string) {
  return fetch(`${BASE}/api/ingest/stage-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ukp-Signature": sigHeader,
    },
    body,
  });
}

describe("UKP stage-events live HTTP", () => {
  test("(1) valid signed POST → 200 + {ok:true, recorded:true}", async () => {
    const body = JSON.stringify({
      type: "stage.dogrula",
      ts: Math.floor(Date.now() / 1000),
      data: { jobId: "j1" },
    });
    const sig = signWebhook(UKP_SECRET, body);

    const res = await postIngest(body, sig);
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, recorded: true });
  });

  test("(2) tampered body (signed original, send different body) → 401", async () => {
    const originalBody = JSON.stringify({ type: "stage.legit", ts: Math.floor(Date.now() / 1000) });
    const sig = signWebhook(UKP_SECRET, originalBody);
    // Send a different body — HMAC covers the original, so verification must fail.
    const tamperedBody = JSON.stringify({ type: "stage.TAMPERED", ts: Math.floor(Date.now() / 1000) });

    const res = await postIngest(tamperedBody, sig);
    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ error: "invalid signature" });
  });

  test("(3) replay: same signed body twice → first recorded:true, second recorded:false", async () => {
    const body = JSON.stringify({
      type: "stage.replay",
      ts: Math.floor(Date.now() / 1000),
      data: { jobId: "replay-test" },
    });
    // Use a fixed timestamp so both requests produce the same deterministic id
    // (sha256(tStr.body)). We sign once and send the exact same body+header twice.
    const nowMs = Date.now();
    const sig = signWebhook(UKP_SECRET, body, nowMs);

    const res1 = await postIngest(body, sig);
    expect(res1.status).toBe(200);
    const j1 = await res1.json() as Record<string, unknown>;
    expect(j1).toMatchObject({ ok: true, recorded: true });

    const res2 = await postIngest(body, sig);
    expect(res2.status).toBe(200);
    const j2 = await res2.json() as Record<string, unknown>;
    // Same id → ON CONFLICT(id) DO NOTHING → recorded:false (idempotency).
    expect(j2).toMatchObject({ ok: true, recorded: false });
  });

  test("(4) missing/garbage signature header → 401", async () => {
    const body = JSON.stringify({ type: "stage.nosig", ts: Math.floor(Date.now() / 1000) });

    const res = await postIngest(body, "garbage-not-a-valid-sig");
    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ error: "invalid signature" });
  });
});
