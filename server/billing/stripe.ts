// Billing (AGENTS.md Faz 4). Metering already lands in usage_events (Faz 3);
// this rolls it up per tenant per period and reports it to Stripe as metered
// usage. Stripe is loaded lazily and only when STRIPE_API_KEY is set — without
// a key everything runs in dry-run so the gateway works with zero billing config.

import Stripe from "stripe";
import crypto from "node:crypto";
import { aggregateUsage, recordInvoice, setTenantPlan, getTenant, getTenantByStripeCustomer, setTenantStripeCustomer, getBillingConfig, setBillingConfig, claimStripeEvent, releaseStripeEvent, queueWebhookEvent, monthKey, type UsageAgg } from "../store";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const METER_EVENT_NAME = "ollamas_tool_calls";

// Price per tool call, in the smallest currency unit (e.g. cents). Override per deploy.
const UNIT_PRICE = Number(process.env.BILLING_UNIT_PRICE || 1);

export interface BillingLine extends UsageAgg {
  amount: number; // calls * UNIT_PRICE
}
export interface BillingRun {
  period: string;
  dryRun: boolean;
  lines: BillingLine[];
  total: number;
}

let stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_API_KEY;
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

export function isLive(): boolean {
  return !!getStripe();
}

/**
 * Per-call real-time meter event (Faz 10B). Fire-and-forget from the choke-point;
 * best-effort, never throws (logs on failure). No-op without Stripe / customer.
 * Idempotency via a unique identifier (tenant:ts:rand) — Stripe dedupes within 24h.
 */
export function sendMeterEventAsync(tenantId: string, value = 1): void {
  const s = getStripe();
  if (!s) return;
  (async () => {
    const customer = (await getTenant(tenantId))?.stripe_customer_id;
    if (!customer) return;
    // Crypto-random suffix (not Math.random): two meter events for the same tenant in
    // the same millisecond must not collide on `identifier`, or Stripe's 24h dedup
    // would silently drop one → undercounted usage.
    const identifier = `${tenantId}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
    await s.billing.meterEvents.create({
      event_name: METER_EVENT_NAME, identifier,
      payload: { stripe_customer_id: customer, value: String(value) },
    });
  })().catch((e: any) => console.warn(`[Meter] ${tenantId}: ${e?.message || e}`));
}

/**
 * Idempotently ensure the Stripe Meter + Product + Price exist; cache their ids
 * in billing_config (Faz 9C). No-op without STRIPE_API_KEY. Safe to call at boot.
 */
export async function ensureBillingConfig(): Promise<{ meterId: string; priceId: string } | null> {
  const s = getStripe();
  if (!s) return null;
  let meterId = await getBillingConfig("meter_id");
  let priceId = await getBillingConfig("price_id");
  if (meterId && priceId) return { meterId, priceId };
  const meter = await s.billing.meters.create({
    display_name: "ollamas tool calls",
    event_name: METER_EVENT_NAME,
    default_aggregation: { formula: "sum" },
  });
  meterId = meter.id; await setBillingConfig("meter_id", meterId);
  const product = await s.products.create({ name: "ollamas API usage" });
  // Params cast to any: metered-price shape (recurring.meter, unit_amount_decimal)
  // is runtime-validated by Stripe; SDK type unions drift across versions.
  const price = await s.prices.create({
    currency: "usd",
    product: product.id,
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
    billing_scheme: "per_unit",
    unit_amount_decimal: String(UNIT_PRICE),
  } as any);
  priceId = price.id; await setBillingConfig("price_id", priceId);
  return { meterId, priceId };
}

/** Ensure a Stripe Customer exists for a tenant; returns the customer id (or null). */
export async function ensureCustomer(tenantId: string): Promise<string | null> {
  const s = getStripe();
  if (!s) return null;
  const existing = (await getTenant(tenantId))?.stripe_customer_id;
  if (existing) return existing;
  const cus = await s.customers.create({ metadata: { tenantId } });
  await setTenantStripeCustomer(tenantId, cus.id);
  return cus.id;
}

/** Customer Portal session URL so a tenant self-manages billing. Null without Stripe. */
export async function createPortalSession(tenantId: string): Promise<string | null> {
  const s = getStripe();
  if (!s) return null;
  const customer = await ensureCustomer(tenantId);
  if (!customer) return null;
  const sess = await s.billingPortal.sessions.create({ customer, return_url: `${APP_URL}/` });
  return sess.url;
}

/** Checkout session URL to subscribe a tenant to the metered price. Null without Stripe/price. */
export async function createCheckoutSession(tenantId: string): Promise<string | null> {
  const s = getStripe();
  if (!s) return null;
  const cfg = await ensureBillingConfig();
  const customer = await ensureCustomer(tenantId);
  if (!cfg || !customer) return null;
  const sess = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: cfg.priceId }],
    success_url: `${APP_URL}/?billing=success`,
    cancel_url: `${APP_URL}/?billing=cancel`,
  });
  return sess.url;
}

/** Roll up usage → billing lines for a period (default current month). */
export async function computeRun(period = monthKey()): Promise<BillingRun> {
  const lines = (await aggregateUsage(period)).map((u) => ({ ...u, amount: u.calls * UNIT_PRICE }));
  return { period, dryRun: !getStripe(), lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/**
 * Report the period's usage to Stripe as metered events and write an invoice row.
 * Dry-run (no STRIPE_API_KEY): computes + persists invoices but skips Stripe.
 */
export async function runBilling(period = monthKey()): Promise<BillingRun> {
  const run = await computeRun(period);
  for (const line of run.lines) {
    // Record OUR invoice ledger row (idempotent per tenant+period). Usage is already
    // reported to Stripe's meter in REAL TIME per call via sendMeterEventAsync — so
    // runBilling must NOT also push the period total to the same meter, or every tool
    // call is metered twice (sum aggregation → double-billed). The ledger row stays.
    await recordInvoice(line.tenantId, period, line.amount);
  }
  return run;
}

/**
 * Verify + handle a Stripe webhook (plan changes etc.). Requires STRIPE_API_KEY
 * + STRIPE_WEBHOOK_SECRET. Returns the event type handled.
 */
export async function handleWebhook(rawBody: Buffer, signature: string): Promise<{ type: string; handled: boolean }> {
  const s = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) throw new Error("Stripe not configured (STRIPE_API_KEY / STRIPE_WEBHOOK_SECRET)");
  const event = s.webhooks.constructEvent(rawBody, signature, secret);

  // Idempotency: atomically CLAIM the event up-front. Only the winner of a concurrent
  // race (Stripe at-least-once retries / multiple replicas) gets true and runs the side
  // effects; a duplicate gets false and no-ops — so setTenantPlan + queueWebhookEvent
  // never double-fire. A TRANSIENT handler failure RELEASES the claim (Stripe retries);
  // a structurally-unprocessable event (unknown plan) stays claimed so it is not
  // redelivered forever.
  if (!(await claimStripeEvent(event.id))) return { type: event.type, handled: false };

  const tenantFromSub = async (sub: Stripe.Subscription) =>
    (sub.metadata?.tenantId as string) || (await getTenantByStripeCustomer(String(sub.customer)))?.id || "";

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const planId = (sub.metadata?.planId as string) || "";
        const tenantId = await tenantFromSub(sub);
        if (tenantId && planId && (await getTenant(tenantId))) {
          await setTenantPlan(tenantId, planId);
          await queueWebhookEvent(tenantId, "subscription.updated", { planId });
          return { type: event.type, handled: true };
        }
        return { type: event.type, handled: false }; // not actionable (no tenant/plan) → stays claimed, no retry storm
      }
      case "customer.subscription.deleted": {
        // Subscription ended → drop the tenant to the free plan (revoke paid tiers).
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await tenantFromSub(sub);
        if (tenantId && (await getTenant(tenantId))) {
          await setTenantPlan(tenantId, "free");
          return { type: event.type, handled: true };
        }
        return { type: event.type, handled: false };
      }
      case "invoice.paid":
      case "invoice.payment_failed":
        return { type: event.type, handled: true }; // acknowledge payment lifecycle
    }
    return { type: event.type, handled: false };
  } catch (e: any) {
    // "Unknown plan" can never succeed → keep the event claimed (no infinite retries).
    // Any other (transient) error → release so Stripe redelivers.
    if (/unknown plan/i.test(String(e?.message || ""))) return { type: event.type, handled: false };
    await releaseStripeEvent(event.id);
    throw e;
  }
}
