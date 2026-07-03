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
import { apiVendorCandidates, isActionableProposal, extractProposalText } from "./lib/vendor-propose";
import { isTransient, fullJitterDelay } from "./lib/backoff";

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

/** One dispatch to an API vendor via the fleet transport (agent-dispatch → server /api/agent/chat, read-only).
 *  Classifies the outcome so the caller can retry (transient), fail over (exhausted), or accept (text). */
function dispatchVendorOnce(vendor: string, model: string, prompt: string, root: string): { text: string; exhausted: boolean; transient: boolean; err?: string } {
  try {
    const out = execFileSync("node", [
      join(REPO, "scripts", "agent-dispatch.mjs"), prompt,
      "--provider", vendor, "--model", model, "--steps", "1", "--root", root, "--no-apply", "--json",
    ], { encoding: "utf8", timeout: 300_000, env: { ...process.env, OLLAMAS_URL }, maxBuffer: 8 * 1024 * 1024 });
    return { text: extractProposalText(out), exhausted: false, transient: false };
  } catch (e: any) {
    // agent-dispatch exits 1 on a valid 0-step PROPOSE answer; the JSON report is still on stdout → use it.
    const stdout = typeof e?.stdout === "string" ? e.stdout : "";
    const text = stdout ? extractProposalText(stdout) : "";
    if (text) return { text, exhausted: false, transient: false };
    const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
    if (isVendorExhausted(blob)) return { text: "", exhausted: true, transient: false, err: blob.slice(0, 160) };
    return { text: "", exhausted: false, transient: isTransient(blob), err: blob.slice(0, 160) };
  }
}

/** Gemini's day is spent → produce the SAME grounded proposal from the free-tier API pool, RELIABLY:
 *  iterate the stream's vendors in most-remaining-budget order; per vendor retry transient failures with
 *  jittered backoff; latch + fail over on a real 429; and — crucially — only ACCEPT an answer that is an
 *  actionable SEARCH/REPLACE proposal (never write/return an empty or prose body → the vО60 empty-success bug).
 *  Reuses the identical grounded prompt so the output is apply-ready exactly like the gemini path. */
function poolPropose(stream: string, prompt: string): { ok: boolean; vendor?: string; model?: string; dir?: string; text?: string; err?: string } {
  const cands = apiVendorCandidates(stream);
  if (!cands.length) return { ok: false, err: `no free-tier API vendor configured for "${stream}"` };
  const today = todayKey();
  const tried = new Set<string>();
  let lastErr = "no free-tier vendor produced an actionable proposal";
  for (;;) {
    const left = cands.filter((c) => !tried.has(c.vendor));
    if (!left.length) break;
    const pick = pickVendor(left.map((c) => c.vendor), loadBudget(BUDGET_FILE), today, left.map((c) => c.vendor));
    if (!pick) { lastErr = "whole free-tier pool exhausted — resets tomorrow"; break; }
    tried.add(pick);
    if (!guardVendor(BUDGET_FILE, pick, today).allowed) { lastErr = `${pick} daily budget spent`; continue; }
    const model = left.find((c) => c.vendor === pick)!.model;
    const root = join(WORK, `${stream}.${pick}`);
    mkdirSync(root, { recursive: true });
    // transient-retry (503/timeout/network) with full-jitter backoff — a single hiccup must not sink the run.
    let res = dispatchVendorOnce(pick, model, prompt, root);
    for (let attempt = 0; res.transient && attempt < 2; attempt++) {
      const d = fullJitterDelay(attempt, 1500, 20_000);
      console.error(`[gemini-run] ${pick} transient (${(res.err ?? "").slice(0, 50)}) → backoff ${(d / 1000).toFixed(1)}s …`);
      try { execFileSync("sleep", [String(Math.max(1, Math.ceil(d / 1000)))]); } catch { /* best-effort */ }
      res = dispatchVendorOnce(pick, model, prompt, root);
    }
    if (res.exhausted) { noteVendorOutcome(BUDGET_FILE, pick, "exhausted", today); lastErr = `${pick} exhausted (429)`; continue; }
    if (res.transient) { lastErr = `${pick} transient failures — ${res.err}`; continue; } // fail over (retries spent)
    // A request completed (quota consumed) → count it truthfully; but ONLY accept + write an ACTIONABLE proposal.
    noteVendorOutcome(BUDGET_FILE, pick, "success", today);
    if (isActionableProposal(res.text)) return { ok: true, vendor: pick, model, dir: root, text: res.text };
    lastErr = `${pick} returned a non-actionable proposal (no SEARCH/REPLACE)`;
  }
  return { ok: false, err: lastErr };
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
