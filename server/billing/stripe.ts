// Billing (AGENTS.md Faz 4). Metering already lands in usage_events (Faz 3);
// this rolls it up per tenant per period and reports it to Stripe as metered
// usage. Stripe is loaded lazily and only when STRIPE_API_KEY is set — without
// a key everything runs in dry-run so the gateway works with zero billing config.

import Stripe from "stripe";
import { aggregateUsage, recordInvoice, setTenantPlan, getTenant, getTenantByStripeCustomer, setTenantStripeCustomer, getBillingConfig, setBillingConfig, stripeEventSeen, queueWebhookEvent, monthKey, type UsageAgg } from "../store";

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
  const customer = getTenant(tenantId)?.stripe_customer_id;
  if (!customer) return;
  const identifier = `${tenantId}:${Date.now()}:${Math.round(Math.random() * 1e9).toString(36)}`;
  s.billing.meterEvents.create({
    event_name: METER_EVENT_NAME,
    identifier,
    payload: { stripe_customer_id: customer, value: String(value) },
  }).catch((e: any) => console.warn(`[Meter] ${tenantId}: ${e?.message || e}`));
}

/**
 * Idempotently ensure the Stripe Meter + Product + Price exist; cache their ids
 * in billing_config (Faz 9C). No-op without STRIPE_API_KEY. Safe to call at boot.
 */
export async function ensureBillingConfig(): Promise<{ meterId: string; priceId: string } | null> {
  const s = getStripe();
  if (!s) return null;
  let meterId = getBillingConfig("meter_id");
  let priceId = getBillingConfig("price_id");
  if (meterId && priceId) return { meterId, priceId };
  const meter = await s.billing.meters.create({
    display_name: "ollamas tool calls",
    event_name: METER_EVENT_NAME,
    default_aggregation: { formula: "sum" },
  });
  meterId = meter.id; setBillingConfig("meter_id", meterId);
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
  priceId = price.id; setBillingConfig("price_id", priceId);
  return { meterId, priceId };
}

/** Ensure a Stripe Customer exists for a tenant; returns the customer id (or null). */
export async function ensureCustomer(tenantId: string): Promise<string | null> {
  const s = getStripe();
  if (!s) return null;
  const existing = getTenant(tenantId)?.stripe_customer_id;
  if (existing) return existing;
  const cus = await s.customers.create({ metadata: { tenantId } });
  setTenantStripeCustomer(tenantId, cus.id);
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
export function computeRun(period = monthKey()): BillingRun {
  const lines = aggregateUsage(period).map((u) => ({ ...u, amount: u.calls * UNIT_PRICE }));
  return { period, dryRun: !getStripe(), lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/**
 * Report the period's usage to Stripe as metered events and write an invoice row.
 * Dry-run (no STRIPE_API_KEY): computes + persists invoices but skips Stripe.
 */
export async function runBilling(period = monthKey()): Promise<BillingRun> {
  const run = computeRun(period);
  const s = getStripe();
  for (const line of run.lines) {
    // Idempotent: a second run for the same (tenant, period) won't re-bill.
    const inv = recordInvoice(line.tenantId, period, line.amount);
    if (!inv.created) continue;
    if (s) {
      // Stripe needs the real customer id, not our internal tnt_ id.
      const customerId = getTenant(line.tenantId)?.stripe_customer_id;
      if (!customerId) {
        console.warn(`[Billing] tenant ${line.tenantId} has no stripe_customer_id — skipping Stripe push.`);
        continue;
      }
      await s.billing.meterEvents.create({
        event_name: "ollamas_tool_calls",
        identifier: `${line.tenantId}-${period}`, // idempotency key on Stripe's side
        payload: { stripe_customer_id: customerId, value: String(line.calls) },
      });
    }
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

  // Idempotency: skip events already processed (Stripe retries deliver duplicates).
  if (stripeEventSeen(event.id)) return { type: event.type, handled: false };

  const tenantFromSub = (sub: Stripe.Subscription) =>
    (sub.metadata?.tenantId as string) || getTenantByStripeCustomer(String(sub.customer))?.id || "";

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const planId = (sub.metadata?.planId as string) || "";
      const tenantId = tenantFromSub(sub);
      if (tenantId && planId && getTenant(tenantId)) {
        try { setTenantPlan(tenantId, planId); queueWebhookEvent(tenantId, "subscription.updated", { planId }); return { type: event.type, handled: true }; } catch { /* unknown plan */ }
      }
      break;
    }
    case "customer.subscription.deleted": {
      // Subscription ended → drop the tenant to the free plan (revoke paid tiers).
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = tenantFromSub(sub);
      if (tenantId && getTenant(tenantId)) {
        try { setTenantPlan(tenantId, "free"); return { type: event.type, handled: true }; } catch { /* */ }
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      // Acknowledge payment lifecycle; access gating could hook here.
      return { type: event.type, handled: true };
    }
  }
  return { type: event.type, handled: false };
}
