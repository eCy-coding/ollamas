#!/usr/bin/env tsx
/**
 * orchestration/bin/gemini-run.ts — dispatch a task to the Gemini CLI as a read-only PROPOSE worker and print
 * its answer. Proves the orchestra can use Gemini end-to-end (independent of the fleet), and is reused by the
 * fleet's gemini-cli provider.
 *
 * Read-only: `--approval-mode plan` means Gemini never mutates the repo (the conductor applies). Transient 503
 * "high demand" is retried with backoff and falls back to `gemini-2.5-flash`.
 *
 * Run:  tsx orchestration/bin/gemini-run.ts "<task>" [--model gemini-2.5-flash] [--json]
 */
import { execFileSync } from "node:child_process";
import { geminiArgs, parseGeminiJson, isGeminiOverload } from "./lib/gemini";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes("--json");
const MODEL = flag("--model", "gemini-2.5-flash")!;
const task = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--model");

if (!task) { console.error(`usage: tsx orchestration/bin/gemini-run.ts "<task>" [--model m] [--json]`); process.exit(2); }

const FLASH = "gemini-2.5-flash";

function run(): { ok: boolean; model: string; text: string; err?: string } {
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = attempt < 2 ? MODEL : FLASH;
    try {
      const out = execFileSync("gemini", geminiArgs(task!, m), {
        encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      });
      const g = parseGeminiJson(out);
      if (g.ok) return { ok: true, model: m, text: g.text };
      lastErr = "empty gemini response";
    } catch (e: any) {
      const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
      lastErr = blob.slice(0, 200);
      if (!isGeminiOverload(blob)) break;
    }
    console.error(`[gemini-run] attempt ${attempt + 1} failed (${lastErr.slice(0, 60)}) — backing off …`);
    try { execFileSync("sleep", [String(Math.min(8, 2 ** attempt))]); } catch { /* best-effort */ }
  }
  return { ok: false, model: MODEL, text: "", err: lastErr };
}

const r = run();
if (JSON_OUT) { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }
if (r.ok) { console.log(r.text); process.exit(0); }
console.error(`gemini-run: FAILED — ${r.err}`); process.exit(1);
