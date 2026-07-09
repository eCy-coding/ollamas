import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GW-2 gateway verify (v1.29.3): Stripe metering payload correctness.
// Hermetic — the Stripe SDK + the store are mocked so no network / real key is
// touched. Focus is the *metered usage* path (sendMeterEventAsync + runBilling):
// event_name, idempotency identifier, and the quantity/value shape Stripe bills on.
// (Webhook + checkout paths are covered by tests/server-stripe-webhook.test.ts.)

const { meterCreate } = vi.hoisted(() => ({ meterCreate: vi.fn(async (_params: any) => ({})) }));

vi.mock("stripe", () => {
  class FakeStripe {
    billing = {
      meterEvents: { create: meterCreate },
      meters: { create: async () => ({ id: "mtr_1" }) },
    };
    products = { create: async () => ({ id: "prod_1" }) };
    prices = { create: async () => ({ id: "price_1" }) };
    customers = { create: async () => ({ id: "cus_new" }) };
  }
  return { default: FakeStripe };
});

vi.mock("../store", () => ({
  getTenant: vi.fn(async (id: string) =>
    id === "tnt_billed" ? { id: "tnt_billed", stripe_customer_id: "cus_x" } : null
  ),
  aggregateUsage: vi.fn(async () => [{ tenantId: "tnt_billed", calls: 7 }]),
  recordInvoice: vi.fn(async () => ({ created: true })),
  getBillingConfig: vi.fn(async () => ""),
  setBillingConfig: vi.fn(async () => {}),
  setTenantStripeCustomer: vi.fn(async () => {}),
  getTenantByStripeCustomer: vi.fn(async () => null),
  setTenantPlan: vi.fn(async () => {}),
  stripeEventSeen: vi.fn(async () => false),
  queueWebhookEvent: vi.fn(async () => {}),
  monthKey: () => "2026-07",
}));

import { sendMeterEventAsync, runBilling, computeRun } from "../billing/stripe";

beforeEach(() => {
  process.env.STRIPE_API_KEY = "sk_test_hermetic";
  meterCreate.mockClear();
});
afterEach(() => {
  delete process.env.STRIPE_API_KEY;
});

describe("stripe metering — sendMeterEventAsync (real-time per-call)", () => {
  it("emits a meter event with the right name, customer, and quantity", async () => {
    sendMeterEventAsync("tnt_billed", 3);
    await vi.waitFor(() => expect(meterCreate).toHaveBeenCalledTimes(1));
    const arg = meterCreate.mock.calls[0][0] as any;
    expect(arg.event_name).toBe("ollamas_tool_calls");
    expect(arg.payload.stripe_customer_id).toBe("cus_x");
    // Stripe meter value is a STRING (SDK requirement) carrying the quantity.
    expect(arg.payload.value).toBe("3");
    // Idempotency identifier is namespaced by tenant so Stripe's 24h dedup is per-tenant.
    expect(typeof arg.identifier).toBe("string");
    expect(arg.identifier.startsWith("tnt_billed:")).toBe(true);
  });

  it("defaults quantity to 1 when omitted", async () => {
    sendMeterEventAsync("tnt_billed");
    await vi.waitFor(() => expect(meterCreate).toHaveBeenCalledTimes(1));
    expect((meterCreate.mock.calls[0][0] as any).payload.value).toBe("1");
  });

  it("is a no-op for a tenant without a Stripe customer", async () => {
    sendMeterEventAsync("tnt_unknown", 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(meterCreate).not.toHaveBeenCalled();
  });

  it("is a no-op with no Stripe key configured", async () => {
    delete process.env.STRIPE_API_KEY;
    sendMeterEventAsync("tnt_billed", 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(meterCreate).not.toHaveBeenCalled();
  });
});

describe("stripe metering — runBilling (period rollup)", () => {
  it("pushes one metered event per billed line with value = summed calls", async () => {
    const run = await runBilling("2026-07");
    expect(run.dryRun).toBe(false);
    expect(meterCreate).toHaveBeenCalledTimes(1);
    const arg = meterCreate.mock.calls[0][0] as any;
    expect(arg.event_name).toBe("ollamas_tool_calls");
    expect(arg.identifier).toBe("tnt_billed-2026-07"); // (tenant, period) idempotency key
    expect(arg.payload.stripe_customer_id).toBe("cus_x");
    expect(arg.payload.value).toBe("7");
  });

  it("computeRun reports dryRun=false and the correct billed total when live", async () => {
    const run = await computeRun("2026-07");
    expect(run.dryRun).toBe(false);
    expect(run.total).toBe(7); // 7 calls * UNIT_PRICE(1)
    expect(run.lines[0].amount).toBe(7);
  });
});
