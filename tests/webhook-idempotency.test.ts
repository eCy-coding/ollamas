import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// H6: handleWebhook marked the event 'seen' BEFORE running the handler, so a handler
// failure (e.g. setTenantPlan throwing) consumed the event permanently — Stripe's retry
// then skipped it. The fix marks seen only AFTER the handler succeeds.
vi.mock("stripe", () => ({
  default: class FakeStripe {
    // echo the raw body back as the parsed event (signature check bypassed for the test)
    webhooks = { constructEvent: (raw: Buffer | string) => JSON.parse(String(raw)) };
  },
}));

const DB = path.join(os.tmpdir(), `ollamas-whkidem-${process.pid}.db`);
let store: typeof import("../server/store/index");
let billing: typeof import("../server/billing/stripe");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  process.env.STRIPE_API_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  store = await import("../server/store/index");
  billing = await import("../server/billing/stripe");
  await store.initStore();
});
afterAll(() => {
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

const evt = (id: string, planId: string, tenantId: string) =>
  Buffer.from(JSON.stringify({
    id, type: "customer.subscription.updated",
    data: { object: { metadata: { tenantId, planId }, customer: "cus_x" } },
  }));

describe("stripe webhook idempotency (H6)", () => {
  test("an unknown-plan event is CLAIMED (consumed) so Stripe does not redeliver it forever", async () => {
    const t = await store.createTenant("whtenant", "pro");
    const r = await billing.handleWebhook(evt("evt_fail", "nonexistent_plan", t.id), "sig");
    expect(r.handled).toBe(false); // setTenantPlan throws "Unknown plan" — structurally unprocessable
    expect(await store.stripeEventSeen("evt_fail")).toBe(true); // consumed → no infinite retry storm (transient errors instead RELEASE)
  });

  test("a SUCCESSFUL handling consumes the event (dedup) and a re-delivery is a no-op", async () => {
    const t = await store.createTenant("whtenant2", "free");
    const r1 = await billing.handleWebhook(evt("evt_ok", "pro", t.id), "sig");
    expect(r1.handled).toBe(true);
    expect(await store.stripeEventSeen("evt_ok")).toBe(true); // consumed
    const r2 = await billing.handleWebhook(evt("evt_ok", "pro", t.id), "sig");
    expect(r2.handled).toBe(false); // second delivery skipped
  });

  test("claimStripeEvent dedups concurrent deliveries; releaseStripeEvent re-opens it", async () => {
    // Batch-1 TOCTOU fix: the claim is atomic (INSERT ON CONFLICT) so only ONE of two
    // concurrent deliveries/replicas runs the side effects; the loser no-ops. A transient
    // failure releases the claim so Stripe can retry.
    expect(await store.claimStripeEvent("evt_dup")).toBe(true);  // first claim wins
    expect(await store.claimStripeEvent("evt_dup")).toBe(false); // concurrent duplicate loses
    await store.releaseStripeEvent("evt_dup");                   // transient-failure release
    expect(await store.claimStripeEvent("evt_dup")).toBe(true);  // claimable again (retry)
  });
});
