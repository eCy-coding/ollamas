// Billing (AGENTS.md Faz 4). Metering already lands in usage_events (Faz 3);
// this rolls it up per tenant per period and reports it to Stripe as metered
// usage. Stripe is loaded lazily and only when STRIPE_API_KEY is set — without
// a key everything runs in dry-run so the gateway works with zero billing config.

import Stripe from "stripe";
import { aggregateUsage, recordInvoice, setTenantPlan, getTenant, getTenantByStripeCustomer, monthKey, type UsageAgg } from "../store";

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

  // Map subscription plan changes onto the tenant's plan. The tenant id is
  // carried in customer metadata / the customer id convention used at checkout.
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const sub = event.data.object as Stripe.Subscription;
    const planId = (sub.metadata?.planId as string) || "";
    // Prefer explicit tenant metadata; else resolve via the Stripe customer id.
    const tenantId = (sub.metadata?.tenantId as string) || getTenantByStripeCustomer(String(sub.customer))?.id || "";
    if (tenantId && planId && getTenant(tenantId)) {
      try { setTenantPlan(tenantId, planId); return { type: event.type, handled: true }; } catch { /* unknown plan */ }
    }
  }
  return { type: event.type, handled: false };
}
