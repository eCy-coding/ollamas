import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// H2: usage was reported to the SAME Stripe meter ("ollamas_tool_calls", sum) by BOTH
// the real-time per-call sendMeterEventAsync AND runBilling's period-total push → every
// call billed twice. runBilling must no longer push to the meter (ledger only).
const { meterCreate } = vi.hoisted(() => ({ meterCreate: vi.fn().mockResolvedValue({}) }));
vi.mock("stripe", () => ({
  default: class FakeStripe {
    billing = { meterEvents: { create: meterCreate }, meters: { create: vi.fn().mockResolvedValue({ id: "mtr_x" }) } };
    customers = { create: vi.fn().mockResolvedValue({ id: "cus_x" }) };
    products = { create: vi.fn().mockResolvedValue({ id: "prod_x" }) };
    prices = { create: vi.fn().mockResolvedValue({ id: "price_x" }) };
  },
}));

const DB = path.join(os.tmpdir(), `ollamas-billing-${process.pid}.db`);
let store: typeof import("../server/store/index");
let billing: typeof import("../server/billing/stripe");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  process.env.STRIPE_API_KEY = "sk_test_fake"; // makes getStripe() return the mock
  store = await import("../server/store/index");
  billing = await import("../server/billing/stripe");
  await store.initStore();
});
afterAll(() => {
  delete process.env.STRIPE_API_KEY;
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("billing — no double meter push (H2)", () => {
  test("runBilling rolls up usage + records the invoice but does NOT push to the Stripe meter", async () => {
    const t = await store.createTenant("billco", "pro", "cus_fake123"); // tenant has a stripe customer
    for (let i = 0; i < 3; i++) {
      await store.recordUsage({ tenantId: t.id, tool: "list_tree", tier: "safe", ok: true, latencyMs: 1, tokens: 0, cost: 0 });
    }
    meterCreate.mockClear();

    const run = await billing.runBilling();
    const line = run.lines.find((l) => l.tenantId === t.id);
    expect(line?.calls).toBe(3); // usage rolled up correctly
    // The meter is fed in real time by sendMeterEventAsync; runBilling pushing the
    // period total here would bill those 3 calls a SECOND time.
    expect(meterCreate).not.toHaveBeenCalled();
  });
});
