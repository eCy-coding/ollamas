#!/usr/bin/env tsx
/**
 * orchestration/bin/gemini-run.ts — run the Gemini CLI as a read-only PROPOSE worker. Two modes:
 *   "<task>"              — dispatch an arbitrary prompt, print the answer.
 *   --propose <stream>    — GROUNDED fleet proposal: inline the stream's focus-file content, ask for a
 *                           SEARCH/REPLACE edit, write it to the fleet work-dir → the conductor triages/applies
 *                           it with `fleet-apply` exactly like any other worker (production-loop proof).
 *
 * Read-only: `--approval-mode plan` means Gemini never mutates the repo (the conductor applies). Transient 503
 * "high demand" is retried with backoff + `gemini-2.5-flash` fallback.
 *
 * Run:  tsx orchestration/bin/gemini-run.ts "<task>" [--model m] [--json]
 *       tsx orchestration/bin/gemini-run.ts --propose errors-resilience [--model m]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { geminiArgs, parseGeminiJson, isGeminiOverload, isGeminiQuotaExhausted } from "./lib/gemini";
import { focusFile, geminiGroundedPrompt } from "./lib/fleet-prompt";
import { guardQuota, noteOutcome, loadQuota, remaining, todayKey } from "./lib/gemini-quota";
import { loadBudget, remaining as vendorRemaining, defaultLimitFor, pickVendor, guardVendor, noteVendorOutcome, isVendorExhausted } from "./lib/vendor-budget";
import { STREAMS } from "./lib/fleet-plan";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const WORK = join(homedir(), ".llm-mission-control", "fleet", "work");
const QUOTA_FILE = join(homedir(), ".llm-mission-control", "gemini-quota.json");
const BUDGET_FILE = join(homedir(), ".llm-mission-control", "vendor-budget.json");
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes("--json");
const MODEL = flag("--model", "gemini-2.5-flash")!;
const PROPOSE = flag("--propose");
const QUOTA = argv.includes("--quota");
const BUDGET = argv.includes("--budget");
const FLASH = "gemini-2.5-flash";

// ── --budget: show the WHOLE free-tier vendor pool's remaining budget today (no API call) ─────────────
// gemini lives in the single-state quota file; API workers (groq/cerebras/zai) in the pool file. Shows why
// the loop can keep going when one vendor is spent — the conductor fails over to the most-remaining vendor.
if (BUDGET) {
  const today = todayKey();
  const gq = loadQuota(QUOTA_FILE);
  const gView = { vendor: "gemini", used: gq.date === today ? gq.used : 0, limit: gq.limit, remaining: remaining(gq, today) };
  const pool = loadBudget(BUDGET_FILE);
  const apiVendors = ["groq", "cerebras", "zai"];
  const rows = [gView, ...apiVendors.map((v) => {
    const st = pool[v] ?? { date: today, used: 0, limit: defaultLimitFor(v) };
    return { vendor: v, used: st.date === today ? st.used : 0, limit: st.limit, remaining: vendorRemaining(st, today) };
  })];
  if (JSON_OUT) { console.log(JSON.stringify({ date: today, vendors: rows })); process.exit(0); }
  console.log(`free-tier vendor pool — ${today}`);
  for (const r of rows) console.log(`  ${r.vendor.padEnd(9)} ${String(r.used).padStart(2)}/${r.limit} used · ${r.remaining} left${r.remaining === 0 ? " (spent)" : ""}`);
  process.exit(0);
}

// ── --quota: show today's free-tier budget (no API call) ──────────────────────────────────────────────
if (QUOTA) {
  const today = todayKey();
  const st = loadQuota(QUOTA_FILE);
  const left = remaining(st, today);
  const view = { date: today, used: st.date === today ? st.used : 0, limit: st.limit, remaining: left };
  console.log(JSON_OUT ? JSON.stringify(view) : `gemini quota — ${view.used}/${view.limit} used today · ${view.remaining} left${left === 0 ? " (resets tomorrow)" : ""}`);
  process.exit(0);
}

/** Dispatch a prompt to Gemini with 503 backoff + flash fallback. Pre-flight quota gate: if today's free-tier
 *  budget is spent, fail FAST (no API call, no backoff) — the scarce daily requests are never wasted. */
function dispatch(prompt: string): { ok: boolean; model: string; text: string; err?: string } {
  const guard = guardQuota(QUOTA_FILE);
  if (!guard.allowed) return { ok: false, model: MODEL, text: "", err: guard.msg };
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = attempt < 2 ? MODEL : FLASH;
    try {
      const out = execFileSync("gemini", geminiArgs(prompt, m), {
        encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      });
      const g = parseGeminiJson(out);
      if (g.ok) { noteOutcome(QUOTA_FILE, "success"); return { ok: true, model: m, text: g.text }; }
      lastErr = "empty gemini response";
    } catch (e: any) {
      const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
      lastErr = blob.slice(0, 200);
      if (isGeminiQuotaExhausted(blob)) { noteOutcome(QUOTA_FILE, "exhausted"); break; } // latch the day
      if (!isGeminiOverload(blob)) break; // non-transient → stop
    }
    console.error(`[gemini-run] attempt ${attempt + 1} failed (${lastErr.slice(0, 60)}) — backing off …`);
    try { execFileSync("sleep", [String(Math.min(8, 2 ** attempt))]); } catch { /* best-effort */ }
  }
  return { ok: false, model: MODEL, text: "", err: lastErr };
}

/** The stream's free-tier API-worker fallback vendors (its `provider::model` prefer-tails), in pref order. */
function apiCandidates(stream: string): { vendor: string; model: string }[] {
  const spec = STREAMS.find((s) => s.id === stream);
  if (!spec) return [];
  const seen = new Set<string>();
  const out: { vendor: string; model: string }[] = [];
  for (const p of spec.prefer) {
    const [vendor, model] = p.split("::"); // "provider::model" — split, not slice (delimiter is 2 chars)
    if (model && !seen.has(vendor)) { seen.add(vendor); out.push({ vendor, model }); }
  }
  return out;
}

/** Gemini's day is spent → produce the SAME grounded proposal from the best available free-tier API vendor.
 *  Reuses the fleet transport (scripts/agent-dispatch.mjs → server /api/agent/chat, read-only `--no-apply`)
 *  and the identical grounded prompt, so the output is apply-ready exactly like the gemini path. Budget-gated
 *  + recorded per vendor (429 latches it). Returns the written work-dir or an error. */
function poolPropose(stream: string, prompt: string): { ok: boolean; vendor?: string; model?: string; dir?: string; text?: string; err?: string } {
  const cands = apiCandidates(stream);
  if (!cands.length) return { ok: false, err: `no free-tier API vendor configured for "${stream}"` };
  const today = todayKey();
  const pick = pickVendor(cands.map((c) => c.vendor), loadBudget(BUDGET_FILE), today, cands.map((c) => c.vendor));
  if (!pick) return { ok: false, err: "whole free-tier pool exhausted — resets tomorrow" };
  const model = cands.find((c) => c.vendor === pick)!.model;
  const guard = guardVendor(BUDGET_FILE, pick, today);
  if (!guard.allowed) return { ok: false, err: guard.msg };
  const root = join(WORK, `${stream}.${pick}`);
  mkdirSync(root, { recursive: true });
  try {
    const out = execFileSync("node", [
      join(REPO, "scripts", "agent-dispatch.mjs"), prompt,
      "--provider", pick, "--model", model, "--steps", "1", "--root", root, "--no-apply", "--json",
    ], { encoding: "utf8", timeout: 300_000, env: { ...process.env, OLLAMAS_URL }, maxBuffer: 8 * 1024 * 1024 });
    const text = extractProposalText(out);
    noteVendorOutcome(BUDGET_FILE, pick, "success", today);
    return { ok: true, vendor: pick, model, dir: root, text };
  } catch (e: any) {
    const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
    if (isVendorExhausted(blob)) { noteVendorOutcome(BUDGET_FILE, pick, "exhausted", today); return { ok: false, err: `${pick} exhausted (429) — ${blob.slice(0, 120)}` }; }
    // agent-dispatch exits 1 on a valid 0-step PROPOSE answer; the JSON report is still on stdout → use it.
    const stdout = typeof e?.stdout === "string" ? e.stdout : "";
    const text = stdout ? extractProposalText(stdout) : "";
    if (text) { noteVendorOutcome(BUDGET_FILE, pick, "success", today); return { ok: true, vendor: pick, model, dir: root, text }; }
    return { ok: false, err: `${pick} dispatch failed — ${blob.slice(0, 160)}` };
  }
}

/** Pull the model's proposal body out of an agent-dispatch --json report (messages joined; SR/Change text). */
function extractProposalText(out: string): string {
  try {
    const j = JSON.parse(out);
    const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n").trim() : "";
    return msgs;
  } catch { return ""; }
}

// ── --propose <stream>: grounded fleet proposal into the work-dir ─────────────────────────────────────
if (PROPOSE) {
  const target = focusFile(PROPOSE);
  const abs = join(REPO, target);
  if (!target || !existsSync(abs)) { console.error(`gemini-run: unknown stream/target for "${PROPOSE}"`); process.exit(2); }
  const prompt = geminiGroundedPrompt(PROPOSE, target, readFileSync(abs, "utf8"));
  const r = dispatch(prompt);
  if (r.ok) {
    const dir = join(WORK, `${PROPOSE}.gemini`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROPOSAL.md"), `# ${PROPOSE} · gemini · ${r.model}\n\n${r.text}\n`);
    if (JSON_OUT) { console.log(JSON.stringify({ ok: true, stream: PROPOSE, vendor: "gemini", model: r.model, proposal: dir })); process.exit(0); }
    console.log(r.text);
    console.error(`\n[gemini-run] proposal → ${join(dir, "PROPOSAL.md")}  ·  triage: tsx orchestration/bin/fleet-apply.ts`);
    process.exit(0);
  }
  // Gemini unavailable (spent/errored) → pool fail-over: the same grounded proposal from the best free vendor,
  // so the vendor production loop never stalls on gemini alone (deliberate vendor producer, not fallback-of-plan).
  console.error(`[gemini-run] gemini unavailable (${r.err}) → pool fail-over …`);
  const p = poolPropose(PROPOSE, prompt);
  if (!p.ok) { console.error(`gemini-run --propose ${PROPOSE}: FAILED — ${p.err}`); process.exit(1); }
  const dir = p.dir!;
  writeFileSync(join(dir, "PROPOSAL.md"), `# ${PROPOSE} · ${p.vendor} · ${p.model}\n\n${p.text}\n`);
  if (JSON_OUT) { console.log(JSON.stringify({ ok: true, stream: PROPOSE, vendor: p.vendor, model: p.model, proposal: dir })); process.exit(0); }
  console.log(p.text);
  console.error(`\n[gemini-run] proposal (${p.vendor}) → ${join(dir, "PROPOSAL.md")}  ·  triage: tsx orchestration/bin/fleet-apply.ts`);
  process.exit(0);
}

// ── "<task>": arbitrary prompt ────────────────────────────────────────────────────────────────────────
const task = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--model");
if (!task) { console.error(`usage: tsx orchestration/bin/gemini-run.ts "<task>" | --propose <stream> [--model m] [--json]`); process.exit(2); }
const r = dispatch(task);
if (JSON_OUT) { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }
if (r.ok) { console.log(r.text); process.exit(0); }
console.error(`gemini-run: FAILED — ${r.err}`); process.exit(1);
