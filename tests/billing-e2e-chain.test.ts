import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// M-017 — billing e2e chain (test-mode, hermetic): the full revenue path in one
// suite — checkout link → signed webhook (real constructEvent via a real Stripe
// signature) → per-call meter event → period rollup (BillingRun/BillingLine).
//
// Hermetic strategy: the Stripe SDK is mocked so NO network is touched, BUT the
// `webhooks` sub-API delegates to the REAL Stripe implementation. That makes the
// signature round-trip authentic — `generateTestHeaderString` signs a payload and
// `constructEvent` verifies it with the same HMAC secret, exactly like production.
// Checkout + meter calls are stubbed (they'd otherwise hit Stripe's API).

const { meterCreate, checkoutCreate } = vi.hoisted(() => ({
  meterCreate: vi.fn(async (_params: any) => ({})),
  checkoutCreate: vi.fn(async (_params: any) => ({ url: "https://checkout.stripe.test/s/e2e" })),
}));

vi.mock("stripe", async () => {
  // Real SDK: used ONLY for authentic webhook signing/verification (crypto HMAC).
  const actual = await vi.importActual<any>("stripe");
  const RealStripe = actual.default;
  class FakeStripe {
    webhooks: any;
    checkout = { sessions: { create: checkoutCreate } };
    billing = { meterEvents: { create: meterCreate } };
    constructor(key: string) {
      // Delegate webhook verification to the genuine implementation.
      this.webhooks = new RealStripe(key).webhooks;
    }
  }
  return { default: FakeStripe };
});

// Rollup state the store would hold: one tenant with 7 metered calls this period.
const invoiceRows: Array<{ tenantId: string; period: string; amount: number }> = [];
let planSet: { tenantId: string; planId: string } | null = null;

vi.mock("../server/store", () => ({
  getTenant: vi.fn(async (id: string) =>
    id === "tnt_billed" ? { id: "tnt_billed", stripe_customer_id: "cus_x" } : null
  ),
  getTenantByStripeCustomer: vi.fn(async () => null),
  setTenantStripeCustomer: vi.fn(async () => {}),
  setTenantPlan: vi.fn(async (tenantId: string, planId: string) => {
    planSet = { tenantId, planId };
  }),
  aggregateUsage: vi.fn(async () => [{ tenantId: "tnt_billed", calls: 7 }]),
  recordInvoice: vi.fn(async (tenantId: string, period: string, amount: number) => {
    invoiceRows.push({ tenantId, period, amount });
    return { created: true };
  }),
  getBillingConfig: vi.fn(async () => ""),
  setBillingConfig: vi.fn(async () => {}),
  stripeEventSeen: vi.fn(async () => false),
  queueWebhookEvent: vi.fn(async () => {}),
  monthKey: () => "2026-07",
}));

import { createAuditCheckout, handleWebhook, sendMeterEventAsync, runBilling } from "../server/billing/stripe";
import Stripe from "stripe"; // mocked default — its webhooks is real (see FakeStripe)

const WEBHOOK_SECRET = "whsec_test_e2e";

beforeEach(() => {
  process.env.STRIPE_API_KEY = "sk_test_hermetic";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  meterCreate.mockClear();
  checkoutCreate.mockClear();
  invoiceRows.length = 0;
  planSet = null;
});
afterEach(() => {
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("billing e2e chain (M-017)", () => {
  it("runs checkout → signed webhook → meter → tenant rollup end-to-end", async () => {
    // 1) CHECKOUT — mint a hosted payment link for a deliverable.
    const url = await createAuditCheckout({ amountCents: 30000, description: "Verified Audit" });
    expect(url).toBe("https://checkout.stripe.test/s/e2e");
    expect(checkoutCreate).toHaveBeenCalledTimes(1);

    // 2) WEBHOOK — Stripe notifies a subscription change. Sign the payload with a
    //    real Stripe signature so handleWebhook's constructEvent genuinely verifies it.
    const eventBody = JSON.stringify({
      id: "evt_e2e_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_e2e",
          customer: "cus_x",
          metadata: { tenantId: "tnt_billed", planId: "pro" },
        },
      },
    });
    const signature = (Stripe as any).prototype
      ? new (Stripe as any)("sk_test_hermetic").webhooks.generateTestHeaderString({
          payload: eventBody,
          secret: WEBHOOK_SECRET,
        })
      : "";
    const result = await handleWebhook(Buffer.from(eventBody), signature);
    expect(result.type).toBe("customer.subscription.updated");
    expect(result.handled).toBe(true);
    expect(planSet).toEqual({ tenantId: "tnt_billed", planId: "pro" });

    // 3) METER — a real-time per-call usage event is emitted for the tenant.
    sendMeterEventAsync("tnt_billed", 3);
    await vi.waitFor(() => expect(meterCreate).toHaveBeenCalledTimes(1));
    expect((meterCreate.mock.calls[0][0] as any).payload.value).toBe("3");

    // 4) ROLLUP — the period run aggregates usage into a BillingLine and pushes a
    //    (tenant, period)-idempotent metered event.
    const run = await runBilling("2026-07");
    expect(run.dryRun).toBe(false);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0].tenantId).toBe("tnt_billed");
    expect(run.lines[0].amount).toBe(7); // 7 calls * UNIT_PRICE(1)
    expect(run.total).toBe(7);
    expect(invoiceRows).toEqual([{ tenantId: "tnt_billed", period: "2026-07", amount: 7 }]);

    // Rollup pushed exactly one more meter event (period), idempotency-keyed by (tenant, period).
    const rollupCall = meterCreate.mock.calls.find(
      (c) => (c[0] as any).identifier === "tnt_billed-2026-07"
    );
    expect(rollupCall).toBeTruthy();
    expect((rollupCall![0] as any).payload.value).toBe("7");
  });

  it("rejects a webhook with a tampered signature (chain is authentically verified)", async () => {
    const body = JSON.stringify({ id: "evt_bad", type: "invoice.paid", data: { object: {} } });
    await expect(handleWebhook(Buffer.from(body), "t=1,v1=deadbeef")).rejects.toThrow(/signature/i);
  });
});
