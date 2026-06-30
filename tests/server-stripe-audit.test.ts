import { describe, it, expect } from "vitest";
import { dollarsToCents, isLive, createAuditCheckout } from "../server/billing/stripe";

describe("stripe — dollarsToCents (pure, Stripe-min clamp)", () => {
  it("converts dollars → integer cents", () => {
    expect(dollarsToCents(300)).toBe(30000);
    expect(dollarsToCents(4.5)).toBe(450);
  });
  it("clamps to the ~$0.50 Stripe minimum + tolerates junk", () => {
    expect(dollarsToCents(0)).toBe(50);
    expect(dollarsToCents(0.1)).toBe(50);
    expect(dollarsToCents(NaN)).toBe(50);
  });
  it("rounds fractional cents", () => {
    expect(dollarsToCents(2.5)).toBe(250);
    expect(dollarsToCents(9.99)).toBe(999);
  });
});

describe("stripe — audit checkout graceful without a key", () => {
  it("isLive() is false when no Stripe key is in the vault or env (test env)", () => {
    delete process.env.STRIPE_API_KEY;
    expect(isLive()).toBe(false);
  });
  it("createAuditCheckout returns null (graceful) without a key", async () => {
    delete process.env.STRIPE_API_KEY;
    expect(await createAuditCheckout({ amountCents: 30000, description: "x" })).toBeNull();
  });
});
