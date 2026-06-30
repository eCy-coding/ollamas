import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hermetic: mock the Stripe SDK + the store so no network / real key is needed.
vi.mock("stripe", () => {
  class FakeStripe {
    webhooks = {
      constructEvent: (_body: Buffer, sig: string, _secret: string) => {
        if (sig === "bad") throw new Error("Webhook signature verification failed");
        return { id: "evt_1", type: "invoice.paid", data: { object: {} } };
      },
    };
    checkout = { sessions: { create: async () => ({ url: "https://checkout.stripe.test/s/1" }) } };
  }
  return { default: FakeStripe };
});
vi.mock("../server/store", () => ({
  stripeEventSeen: vi.fn(async () => false),
  aggregateUsage: vi.fn(async () => []),
  recordInvoice: vi.fn(async () => ({ created: true })),
  setTenantPlan: vi.fn(async () => {}),
  getTenant: vi.fn(async () => null),
  getTenantByStripeCustomer: vi.fn(async () => null),
  setTenantStripeCustomer: vi.fn(async () => {}),
  getBillingConfig: vi.fn(async () => ""),
  setBillingConfig: vi.fn(async () => {}),
  queueWebhookEvent: vi.fn(async () => {}),
  monthKey: () => "2026-06",
}));

import { isLive, createAuditCheckout, handleWebhook } from "../server/billing/stripe";

beforeEach(() => {
  process.env.STRIPE_API_KEY = "sk_test_hermetic";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});
afterEach(() => {
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("stripe — live with a (mocked) key", () => {
  it("isLive() true once a key is present", () => {
    expect(isLive()).toBe(true);
  });
  it("createAuditCheckout mints a hosted Checkout URL", async () => {
    const url = await createAuditCheckout({ amountCents: 30000, description: "Verified Audit" });
    expect(url).toBe("https://checkout.stripe.test/s/1");
  });
});

describe("stripe — webhook signature + idempotency", () => {
  it("rejects a bad signature (throws)", async () => {
    await expect(handleWebhook(Buffer.from("{}"), "bad")).rejects.toThrow(/signature/i);
  });
  it("accepts a valid signature + handles invoice.paid", async () => {
    const r = await handleWebhook(Buffer.from("{}"), "good");
    expect(r.type).toBe("invoice.paid");
    expect(r.handled).toBe(true);
  });
  it("throws when not configured (no key/secret)", async () => {
    delete process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(handleWebhook(Buffer.from("{}"), "good")).rejects.toThrow(/not configured/i);
  });
});
