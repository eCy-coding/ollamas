// Revenue Ops (Faz19) — native, local-owner-only personal income tooling.
// Wraps the proven $0 scripts (DRY): test-generation (qwen3:8b, near-100% via auto-verify
// gate), code-audit (480b-cloud — ollama is low-yield on open-ended audit), and the
// storefront generator (fills the landing-page template from local config). No money
// movement, no outreach — produces local artifacts only. Exposed as agent tools + gated
// /api/revenue/* endpoints + a dashboard tab.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

const pexec = promisify(execFile);
const REPO_ROOT = process.cwd(); // server is launched from the repo root

export interface RevenueConfig {
  model?: string;        // default model for ops (per-op override below)
  brand?: string;
  email?: string;
  paymentLink?: string;  // user's own Gumroad/Stripe link — they provide it
}

export function getRevenueConfig(): RevenueConfig {
  return (db.data as unknown as { revenue?: RevenueConfig }).revenue || {};
}
export function setRevenueConfig(patch: RevenueConfig): RevenueConfig {
  const next = { ...getRevenueConfig(), ...patch };
  (db.data as unknown as { revenue?: RevenueConfig }).revenue = next;
  db.save();
  return next;
}

const tail = (s: string, n = 2000) => String(s || "").slice(-n);

/** $0 test-generation: qwen3:8b writes a unit test, vitest runs it, ships ONLY if it passes. */
export async function runTestgen(input: { file: string; fn: string; model?: string }): Promise<{
  ok: boolean; shippable: boolean; model: string; output: string;
}> {
  const model = input.model || "qwen3:8b";
  if (!input.file || !input.fn) return { ok: false, shippable: false, model, output: "file + fn required" };
  try {
    const { stdout, stderr } = await pexec("node", ["scripts/testgen.mjs", "--file", input.file, "--fn", input.fn, "--model", model],
      { cwd: REPO_ROOT, timeout: 180000, maxBuffer: 1 << 24 });
    const out = stdout + stderr;
    return { ok: true, shippable: /✅ PASS/.test(out), model, output: tail(out) };
  } catch (e: unknown) {
    const er = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, shippable: false, model, output: tail((er.stdout || "") + (er.stderr || "") || er.message) };
  }
}

/** Code-audit on a repo path. Default model = 480b-cloud (cheap, high-yield; qwen3:8b is
 *  low-yield on open-ended audit — proven). Returns finding count + report path. */
export async function runAudit(input: { repo: string; model?: string; maxUnits?: number }): Promise<{
  ok: boolean; model: string; findings?: number; reportPath?: string; output: string;
}> {
  const model = input.model || "qwen3-coder:480b-cloud";
  if (!input.repo || !fs.existsSync(input.repo)) return { ok: false, model, output: "repo path required/exists" };
  const args = ["scripts/audit-service.mjs", "--repo", input.repo, "--model", model];
  if (input.maxUnits && input.maxUnits > 0) args.push("--max-units", String(input.maxUnits));
  try {
    const { stdout, stderr } = await pexec("node", args, { cwd: REPO_ROOT, timeout: 600000, maxBuffer: 1 << 25 });
    const name = path.basename(path.resolve(input.repo));
    let findings = 0;
    try { findings = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "audit-out", name, "findings.json"), "utf8")).findings || []).length; } catch { /* none */ }
    return { ok: true, model, findings, reportPath: path.join("audit-out", name, "REPORT.md"), output: tail(stdout + stderr, 1500) };
  } catch (e: unknown) {
    const er = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, model, output: tail((er.stdout || "") + (er.stderr || "") || er.message, 1500) };
  }
}

/** Fill the storefront landing-page template from config. LOCAL artifact only — no deploy.
 *  Payment/brand/email come from config (the user provides their own payment link). */
export function generateStorefront(input: { brand?: string; email?: string; paymentLink?: string; out?: string }): {
  ok: boolean; path?: string; remainingPlaceholders?: string[]; output: string;
} {
  const cfg = getRevenueConfig();
  const brand = input.brand || cfg.brand || "{{YOUR_NAME_OR_BRAND}}";
  const email = input.email || cfg.email || "{{YOUR_EMAIL}}";
  const pay = input.paymentLink || cfg.paymentLink || "{{PAYMENT_OR_BOOKING_LINK}}";
  const tpl = path.join(REPO_ROOT, "docs", "site", "index.html");
  if (!fs.existsSync(tpl)) return { ok: false, output: "storefront template missing (docs/site/index.html)" };
  let html = fs.readFileSync(tpl, "utf8");
  html = html.split("{{YOUR_NAME_OR_BRAND}}").join(brand).split("{{YOUR_EMAIL}}").join(email).split("{{PAYMENT_OR_BOOKING_LINK}}").join(pay);
  const outPath = path.resolve(REPO_ROOT, input.out || "audit-out/storefront.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  const remaining = html.match(/\{\{[A-Z_]+\}\}/g) || [];
  return { ok: true, path: path.relative(REPO_ROOT, outPath), remainingPlaceholders: [...new Set(remaining)], output: remaining.length ? `still has unfilled: ${[...new Set(remaining)].join(", ")} — set them in config before going live` : "all placeholders filled — ready to publish" };
}
