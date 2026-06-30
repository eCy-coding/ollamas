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

/** One-line health summary from a pool entry {total,live}. Pure → unit-tested.
 * `perKeyQuota` is the free-tier-per-key budget (gemini=20/day per project; account-level
 * providers like ollama-cloud share one limit → 0 = don't claim a per-key allowance). */
export function poolHealthLine(pool, name = "gemini", perKeyQuota = FREE_TIER_PER_KEY) {
  const total = pool?.total ?? 0;
  const live = pool?.live ?? 0;
  const state = total === 0 ? "UNCONFIGURED" : live === 0 ? "DRY" : "OK";
  const budget = perKeyQuota > 0 ? ` · ~${live * perKeyQuota} req left today` : " · account-level limit";
  return `${name} pool: ${state} · live ${live}/${total}${budget}`;
}

/** Decide alert + exit code from a pool entry. Pure. `hint` is the provider-specific remedy. */
export function assess(pool, name = "gemini", hint = "wait for the daily reset or run `npm run gemini:provision`") {
  const total = pool?.total ?? 0;
  const live = pool?.live ?? 0;
  if (total > 0 && live === 0) {
    return { dry: true, code: 2, alert: `⚠️ ollamas: ${name} key pool is DRY (all keys cooled). ${hint}` };
  }
  return { dry: false, code: 0, alert: null };
}

// Providers to monitor: gemini (per-project free quota, 20/key) + ollama-cloud (account-level).
const MONITORED = [
  { name: "gemini", perKey: FREE_TIER_PER_KEY, hint: "wait for the daily reset or run `npm run gemini:provision`" },
  { name: "ollama-cloud", perKey: 0, hint: "account-level quota — wait for reset or upgrade the ollama.com plan" },
];

async function main() {
  const gateway = (process.env.GATEWAY || "http://127.0.0.1:3000").replace(/\/+$/, "");
  let pools = {};
  try {
    const r = await fetch(`${gateway}/api/keys/pool`, { signal: AbortSignal.timeout(8000) });
    pools = (await r.json())?.pool ?? {};
  } catch (e) {
    console.error(`pool check failed: ${e?.message || e}`);
    process.exit(1);
  }
  let worstCode = 0;
  for (const { name, perKey, hint } of MONITORED) {
    const pool = pools[name] ?? null;
    if (!pool || pool.total === 0) continue; // not configured → skip silently
    console.log(poolHealthLine(pool, name, perKey));
    const { dry, code, alert } = assess(pool, name, hint);
    if (code > worstCode) worstCode = code;
    if (dry && alert) {
      try {
        await fetch(`${gateway}/api/notify/test`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: alert }), signal: AbortSignal.timeout(8000),
        });
      } catch { /* alert is best-effort */ }
    }
  }
  process.exit(worstCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
