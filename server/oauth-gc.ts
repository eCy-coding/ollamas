// OAuth retention sweeper (Faz 26, v1.17). Periodically deletes EXPIRED OAuth rows
// (authorization codes, access tokens, refresh tokens) so a busy authorization
// server does not accumulate dead rows. Mirrors the webhook worker's start/stop
// lifecycle (server/webhooks/outbound.ts) and is wired into the same graceful
// shutdown path. Only expired rows are removed (purgeExpiredOAuth), so RFC 9700
// refresh reuse detection stays intact within a token's TTL. Failures are swallowed
// — GC is best-effort and must never crash request handling or boot.
import { purgeExpiredOAuth } from "./store";

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic sweep. Idempotent. Runs once immediately, then on an interval
 *  (OAUTH_GC_INTERVAL_MS, default 1h). */
export function startOAuthGc(): void {
  if (timer) return;
  const interval = Number(process.env.OAUTH_GC_INTERVAL_MS || 3_600_000);
  purgeExpiredOAuth().catch(() => {}); // sweep once at boot, don't wait a full interval
  timer = setInterval(() => { purgeExpiredOAuth().catch(() => {}); }, interval);
  if (typeof timer.unref === "function") timer.unref(); // never keep the process alive
}

/** Stop the sweep (graceful shutdown). Idempotent. */
export function stopOAuthGc(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
