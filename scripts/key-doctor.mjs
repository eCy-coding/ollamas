#!/usr/bin/env node
// @ts-check
// scripts/key-doctor.mjs — operator wrapper for POST /api/keys/doctor (zero-dep).
//   node scripts/key-doctor.mjs                  -> dry-run scan (env+keychain+gh), masked table
//   node scripts/key-doctor.mjs --connect        -> validate + SAVE to the vault
//   node scripts/key-doctor.mjs --fix            -> --connect; on a github-models auth failure,
//                                                   runs `gh auth refresh -s models:read`
//                                                   INTERACTIVELY (browser approve), then retries
//   --sources env,gh                             -> restrict scan sources
//   OLLAMAS_URL (default http://127.0.0.1:3000)
// Interactivity lives HERE by design — the server endpoint never spawns gh.
import { spawnSync } from "node:child_process";

const URL_BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const connect = has("--connect") || has("--fix");
const sources = opt("--sources", "env,keychain,gh").split(",").map((s) => s.trim()).filter(Boolean);

async function doctor() {
  const r = await fetch(`${URL_BASE}/api/keys/doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources, dryRun: !connect }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) throw new Error(`doctor endpoint HTTP ${r.status} — is the ollamas server running at ${URL_BASE} with the key-doctor build?`);
  return r.json();
}

function printReport(rep) {
  const rows = Object.entries(rep.providers).sort(([a], [b]) => a.localeCompare(b));
  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(`\nkey-doctor ${rep.dryRun ? "(DRY-RUN — nothing saved; use --connect)" : "(connected mode)"}\n`);
  console.log(pad("provider", 16) + pad("status", 24) + pad("src", 10) + pad("key", 9) + "note / next step");
  for (const [p, v] of rows) {
    const note = v.status === "absent" ? (v.nextManualUrl ? `signup: ${v.nextManualUrl}` : "") : (v.note ?? "");
    console.log(pad(p, 16) + pad(v.status, 24) + pad(v.source ?? "-", 10) + pad(v.keyMasked ?? "-", 9) + note);
  }
  const caps = Object.entries(rep.capabilityReport);
  if (caps.length) {
    console.log("\nunlocked capabilities:");
    for (const [c, ps] of caps) console.log(`  ${pad(c, 10)} ← ${ps.join(", ")}`);
  }
  const roles = rep.roleSuggestions ?? {};
  console.log("\norchestra role suggestions (council seats):");
  for (const [role, ps] of Object.entries(roles)) console.log(`  ${pad(role, 13)} ← ${ps.length ? ps.join(", ") : "—"}`);
}

function ghNeedsRefresh(rep) {
  const gm = rep.providers?.["github-models"];
  return gm?.status === "invalid" && /gh auth refresh/.test(gm?.note ?? "");
}

let rep = await doctor();
printReport(rep);

if (has("--fix") && ghNeedsRefresh(rep)) {
  console.log("\ngithub-models token lacks models access → running gh auth refresh (approve in browser)…");
  const r = spawnSync("gh", ["auth", "refresh", "-h", "github.com", "-s", "models:read"], { stdio: "inherit" });
  if (r.status === 0) {
    console.log("refresh done → re-running doctor…");
    rep = await doctor();
    printReport(rep);
  } else {
    console.error("gh auth refresh failed/cancelled — github-models stays unconnected.");
  }
}

const connected = Object.values(rep.providers).filter((v) => v.status === "connected" || v.status === "already").length;
console.log(`\n${connected} provider live · absent ones need only their signup URL (docs/FREE_PROVIDERS.md).`);
