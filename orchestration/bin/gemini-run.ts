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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const WORK = join(homedir(), ".llm-mission-control", "fleet", "work");

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes("--json");
const MODEL = flag("--model", "gemini-2.5-flash")!;
const PROPOSE = flag("--propose");
const FLASH = "gemini-2.5-flash";

/** Dispatch a prompt to Gemini with 503 backoff + flash fallback. */
function dispatch(prompt: string): { ok: boolean; model: string; text: string; err?: string } {
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = attempt < 2 ? MODEL : FLASH;
    try {
      const out = execFileSync("gemini", geminiArgs(prompt, m), {
        encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      });
      const g = parseGeminiJson(out);
      if (g.ok) return { ok: true, model: m, text: g.text };
      lastErr = "empty gemini response";
    } catch (e: any) {
      const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
      lastErr = blob.slice(0, 200);
      if (isGeminiQuotaExhausted(blob) || !isGeminiOverload(blob)) break; // terminal quota / non-transient → stop
    }
    console.error(`[gemini-run] attempt ${attempt + 1} failed (${lastErr.slice(0, 60)}) — backing off …`);
    try { execFileSync("sleep", [String(Math.min(8, 2 ** attempt))]); } catch { /* best-effort */ }
  }
  return { ok: false, model: MODEL, text: "", err: lastErr };
}

// ── --propose <stream>: grounded fleet proposal into the work-dir ─────────────────────────────────────
if (PROPOSE) {
  const target = focusFile(PROPOSE);
  const abs = join(REPO, target);
  if (!target || !existsSync(abs)) { console.error(`gemini-run: unknown stream/target for "${PROPOSE}"`); process.exit(2); }
  const prompt = geminiGroundedPrompt(PROPOSE, target, readFileSync(abs, "utf8"));
  const r = dispatch(prompt);
  if (!r.ok) { console.error(`gemini-run --propose ${PROPOSE}: FAILED — ${r.err}`); process.exit(1); }
  const dir = join(WORK, `${PROPOSE}.gemini`);
  mkdirSync(dir, { recursive: true });
  const md = `# ${PROPOSE} · gemini · ${r.model}\n\n${r.text}\n`;
  writeFileSync(join(dir, "PROPOSAL.md"), md);
  if (JSON_OUT) { console.log(JSON.stringify({ ok: true, stream: PROPOSE, model: r.model, proposal: dir })); process.exit(0); }
  console.log(r.text);
  console.error(`\n[gemini-run] proposal → ${join(dir, "PROPOSAL.md")}  ·  triage: tsx orchestration/bin/fleet-apply.ts`);
  process.exit(0);
}

// ── "<task>": arbitrary prompt ────────────────────────────────────────────────────────────────────────
const task = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--model");
if (!task) { console.error(`usage: tsx orchestration/bin/gemini-run.ts "<task>" | --propose <stream> [--model m] [--json]`); process.exit(2); }
const r = dispatch(task);
if (JSON_OUT) { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }
if (r.ok) { console.log(r.text); process.exit(0); }
console.error(`gemini-run: FAILED — ${r.err}`); process.exit(1);
