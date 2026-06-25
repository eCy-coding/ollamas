// Outbound tenant webhooks (Faz 11B). Events fanned out to webhook_deliveries by
// store.queueWebhookEvent; this module signs + POSTs them with retry + idempotency.
// HMAC signature is Stripe-compatible (`t=<unixsec>,v1=<hex>` over `t.body`) so
// tenants can verify with standard libraries. Zero deps (node:crypto + fetch).

import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { claimDeliveries, markDelivery, getWebhookSecret, getWebhookUrl } from "../store";

/** True for IPv4/IPv6 literals in private, loopback, link-local (incl. cloud
 *  metadata 169.254.169.254), unspecified, CGNAT, or IPv6 ULA ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("fe80") || x.startsWith("fc") || x.startsWith("fd")) return true; // link-local / ULA
    const m = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return false;
}

/** SSRF guard: reject non-http(s) schemes and any webhook target that resolves to
 *  a private/loopback/link-local/metadata address. Hostnames are DNS-resolved so a
 *  public name pointing at an internal IP is still blocked. WEBHOOK_ALLOW_PRIVATE=1
 *  opts trusted self-hosters out (e.g. internal-only deployments). */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "1") return;
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("webhook url is invalid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`webhook url scheme not allowed: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("webhook url targets localhost");
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); }
    catch { throw new Error(`webhook url host does not resolve: ${host}`); }
  }
  for (const ip of addrs) if (isPrivateAddress(ip)) throw new Error(`webhook url resolves to a non-public address: ${ip}`);
}

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
  // SSRF guard: never POST to internal/loopback/metadata targets. A blocked URL is
  // a config/abuse problem, not a transient failure → dead-letter (no retry).
  try {
    await assertPublicWebhookUrl(url);
  } catch {
    await markDelivery(row.id, "dead_letter", attempt, null);
    return;
  }
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
/** Stop the background delivery worker (idempotent) — called on graceful shutdown. */
export function stopWebhookWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
