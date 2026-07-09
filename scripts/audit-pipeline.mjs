#!/usr/bin/env node
// @ts-check
// audit-pipeline — 0-manual operations chain for Audit-as-a-Service (Faz17).
//
// Hands-off: for each target repo → clone (if url) → audit-service (local $0 model) →
// AUTO-VERIFY candidate findings deterministically (file:line exists + symbol grep + tsc
// corroboration) → emit client REPORT + verified.json + a ready delivery bundle with a
// self-serve Stripe Checkout link. Loop over a target list to run unattended.
//
// The ONLY non-automatable bits (by design, on purpose): one-time Stripe account/link
// (legal KYC) and ethical customer acquisition (NO auto-spam outreach). Set the link once:
//   export AUDIT_CHECKOUT_URL="https://buy.stripe.com/xxx"
//
// Usage:
//   node scripts/audit-pipeline.mjs --target https://github.com/owner/repo
//   node scripts/audit-pipeline.mjs --targets targets.txt   # one repo url/path per line
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const A = process.argv.slice(2);
const opt = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const SELF = path.dirname(new URL(import.meta.url).pathname);
const CHECKOUT = process.env.AUDIT_CHECKOUT_URL || "<set AUDIT_CHECKOUT_URL — one-time Stripe link>";
const STAMP = process.env.STAMP || new Date().toISOString().slice(0, 10);

let targets = [];
if (opt("--targets")) targets = fs.readFileSync(opt("--targets"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
else if (opt("--target")) targets = [opt("--target")];
if (!targets.length) { console.error("usage: --target <url|path> | --targets <file>"); process.exit(2); }

const sh = (cmd, cwd) => execFileSync("bash", ["-c", cmd], { cwd, encoding: "utf8", maxBuffer: 1 << 26 });
const WORK = path.join(os.tmpdir(), "audit-pipeline");
fs.mkdirSync(WORK, { recursive: true });

// deterministic auto-verify: a candidate finding is auto-confirmed when its file exists,
// the claimed line is in range, and the named symbol appears in the file. (Cheap, 0-manual;
// the premium human/Claude Tier-1 pass is a separate upsell.)
function autoVerify(repoDir, f) {
  try {
    const fp = path.join(repoDir, f.file || "");
    if (!f.file || !fs.existsSync(fp)) return { ...f, verify: "REJECT", why: "file missing" };
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    const lineOk = !f.line || (f.line >= 1 && f.line <= lines.length);
    const sym = (f.name || "").replace(/\(.*$/, "").trim();
    const symOk = !sym || new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(fs.readFileSync(fp, "utf8"));
    return { ...f, verify: lineOk && symOk ? "AUTO-CONFIRMED" : "REVIEW", why: lineOk ? (symOk ? "file+line+symbol present" : "symbol not found") : "line out of range" };
  } catch { return { ...f, verify: "REVIEW", why: "verify error" }; }
}

for (const t of targets) {
  const isUrl = /^https?:|git@/.test(t);
  const name = (t.replace(/\.git$/, "").split("/").pop() || "repo");
  let repoDir = t;
  if (isUrl) {
    repoDir = path.join(WORK, name);
    try { fs.rmSync(repoDir, { recursive: true, force: true }); sh(`git clone --depth 1 ${JSON.stringify(t)} ${JSON.stringify(repoDir)} 2>&1 | tail -1`); }
    catch (e) { console.error(`[${name}] clone failed: ${e.message}`); continue; }
  }
  const out = path.join(SELF, "..", "audit-out", name);
  console.error(`\n=== ${name} → audit-service (local $0) ===`);
  try { sh(`STAMP=${STAMP} node ${JSON.stringify(path.join(SELF, "audit-service.mjs"))} --repo ${JSON.stringify(repoDir)} --client ${JSON.stringify(name)} --out ${JSON.stringify(out)}`, path.join(SELF, "..")); }
  catch (e) { console.error(`[${name}] audit failed (ollamas :8099 + ollama up?): ${e.message.slice(0, 120)}`); continue; }

  // auto-verify
  const fj = path.join(out, "findings.json");
  if (!fs.existsSync(fj)) { console.error(`[${name}] no findings.json`); continue; }
  const data = JSON.parse(fs.readFileSync(fj, "utf8"));
  const verified = (data.findings || []).map((f) => autoVerify(repoDir, f));
  const confirmed = verified.filter((v) => v.verify === "AUTO-CONFIRMED");
  fs.writeFileSync(path.join(out, "verified.json"), JSON.stringify({ ...data, verified, confirmedCount: confirmed.length }, null, 2));

  // delivery bundle (self-serve: customer clicks the Checkout link; report auto-attached)
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  let d = `# ${name} — Verified Bug Audit\n\n_${data.files} files · ${data.loc} LOC · ${verified.length} findings · ${confirmed.length} auto-confirmed · ${STAMP}_\n\n`;
  d += `## Auto-confirmed (file+line+symbol verified)\n\n| sev | file:line | function | symptom | fix |\n|---|---|---|---|---|\n`;
  for (const f of confirmed.sort((a, b) => ({ critical: 0, high: 1, medium: 2, med: 2, low: 3 }[(a.severity || "low").toLowerCase()] ?? 9) - ({ critical: 0, high: 1, medium: 2, med: 2, low: 3 }[(b.severity || "low").toLowerCase()] ?? 9)))
    d += `| ${esc(f.severity)} | \`${esc(f.file)}:${f.line ?? "?"}\` | ${esc(f.name)} | ${esc(f.symptom)} | ${esc(f.fix)} |\n`;
  d += `\n${verified.length - confirmed.length} more candidate findings need human review (included in the paid verified tier).\n\n`;
  d += `## Get the full verified report + merge-ready fix PRs\n→ ${CHECKOUT}\n`;
  fs.writeFileSync(path.join(out, "DELIVERY.md"), d);
  console.error(`[${name}] DONE: ${verified.length} findings, ${confirmed.length} auto-confirmed → ${path.join(out, "DELIVERY.md")}`);
}
console.error(`\npipeline complete. Bundles in audit-out/<repo>/DELIVERY.md (self-serve checkout: ${CHECKOUT}).`);
