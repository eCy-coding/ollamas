// Outbound tenant webhooks (Faz 11B). Events fanned out to webhook_deliveries by
// store.queueWebhookEvent; this module signs + POSTs them with retry + idempotency.
// HMAC signature is Stripe-compatible (`t=<unixsec>,v1=<hex>` over `t.body`) so
// tenants can verify with standard libraries. Zero deps (node:crypto + fetch).

import crypto from "node:crypto";
import { claimDeliveries, markDelivery, getWebhookSecret, getWebhookUrl, reclaimStranded, reclaimStale } from "../store";
import { registerRecurring } from "../jobs";

const MAX_ATTEMPTS = Number(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || 5);
const TIMEOUT_MS = Number(process.env.WEBHOOK_REQUEST_TIMEOUT_MS || 15000);
// Backoff per attempt index (ms): immediate, 1m, 10m, 1h, 12h.
const BACKOFF_MS = [0, 60_000, 600_000, 3_600_000, 43_200_000];

/** Stripe-compatible signature header value for a raw JSON body. */
export function signWebhook(secret: string, body: string, nowMs = Date.now()): string {
  const t = Math.floor(nowMs / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

/** Verify a webhook signature (for tests / tenant reference). */
export function verifyWebhook(secret: string, body: string, header: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const t = parseInt(parts.t, 10);
  if (!Number.isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(String(parts.v1 || "")), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Deliver one claimed row; reschedules or dead-letters on failure. */
async function deliverOne(row: any): Promise<void> {
  const secret = await getWebhookSecret(row.webhook_id);
  const url = await getWebhookUrl(row.webhook_id);
  const attempt = row.attempt + 1;
  if (!secret || !url) { await markDelivery(row.id, "dead_letter", attempt, null); return; }
  const body = row.payload as string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ollamas-Signature": signWebhook(secret, body) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) { await markDelivery(row.id, "delivered", attempt, null, res.status); return; }
    if (res.status >= 400 && res.status < 500 && res.status !== 429) { await markDelivery(row.id, "dead_letter", attempt, null, res.status); return; }
    await scheduleRetry(row.id, attempt, res.status);
  } catch {
    await scheduleRetry(row.id, attempt, 0); // network/timeout → retry
  }
}

async function scheduleRetry(id: string, attempt: number, code: number) {
  if (attempt >= MAX_ATTEMPTS) { await markDelivery(id, "dead_letter", attempt, null, code); return; }
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  await markDelivery(id, "pending", attempt, new Date(Date.now() + delay).toISOString(), code);
}

/** Claim + process due deliveries (multi-replica safe). */
export async function processDeliveries(): Promise<number> {
  const rows = await claimDeliveries();
  // Per-row isolation: one deliverOne throw must not abort the rest of the batch
  // (the batch-level .catch in startWebhookWorker would otherwise strand them).
  for (const r of rows) {
    try {
      await deliverOne(r);
    } catch (e) {
      console.warn("[webhook] deliverOne failed", r.id, (e as Error)?.message);
    }
  }
  return rows.length;
}

// C2: migrated off its own setInterval onto server/jobs.ts's registerRecurring —
// sub-minute recurrence (30s default) stays in-memory (no durable jobs-table row
// per tick; the deliveries this drives are already durable via webhook_deliveries).
// Registration here is a module-load side effect (mirrors registerJobHandler's
// self-registering pattern elsewhere); the actual timer is started/stopped
// centrally by server/jobs.ts's startJobs()/stopJobs().
registerRecurring(
  "webhook-retry",
  Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 30000),
  // Each tick: requeue claims stranded mid-run by a crash (older than the stale window)
  // BEFORE claiming new ones, so a crashed delivery re-fires without a restart.
  async () => {
    await reclaimStale().catch(() => {});
    await processDeliveries().catch(() => {});
  },
  {
    // Recover deliveries left 'claimed' by a previous crash, once, before the first tick.
    onStart: () => { void reclaimStranded().catch(() => {}); },
  },
);
