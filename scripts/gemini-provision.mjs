#!/usr/bin/env node
// @ts-check
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

/** Extract the meaningful failure reason from gcloud output. gcloud prints progress
 * ("Create in progress… Waiting for [operation]") BEFORE the real ERROR, so a head-slice
 * hides the cause. Prefer the ERROR/quota/permission line; else the last non-empty line. */
export function extractGcloudError(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /^ERROR|error:|quota|exceeded|permission|denied|precondition|billing|not been used|disabled/i.test(l));
  return redactKeys((hit || lines[lines.length - 1] || "gcloud failed").slice(0, 300));
}

/** GCP-valid project id for a new pool project. Pure (rand passed in). 6-30 chars,
 * lowercase letter start, [a-z0-9-], no trailing hyphen. e.g. ollamas-gem-1-k3x9. */
export function newProjectId(i, rand) {
  const suffix = String(rand).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "x";
  return `ollamas-gem-${i}-${suffix}`.slice(0, 30).replace(/-+$/, "");
}

/** Pure: prepend `--account <email>` to a gcloud arg list when an account is given. */
export function gcloudArgsFor(account, args) {
  return account ? ["--account", account, ...args] : [...args];
}

/** Pure: parse `gcloud auth list --format=value(account)` → authed account emails. */
export function parseAccounts(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("@"));
}

/** Pure: is this gcloud failure the GCP per-account project-creation quota cap? */
export function isProjectQuota(reason) {
  return /allotted project quota|project quota|quota exceeded|cloud resource manager quota/i.test(String(reason || ""));
}

/** Human summary from per-project results. NEVER includes key values. */
export function summarize(results) {
  const by = (s) => results.filter((r) => r.status === s).length;
  const added = by("added"), skipped = by("skipped"), failed = by("failed");
  const lines = results.map((r) => `  ${r.status === "added" ? "✓" : r.status === "skipped" ? "·" : "✗"} ${r.account ? `${r.account}/` : ""}${r.project}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  return `Provisioned: ${added} added · ${skipped} skipped · ${failed} failed (of ${results.length})\n${lines.join("\n")}`;
}

// ── IO (only runs when invoked directly) ─────────────────────────────────────

async function gcloud(args, account = "") {
  // execFile (no shell) → no injection; capture both streams; sanitize on throw.
  // --quiet: this runs non-interactively (execFile, no TTY); without it gcloud aborts on
  // any confirmation prompt (e.g. the projects-create operation poll) → "not in an
  // interactive session" failure. --quiet accepts default answers so the flow completes.
  // --account targets a specific authed account (multi-account scale).
  try {
    const { stdout } = await pexec("gcloud", ["--quiet", ...gcloudArgsFor(account, args)], { maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, reason: extractGcloudError(e?.stderr || e?.message || "gcloud failed") };
  }
}

async function activeAccount() {
  const r = await gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  return r.ok ? r.stdout.trim().split("\n")[0] : "";
}

/** All authed gcloud accounts (for --all-accounts). */
async function listAccounts() {
  const r = await gcloud(["auth", "list", "--format=value(account)"]);
  return r.ok ? parseAccounts(r.stdout) : [];
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

// Provision every project of ONE account → vault. Returns {results, quotaHit}.
async function provisionAccount(account, { gateway, limit, newProjects, dry }) {
  console.log(`\n━━ account: ${account} ━━`);
  const list = await gcloud(["projects", "list", "--format=value(projectId)"], account);
  if (!list.ok) { console.error(`  could not list projects: ${list.reason}`); return { results: [], quotaHit: false }; }
  let projects = parseProjectIds(list.stdout);
  if (Number.isFinite(limit)) projects = projects.slice(0, limit);
  console.log(`  projects (${projects.length}): ${projects.join(", ") || "(none)"}`);

  const toCreate = Array.from({ length: newProjects }, (_, k) => newProjectId(k + 1, Math.random().toString(36).slice(2, 8)));
  if (dry) {
    if (newProjects > 0) console.log(`  [--dry] would CREATE ${newProjects} project(s): ${toCreate.join(", ")}`);
    console.log(`  [--dry] would provision one 'ollamas-gemini' key per project (${projects.length + newProjects} total → ~${(projects.length + newProjects) * 20}/day). No changes.`);
    return { results: [], quotaHit: false };
  }

  let quotaHit = false;
  for (const id of toCreate) {
    process.stdout.write(`  + creating project ${id}… `);
    const c = await gcloud(["projects", "create", id, "--name=ollamas gemini"], account);
    if (c.ok) { console.log("✓"); projects.push(id); }
    else { if (isProjectQuota(c.reason)) quotaHit = true; console.log(`✗ (${c.reason})`); }
  }

  const results = [];
  let i = 0;
  for (const project of projects) {
    i++;
    process.stdout.write(`  [${i}/${projects.length}] ${project}: enabling APIs… `);
    const en = await gcloud(["services", "enable", "generativelanguage.googleapis.com", "apikeys.googleapis.com", `--project=${project}`], account);
    if (!en.ok) { console.log(`✗ enable failed (${en.reason})`); results.push({ account, project, status: "failed", reason: `enable: ${en.reason}` }); continue; }
    const existing = await gcloud(["services", "api-keys", "list", "--filter=displayName:ollamas-gemini", `--project=${project}`, "--format=value(name)"], account);
    if (existing.ok && existing.stdout.trim()) { console.log("· already provisioned (skip)"); results.push({ account, project, status: "skipped", reason: "ollamas-gemini key exists" }); continue; }
    process.stdout.write("creating key… ");
    const created = await gcloud(["services", "api-keys", "create", "--display-name=ollamas-gemini", `--project=${project}`, "--format=value(response.keyString)"], account);
    if (!created.ok) { console.log(`✗ create failed (${created.reason})`); results.push({ account, project, status: "failed", reason: `create: ${created.reason}` }); continue; }
    const key = created.stdout.trim();
    if (!key) { console.log("✗ no keyString returned"); results.push({ account, project, status: "failed", reason: "no keyString returned" }); continue; }
    try { await addToVault(gateway, key); console.log("→ added to vault ✓"); results.push({ account, project, status: "added" }); }
    catch (e) { console.log("✗ vault add failed"); results.push({ account, project, status: "failed", reason: redactKeys(e?.message || "vault add failed") }); }
  }
  return { results, quotaHit };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const allAccounts = args.includes("--all-accounts");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const gwArg = args.indexOf("--gateway");
  const gateway = gwArg >= 0 ? args[gwArg + 1] : "http://127.0.0.1:3000";
  const npArg = args.indexOf("--new-projects");
  const newProjects = npArg >= 0 ? Math.max(0, Number(args[npArg + 1]) || 0) : 0;
  const acctArg = args.indexOf("--account");
  const oneAccount = acctArg >= 0 ? args[acctArg + 1] : "";

  const authed = await listAccounts();
  if (!authed.length) { console.error("No authed gcloud account. Run:  gcloud auth login   then re-run."); process.exit(0); }
  // Which accounts to provision: --all-accounts (every authed) · --account <email> · else active.
  const accounts = allAccounts ? authed : oneAccount ? [oneAccount] : [await activeAccount() || authed[0]];
  console.log(`gcloud authed accounts: ${authed.join(", ")}\nprovisioning: ${accounts.join(", ")}`);

  const all = [];
  let quotaHit = false;
  for (const acct of accounts) {
    const r = await provisionAccount(acct, { gateway, limit, newProjects, dry });
    all.push(...r.results);
    quotaHit = quotaHit || r.quotaHit;
  }
  if (dry) return;

  console.log(`\n${summarize(all)}`);
  if (quotaHit) {
    const others = authed.filter((a) => !accounts.includes(a));
    console.log(`\n⚠ GCP project quota reached (~12/account). Scale options:`);
    if (others.length) console.log(`  · provision another authed account:  npm run gemini:provision -- --account ${others[0]}`);
    console.log(`  · provision ALL your accounts:        npm run gemini:provision -- --all-accounts`);
    console.log(`  · request a project-quota increase:   https://console.cloud.google.com/iam-admin/quotas (filter 'Project')`);
  }
  const pool = await poolStatus(gateway);
  if (pool) console.log(`\nGemini vault pool now: total ${pool.total} · live ${pool.live}`);
  console.log("\nRotation auto-uses a live key; on 429 it cools that key + rotates.");
}

// Only run main when invoked as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(redactKeys(e?.message || String(e))); process.exit(1); });
}
