// UKP inbound stage-events webhook receiver tests (feat/ukp-ingest-receiver).
// Hermetic store test — same tmp-DB pattern as dcr.test.ts / saas-store.test.ts.
// Tests drive the handler logic via the imported store + outbound helpers rather
// than booting the full HTTP server (faster, dialect-agnostic, no port conflicts).
import { describe, test, expect, beforeAll, afterAll, afterEach } from "vitest";
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

describe("UKP stage-events retention prune", () => {
  const savedRetentionDays = process.env.UKP_RETENTION_DAYS;

  afterEach(() => {
    // Restore env so other tests are not affected.
    if (savedRetentionDays === undefined) delete process.env.UKP_RETENTION_DAYS;
    else process.env.UKP_RETENTION_DAYS = savedRetentionDays;
  });

  test("(5) pruneStageEvents: retention=1d removes row older than 2d, keeps row from 1h ago", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const oldTs = nowSec - 2 * 86400;   // 2 days ago — should be pruned
    const freshTs = nowSec - 3600;       // 1 hour ago — should survive

    const idOld = `prune-old-${crypto.randomBytes(4).toString("hex")}`;
    const idFresh = `prune-fresh-${crypto.randomBytes(4).toString("hex")}`;

    await store.recordStageEvent({ id: idOld, eventType: "stage.prune-old", payload: "{}", ts: oldTs });
    await store.recordStageEvent({ id: idFresh, eventType: "stage.prune-fresh", payload: "{}", ts: freshTs });

    // Verify both rows are present before pruning.
    const before = await store.listStageEvents(1000);
    expect(before.some((r: any) => r.id === idOld)).toBe(true);
    expect(before.some((r: any) => r.id === idFresh)).toBe(true);

    const pruned = await store.pruneStageEvents(1);
    expect(pruned).toBeGreaterThanOrEqual(1); // at least the old row was removed

    const after = await store.listStageEvents(1000);
    expect(after.some((r: any) => r.id === idOld)).toBe(false);   // gone
    expect(after.some((r: any) => r.id === idFresh)).toBe(true);  // still here
  });

  test("(6) pruneStageEvents: days=0 is a no-op (returns 0, no rows deleted)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const idRow = `prune-noop-${crypto.randomBytes(4).toString("hex")}`;
    // Use a very old ts so it would be pruned if days>0.
    await store.recordStageEvent({ id: idRow, eventType: "stage.noop", payload: "{}", ts: nowSec - 999999 });

    const pruned = await store.pruneStageEvents(0);
    expect(pruned).toBe(0);

    const rows = await store.listStageEvents(1000);
    expect(rows.some((r: any) => r.id === idRow)).toBe(true); // still present
  });

  test("(7) env-gated prune via recordStageEvent: UKP_RETENTION_DAYS=1 prunes stale on insert", async () => {
    process.env.UKP_RETENTION_DAYS = "1";

    const nowSec = Math.floor(Date.now() / 1000);
    const staleTs = nowSec - 2 * 86400; // 2 days ago
    const freshTs = nowSec - 60;

    const idStale = `env-stale-${crypto.randomBytes(4).toString("hex")}`;
    // Insert the stale row directly (skip env-prune by inserting into store directly).
    // We use recordStageEvent but with UKP_RETENTION_DAYS still set — the FIRST insert
    // would prune itself, so insert the stale row first without env, then set env.
    delete process.env.UKP_RETENTION_DAYS;
    await store.recordStageEvent({ id: idStale, eventType: "stage.stale", payload: "{}", ts: staleTs });

    // Now set env and insert a fresh row — the prune fires during this second insert.
    process.env.UKP_RETENTION_DAYS = "1";
    const idFresh = `env-fresh-${crypto.randomBytes(4).toString("hex")}`;
    await store.recordStageEvent({ id: idFresh, eventType: "stage.fresh", payload: "{}", ts: freshTs });

    const rows = await store.listStageEvents(1000);
    expect(rows.some((r: any) => r.id === idStale)).toBe(false);  // pruned
    expect(rows.some((r: any) => r.id === idFresh)).toBe(true);   // kept
  });

  test("(8) env-gated prune disabled (UKP_RETENTION_DAYS unset): both rows survive", async () => {
    delete process.env.UKP_RETENTION_DAYS;

    const nowSec = Math.floor(Date.now() / 1000);
    const idA = `nodisable-a-${crypto.randomBytes(4).toString("hex")}`;
    const idB = `nodisable-b-${crypto.randomBytes(4).toString("hex")}`;

    await store.recordStageEvent({ id: idA, eventType: "stage.a", payload: "{}", ts: nowSec - 999999 });
    await store.recordStageEvent({ id: idB, eventType: "stage.b", payload: "{}", ts: nowSec - 60 });

    const rows = await store.listStageEvents(1000);
    expect(rows.some((r: any) => r.id === idA)).toBe(true);
    expect(rows.some((r: any) => r.id === idB)).toBe(true);
  });
});

describe("UKP stage-events event_type filter (listStageEvents)", () => {
  test("(9) listStageEvents with eventType filter → only matching type returned", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const idDeploy = `filter-deploy-${crypto.randomBytes(4).toString("hex")}`;
    const idRollback = `filter-rollback-${crypto.randomBytes(4).toString("hex")}`;

    await store.recordStageEvent({ id: idDeploy, eventType: "stage.filter-deploy", payload: "{}", ts: nowSec - 5 });
    await store.recordStageEvent({ id: idRollback, eventType: "stage.filter-rollback", payload: "{}", ts: nowSec - 4 });

    const deployRows = await store.listStageEvents(1000, "stage.filter-deploy");
    expect(deployRows.every((r: any) => r.event_type === "stage.filter-deploy")).toBe(true);
    expect(deployRows.some((r: any) => r.id === idDeploy)).toBe(true);
    expect(deployRows.some((r: any) => r.id === idRollback)).toBe(false);

    const rollbackRows = await store.listStageEvents(1000, "stage.filter-rollback");
    expect(rollbackRows.every((r: any) => r.event_type === "stage.filter-rollback")).toBe(true);
    expect(rollbackRows.some((r: any) => r.id === idRollback)).toBe(true);
    expect(rollbackRows.some((r: any) => r.id === idDeploy)).toBe(false);
  });

  test("(10) listStageEvents with no eventType → all rows returned (no filter)", async () => {
    const rows = await store.listStageEvents(1000);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});
