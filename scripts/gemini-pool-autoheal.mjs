#!/usr/bin/env node
// @ts-check
// scripts/gemini-pool-autoheal.mjs — autonomous key-pool healer, layered on top of the existing
// read-only gemini-pool-check.mjs (whose own contract says "NEVER touches key values" — this
// script does NOT change that file; it composes it with a real fix instead of just alerting).
//
// For every provider in GET /api/keys/pool that is configured (total > 0) but fully dry
// (live === 0): gemini is the only provider with a proven, safe, non-account-creating
// auto-issuance path (npm run gemini:provision — uses the operator's ALREADY-authenticated
// gcloud to mint a key in each of their EXISTING GCP projects; see scripts/gemini-provision.mjs).
// So gemini gets a real auto-heal attempt. Every other dry provider gets an ALERT ONLY — this
// script never signs up for anything, never opens a browser, never enters credentials. Getting a
// new OpenAI/Anthropic/Cohere/etc. key requires a human on that provider's dashboard.
//
//   npm run keys:autoheal
//   GATEWAY=http://127.0.0.1:3000 node scripts/gemini-pool-autoheal.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { poolHealthLine, assess } from "./gemini-pool-check.mjs";

const pexec = promisify(execFile);

// Providers with NO CLI-based key-issuance path — dry here is alert-only, forever (until someone
// builds an equivalent of gemini-provision.mjs for them). Not exhaustive by design: any provider
// present in the live pool response that isn't "gemini" falls into this bucket automatically.
const AUTO_HEAL_CAPABLE = new Set(["gemini"]);

/** Pure: split a pool map into {healable, alertOnly} dry-provider names. Unit-tested. */
export function classifyDryProviders(pool) {
  const healable = [];
  const alertOnly = [];
  for (const [name, entry] of Object.entries(pool || {})) {
    if (!entry || entry.total === 0) continue; // unconfigured — not our concern
    if (entry.live > 0) continue; // healthy
    (AUTO_HEAL_CAPABLE.has(name) ? healable : alertOnly).push(name);
  }
  return { healable, alertOnly };
}

async function alert(gateway, text) {
  try {
    await fetch(`${gateway}/api/notify/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* alert is best-effort, same posture as gemini-pool-check.mjs */
  }
}

async function main() {
  const gateway = (process.env.GATEWAY || "http://127.0.0.1:3000").replace(/\/+$/, "");
  let pool = {};
  try {
    const r = await fetch(`${gateway}/api/keys/pool`, { signal: AbortSignal.timeout(8000) });
    pool = (await r.json())?.pool ?? {};
  } catch (e) {
    console.error(`autoheal: pool fetch failed — ${e?.message || e}`);
    process.exit(1);
  }

  for (const [name, entry] of Object.entries(pool)) {
    if (!entry || entry.total === 0) continue;
    console.log(poolHealthLine(entry, name, name === "gemini" ? 20 : 0));
  }

  const { healable, alertOnly } = classifyDryProviders(pool);
  let worstCode = 0;

  for (const name of alertOnly) {
    const { code, alert: msg } = assess(pool[name], name, "no auto-issuance CLI for this provider — get a new key from its dashboard and add it via the Donanım Kasası / Key Vault");
    if (code > worstCode) worstCode = code;
    if (msg) await alert(gateway, msg);
  }

  for (const name of healable) {
    console.log(`autoheal: ${name} pool is DRY — attempting npm run gemini:provision -- --all-accounts`);
    try {
      const { stdout } = await pexec("npm", ["run", "gemini:provision", "--", "--all-accounts"], {
        cwd: process.cwd(),
        timeout: 120000,
      });
      console.log(stdout);
      await alert(gateway, `🔧 ollamas: ${name} pool was DRY — auto-provision ran (see /tmp/ollamas-keys-autoheal.log for detail).`);
    } catch (e) {
      const detail = String(e?.message || e).slice(0, 300);
      console.error(`autoheal: ${name} provision failed — ${detail}`);
      await alert(gateway, `⚠️ ollamas: ${name} pool DRY and auto-provision FAILED — manual attention needed. ${detail}`);
      worstCode = 2;
    }
  }

  process.exit(worstCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
