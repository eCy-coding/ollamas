// Outbound tenant webhooks (Faz 11B). Events fanned out to webhook_deliveries by
// store.queueWebhookEvent; this module signs + POSTs them with retry + idempotency.
// HMAC signature is Stripe-compatible (`t=<unixsec>,v1=<hex>` over `t.body`) so
// tenants can verify with standard libraries. Zero deps (node:crypto + fetch).

import crypto from "node:crypto";
import { pendingDeliveries, markDelivery, getWebhookSecret } from "../store";

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

/** Deliver one pending row. Returns true if it should be retried later. */
async function deliverOne(row: any): Promise<void> {
  const secret = getWebhookSecret(row.webhook_id);
  if (!secret) { markDelivery(row.id, "dead_letter", row.attempt, null); return; }
  const attempt = row.attempt + 1;
  const body = row.payload as string;
  // Look up the URL via a second query through the secret owner — store exposes
  // it indirectly; we re-read here to avoid widening the Delivery shape.
  let url = "";
  try {
    const { listWebhooks } = await import("../store");
    // webhook_id → url; cheap lookup across the tenant's hooks.
    url = (listWebhooks(row.tenant_id).find((h) => h.id === row.webhook_id) as any)?.url || "";
  } catch { /* */ }
  if (!url) { markDelivery(row.id, "dead_letter", attempt, null); return; }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ollamas-Signature": signWebhook(secret, body) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) { markDelivery(row.id, "delivered", attempt, null, res.status); return; }
    // 4xx (except 429) = permanent; else retry.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      markDelivery(row.id, "dead_letter", attempt, null, res.status); return;
    }
    scheduleRetry(row.id, attempt, res.status);
  } catch {
    scheduleRetry(row.id, attempt, 0); // network/timeout → retry
  }
}

function scheduleRetry(id: string, attempt: number, code: number) {
  if (attempt >= MAX_ATTEMPTS) { markDelivery(id, "dead_letter", attempt, null, code); return; }
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  markDelivery(id, "pending", attempt, new Date(Date.now() + delay).toISOString(), code);
}

/** Process due deliveries (called on an interval by the worker). */
export async function processDeliveries(): Promise<number> {
  const rows = pendingDeliveries();
  for (const r of rows) await deliverOne(r);
  return rows.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start the background delivery worker (idempotent). */
export function startWebhookWorker(): void {
  if (timer) return;
  const interval = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 30000);
  timer = setInterval(() => { processDeliveries().catch(() => {}); }, interval);
  timer.unref?.();
}
