#!/usr/bin/env node
// scripts/gemini-pool-check.mjs — pool-health monitor for sustainable cloud Gemini.
//
// Read-only: GET /api/keys/pool, print the gemini pool health, and (if the live pool is dry)
// fire a Slack/Discord alert via /api/notify/test so the operator knows to wait for the daily
// quota reset or re-run `npm run gemini:provision`. NEVER touches key values. Exit 0 = healthy,
// 2 = dry (cron/launchd visibility). Designed to run on a 4h launchd interval.
//
//   npm run gemini:check
//   GATEWAY=http://127.0.0.1:3000 node scripts/gemini-pool-check.mjs

const FREE_TIER_PER_KEY = 20; // free-tier Gemini = 20 req/day/project

/** One-line health summary from a pool entry {total,live}. Pure → unit-tested. */
export function poolHealthLine(pool) {
  const total = pool?.total ?? 0;
  const live = pool?.live ?? 0;
  const left = live * FREE_TIER_PER_KEY;
  const state = total === 0 ? "UNCONFIGURED" : live === 0 ? "DRY" : "OK";
  return `gemini pool: ${state} · live ${live}/${total} · ~${left} req left today`;
}

/** Decide alert + exit code from a pool entry. Pure. */
export function assess(pool) {
  const total = pool?.total ?? 0;
  const live = pool?.live ?? 0;
  if (total > 0 && live === 0) {
    return { dry: true, code: 2, alert: "⚠️ ollamas: Gemini key pool is DRY (all keys quota-cooled). Wait for the daily reset or run `npm run gemini:provision`." };
  }
  return { dry: false, code: 0, alert: null };
}

async function main() {
  const gateway = (process.env.GATEWAY || "http://127.0.0.1:3000").replace(/\/+$/, "");
  let pool = null;
  try {
    const r = await fetch(`${gateway}/api/keys/pool`, { signal: AbortSignal.timeout(8000) });
    pool = (await r.json())?.pool?.gemini ?? null;
  } catch (e) {
    console.error(`pool check failed: ${e?.message || e}`);
    process.exit(1);
  }
  console.log(poolHealthLine(pool));
  const { dry, code, alert } = assess(pool);
  if (dry && alert) {
    // Best-effort alert via the existing notify sink (no-op without a configured URL).
    try {
      await fetch(`${gateway}/api/notify/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: alert }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { /* alert is best-effort */ }
  }
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
