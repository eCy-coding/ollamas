// OAuth retention sweeper (Faz 26, v1.17). Periodically deletes EXPIRED OAuth rows
// (authorization codes, access tokens, refresh tokens) so a busy authorization
// server does not accumulate dead rows. Only expired rows are removed
// (purgeExpiredOAuth), so RFC 9700 refresh reuse detection stays intact within a
// token's TTL. Failures are swallowed — GC is best-effort and must never crash
// request handling or boot.
//
// C2: migrated off its own setInterval onto the durable job queue (server/jobs.ts).
// Low frequency (hourly) makes a durable row per run cheap — unlike the sub-minute
// recurring loops (webhook retry), which stay in-memory to avoid sqlite churn. This
// module only registers the "oauth-gc" job handler (side-effect import); the actual
// scheduling (Cron + boot-time immediate enqueue) lives in server/jobs.ts's
// startJobs(), same place db-backup's cron lives — see there for OAUTH_GC_CRON.
import { purgeExpiredOAuth } from "./store";
import { registerJobHandler } from "./jobs";

registerJobHandler("oauth-gc", async () => {
  await purgeExpiredOAuth().catch(() => {}); // best-effort — GC must never crash the queue
});
