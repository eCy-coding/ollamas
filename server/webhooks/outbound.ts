// Outbound tenant webhooks (Faz 11B). Events fanned out to webhook_deliveries by
// store.queueWebhookEvent; this module signs + POSTs them with retry + idempotency.
// HMAC signature is Stripe-compatible (`t=<unixsec>,v1=<hex>` over `t.body`) so
// tenants can verify with standard libraries. Zero deps (node:crypto + fetch).

import crypto from "node:crypto";
import dns from "node:dns/promises";
import { lookup as dnsLookupCb } from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { claimDeliveries, markDelivery, getWebhookSecret, getWebhookUrl } from "../store";

// Private/loopback/link-local/metadata/CGNAT/ULA ranges. net.BlockList normalizes
// IPv4-mapped IPv6 (::ffff: in BOTH dotted AND hex-compressed forms), which the old
// hand-rolled regex missed (::ffff:7f00:1 = 127.0.0.1, ::ffff:a9fe:a9fe = 169.254.169.254).
const PRIVATE_BLOCKLIST = (() => {
  const bl = new net.BlockList();
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addSubnet("169.254.0.0", 16, "ipv4"); // link-local + cloud metadata
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
  bl.addAddress("::1", "ipv6");
  bl.addAddress("::", "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6"); // ULA
  bl.addSubnet("fe80::", 10, "ipv6"); // link-local
  return bl;
})();

/** Extract the embedded IPv4 from any ::ffff: mapped IPv6 (dotted or hex-compressed). */
function mappedIPv4(ip: string): string | null {
  const x = ip.toLowerCase();
  const dotted = x.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = x.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

/** True for private/loopback/link-local/metadata/CGNAT/ULA addresses (any IPv4/IPv6 form). */
export function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (PRIVATE_BLOCKLIST.check(ip, fam === 6 ? "ipv6" : "ipv4")) return true;
  if (fam === 6) {
    const m = mappedIPv4(ip); // belt-and-suspenders for IPv4-mapped forms
    if (m && PRIVATE_BLOCKLIST.check(m, "ipv4")) return true;
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

/** DNS lookup that rejects private targets at CONNECT time — closes the DNS-rebinding
 *  TOCTOU gap (the pre-check resolves once, but the transport re-resolves independently;
 *  a low-TTL flip could point the connect at an internal IP). WEBHOOK_ALLOW_PRIVATE opts out. */
function guardedLookup(hostname: string, options: any, callback?: any): void {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options;
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "1") return dnsLookupCb(hostname, opts, cb);
  dnsLookupCb(hostname, opts, (err: any, address: any, family: any) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? address : [{ address, family }];
    for (const a of list) if (isPrivateAddress(String(a.address))) return cb(new Error(`blocked private address at connect: ${a.address}`), address, family);
    cb(null, address, family);
  });
}

/** POST a webhook with the SSRF defenses the bare fetch lacked: validates the actual
 *  connect-time IP (guardedLookup) and does NOT follow redirects (http.request never
 *  auto-follows, so a 302 → internal target is returned as a 3xx, not chased). */
function postWebhook(urlStr: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(urlStr); } catch { return reject(new Error("invalid url")); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error(`scheme not allowed: ${u.protocol}`));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      lookup: guardedLookup as any,
      timeout: timeoutMs,
    }, (res) => { res.resume(); resolve({ status: res.statusCode || 0 }); });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.write(body);
    req.end();
  });
}

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
    const { status } = await postWebhook(url, body, { "Content-Type": "application/json", "X-Ollamas-Signature": signWebhook(secret, body) }, TIMEOUT_MS);
    if (status >= 200 && status < 300) { await markDelivery(row.id, "delivered", attempt, null, status); return; }
    // Redirects (3xx) are NOT followed (SSRF guard); 3xx + 4xx (non-429) → dead-letter; else retry.
    if (status >= 300 && status < 500 && status !== 429) { await markDelivery(row.id, "dead_letter", attempt, null, status); return; }
    await scheduleRetry(row.id, attempt, status);
  } catch {
    await scheduleRetry(row.id, attempt, 0); // network/timeout/blocked-at-connect → retry
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
