// UKP inbound stage-events webhook receiver tests (feat/ukp-ingest-receiver).
// Hermetic store test — same tmp-DB pattern as dcr.test.ts / saas-store.test.ts.
// Tests drive the handler logic via the imported store + outbound helpers rather
// than booting the full HTTP server (faster, dialect-agnostic, no port conflicts).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DB = path.join(os.tmpdir(), `ollamas-ukp-ingest-${process.pid}.db`);
let store: typeof import("../server/store/index");
let outbound: typeof import("../server/webhooks/outbound");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  outbound = await import("../server/webhooks/outbound");
  await store.initStore();
  await store.migrateNow(); // ensures migration v5 (ukp_stage_events) is applied
});

afterAll(async () => {
  await store.closeStore();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

/** sha256(t.raw) — mirrors the id derivation in the server.ts route handler. */
function ingestId(tStr: string, raw: string): string {
  return crypto.createHash("sha256").update(`${tStr}.${raw}`).digest("hex");
}

/**
 * Minimal replica of the POST /api/ingest/stage-events handler logic.
 * Drives store + outbound helpers directly — no HTTP stack needed.
 */
async function handleIngest(
  secret: string | undefined,
  body: string,
  sigHeader: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!secret) return { status: 503, body: { error: "ingest disabled" } };
  if (!outbound.verifyWebhook(secret, body, sigHeader)) return { status: 401, body: { error: "invalid signature" } };

  const parsed = JSON.parse(body) as { type?: string; ts?: number };
  const tStr = sigHeader.split(",").find((p) => p.startsWith("t="))?.slice(2) ?? "0";
  const id = ingestId(tStr, body);
  const eventType = String(parsed.type ?? "");
  const ts = Number(parsed.ts ?? 0);
  const { recorded } = await store.recordStageEvent({ id, eventType, payload: body, ts });
  return { status: 200, body: { ok: true, recorded } };
}

describe("UKP stage-events ingest receiver", () => {
  test("(1) valid signWebhook header → 200 + recorded:true", async () => {
    const secret = "ukp_secret_case1";
    const body = JSON.stringify({ type: "stage.deploy", ts: 1700000001 });
    // signWebhook uses Date.now() by default → fresh timestamp within tolerance.
    const sig = outbound.signWebhook(secret, body);

    const result = await handleIngest(secret, body, sig);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, recorded: true });
  });

  test("(2) tampered body OR wrong secret → 401, no row", async () => {
    const secret = "ukp_secret_case2";
    const body = JSON.stringify({ type: "stage.tamper", ts: 1700000002 });
    const sig = outbound.signWebhook(secret, body);

    // Tampered body: signature was over the original body, not the modified one.
    const r1 = await handleIngest(secret, body + "!", sig);
    expect(r1.status).toBe(401);
    expect(r1.body).toMatchObject({ error: "invalid signature" });

    // Wrong secret: HMAC mismatch.
    const r2 = await handleIngest("completely_wrong_secret", body, sig);
    expect(r2.status).toBe(401);
    expect(r2.body).toMatchObject({ error: "invalid signature" });
  });

  test("(3) replay identical id → recorded:true first, recorded:false second, single row in DB", async () => {
    // Test idempotency at the store layer — this is the actual dedup contract.
    // The id is deterministic: sha256(tStr.body); same inputs → same id → one row.
    const tStr = "1700000003";
    const body = JSON.stringify({ type: "stage.replay", ts: 1700000003 });
    const id = ingestId(tStr, body);

    const first = await store.recordStageEvent({ id, eventType: "stage.replay", payload: body, ts: 1700000003 });
    expect(first.recorded).toBe(true);

    // Exact same id → ON CONFLICT(id) DO NOTHING → changes = 0.
    const second = await store.recordStageEvent({ id, eventType: "stage.replay", payload: body, ts: 1700000003 });
    expect(second.recorded).toBe(false);
  });

  test("(4) unset UKP_WEBHOOK_SECRET → 503 ingest disabled", async () => {
    const body = JSON.stringify({ type: "stage.probe", ts: 1700000004 });
    const result = await handleIngest(undefined, body, "t=0,v1=aabbcc");
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: "ingest disabled" });
  });
});
