#!/usr/bin/env node
// scripts/gemini-provision.mjs — sustainable Gemini key provisioning, zero manual paste.
//
// Free-tier Gemini quota is 20 requests/day PER PROJECT. This script uses the operator's
// ALREADY-authenticated gcloud to create one Gemini API key in each of their GCP projects
// (N projects → ~N×20/day) and loads each into the ollamas encrypted vault via the existing
// POST /api/keys/add — so the rotation pool (ProviderRouter) self-sustains with no copy-paste.
//
// SECURITY: a key value flows gcloud → (this process) → /api/keys/add ONLY. It is NEVER printed
// or logged (output is sanitized of AIza… shapes). The operator never pastes a key; the agent
// never sees one. Preflight needs an authed gcloud (`gcloud auth login`).
//
//   npm run gemini:provision            # provision one key per project → vault
//   npm run gemini:provision -- --dry   # list projects + plan, create NOTHING (safe preview)
//   npm run gemini:provision -- --limit 3 --gateway http://127.0.0.1:3000
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/** Parse `gcloud projects list --format="value(projectId)"` stdout → trimmed project IDs. */
export function parseProjectIds(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^projectid$/i.test(s));
}

/** Build the vault key-add endpoint from a gateway base. */
export function keyAddUrl(gateway) {
  return `${String(gateway || "http://127.0.0.1:3000").replace(/\/+$/, "")}/api/keys/add`;
}

/** Redact anything shaped like a Google API key so no secret leaks into logs/errors. */
export function redactKeys(text) {
  return String(text ?? "").replace(/AIza[0-9A-Za-z_-]{35}/g, "AIza…REDACTED");
}

/** Human summary from per-project results. NEVER includes key values. */
export function summarize(results) {
  const by = (s) => results.filter((r) => r.status === s).length;
  const added = by("added"), skipped = by("skipped"), failed = by("failed");
  const lines = results.map((r) => `  ${r.status === "added" ? "✓" : r.status === "skipped" ? "·" : "✗"} ${r.project}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  return `Provisioned: ${added} added · ${skipped} skipped · ${failed} failed (of ${results.length})\n${lines.join("\n")}`;
}

// ── IO (only runs when invoked directly) ─────────────────────────────────────

async function gcloud(args) {
  // execFile (no shell) → no injection; capture both streams; sanitize on throw.
  try {
    const { stdout } = await pexec("gcloud", args, { maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, reason: redactKeys((e?.stderr || e?.message || "gcloud failed").toString().trim().slice(0, 160)) };
  }
}

async function activeAccount() {
  const r = await gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  return r.ok ? r.stdout.trim().split("\n")[0] : "";
}

async function addToVault(gateway, key) {
  const res = await fetch(keyAddUrl(gateway), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "gemini", key }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`keys/add HTTP ${res.status}`);
  return res.json();
}

async function poolStatus(gateway) {
  try {
    const r = await fetch(`${String(gateway).replace(/\/+$/, "")}/api/keys/pool`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j?.pool?.gemini ?? null;
  } catch { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const gwArg = args.indexOf("--gateway");
  const gateway = gwArg >= 0 ? args[gwArg + 1] : "http://127.0.0.1:3000";

  const acct = await activeAccount();
  if (!acct) {
    console.error("No active gcloud account. Run:  gcloud auth login   then re-run this script.");
    process.exit(0);
  }
  console.log(`gcloud account: ${acct}`);

  const list = await gcloud(["projects", "list", "--format=value(projectId)"]);
  if (!list.ok) { console.error(`Could not list projects: ${list.reason}`); process.exit(1); }
  let projects = parseProjectIds(list.stdout);
  if (Number.isFinite(limit)) projects = projects.slice(0, limit);
  console.log(`Projects (${projects.length}): ${projects.join(", ")}`);

  if (dry) {
    console.log(`\n[--dry] Would create one 'ollamas-gemini' key per project (${projects.length} keys → ~${projects.length * 20}/day) and load each into the vault. No changes made.`);
    return;
  }

  const results = [];
  // Per-project live progress so a multi-minute run (each gcloud enable is 30-60s) never
  // looks hung. Each line ends with the outcome; key VALUES are never printed.
  const note = (s) => process.stdout.write(s);
  let i = 0;
  for (const project of projects) {
    i++;
    note(`  [${i}/${projects.length}] ${project}: enabling APIs… `);
    const en = await gcloud(["services", "enable", "generativelanguage.googleapis.com", "apikeys.googleapis.com", `--project=${project}`]);
    if (!en.ok) { console.log(`✗ enable failed (${en.reason})`); results.push({ project, status: "failed", reason: `enable: ${en.reason}` }); continue; }
    // Idempotent: reuse an existing ollamas-gemini key (the vault dedups; skip create → no GCP key sprawl on re-runs).
    const existing = await gcloud(["services", "api-keys", "list", "--filter=displayName:ollamas-gemini", `--project=${project}`, "--format=value(name)"]);
    if (existing.ok && existing.stdout.trim()) { console.log("· already provisioned (skip)"); results.push({ project, status: "skipped", reason: "ollamas-gemini key exists" }); continue; }
    note("creating key… ");
    const created = await gcloud(["services", "api-keys", "create", "--display-name=ollamas-gemini", `--project=${project}`, "--format=value(response.keyString)"]);
    if (!created.ok) { console.log(`✗ create failed (${created.reason})`); results.push({ project, status: "failed", reason: `create: ${created.reason}` }); continue; }
    const key = created.stdout.trim(); // secret — used immediately, never logged
    if (!key) { console.log("✗ no keyString returned"); results.push({ project, status: "failed", reason: "no keyString returned" }); continue; }
    try {
      await addToVault(gateway, key);
      console.log("→ added to vault ✓");
      results.push({ project, status: "added" });
    } catch (e) {
      console.log(`✗ vault add failed`);
      results.push({ project, status: "failed", reason: redactKeys(e?.message || "vault add failed") });
    }
  }

  console.log(`\n${summarize(results)}`);
  const pool = await poolStatus(gateway);
  if (pool) console.log(`\nGemini vault pool now: total ${pool.total} · live ${pool.live}`);
  console.log("\nRotation auto-uses a live key; on 429 it cools that key + rotates. Re-run after adding GCP projects.");
}

// Only run main when invoked as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(redactKeys(e?.message || String(e))); process.exit(1); });
}
