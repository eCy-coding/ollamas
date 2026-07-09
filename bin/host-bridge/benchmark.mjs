#!/usr/bin/env node
// @ts-check
// E2E coding benchmark: for each model, ask the app to WRITE a program
// (/api/generate), then RUN it in a real macOS terminal (/api/macos-terminal),
// and score correctness + speed. Also benchmarks terminal targets. Writes a
// ranked report to ~/.llm-mission-control/benchmark.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePlatformArg, detectDevice, benchRecord, scoreRun } from "./bench-metrics.mjs";
import { rankModels, pickModel } from "./lib/model-select.mjs";

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const STATE = path.join(os.homedir(), ".llm-mission-control");
const PLATFORM = parsePlatformArg(process.argv); // macos | ios (default macos)
const DEVICE = detectDevice();

// Models to benchmark: [provider, model]
const MODELS = [
  ["ollama-local", "qwen3:4b"],
  ["ollama-local", "qwen3:8b"],
  ["ollama-local", "gpt-oss:20b"],
  ["ollama-local", "qwen3-coder:30b"],
  ["gemini", "gemini-3.5-flash"],
];

// Fixed coding task with a deterministic expected output.
const TASK =
  "Write a complete Python 3 program that prints the first 10 prime numbers " +
  "separated by single spaces on one line (e.g. '2 3 5 7 ...'). " +
  "Output ONLY the code, no explanation, no markdown fences.";
const EXPECTED = "2 3 5 7 11 13 17 19 23 29";

function stripFences(s) {
  // remove ```lang ... ``` fences if model added them
  const m = s.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

async function generate(provider, model) {
  const t0 = Date.now();
  const res = await fetch(`${APP}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      model,
      messages: [{ role: "user", content: TASK }],
      temperature: 0,
      stream: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { gen_ms: Date.now() - t0, text: body.text || "", tok_s: body.tokensPerSec, source: body.source };
}

async function runInTerminal(target, command, timeoutMs = 60000) {
  // Honesty (v1.25.1): a fetch-throw (bridge daemon down) or a !res.ok (macOS-TCC
  // denial, 5xx) means we COULD NOT MEASURE — surface it as {bridgeError} so the
  // caller records correct/ran = null, never a false "wrong answer".
  try {
    const res = await fetch(`${APP}/api/macos-terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, command, timeoutMs }),
    });
    if (!res.ok) return { bridgeError: true, status: `HTTP ${res.status}` };
    return await res.json().catch(() => ({ bridgeError: true, status: "invalid-json" }));
  } catch (e) {
    return { bridgeError: true, status: e.message || "fetch-failed" };
  }
}

(async () => {
  console.log(`== E2E coding benchmark (${APP}) ==`);
  console.log(`platform: ${PLATFORM}  device: ${DEVICE.device} (${DEVICE.cpuModel}, ${DEVICE.ncpu}c/${DEVICE.memGb}GB ${DEVICE.arch})`);
  console.log(`task: first 10 primes  expected: "${EXPECTED}"\n`);

  // Terminal axis FIRST: pick the working/fastest terminal for the code runs.
  console.log("== terminal latency (avg of 3, echo) ==");
  const termStats = {};
  for (const target of ["iterm2", "terminal"]) {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const r = await runInTerminal(target, `echo bench_${i}`, 20000);
      if (typeof r.durationMs === "number" && !r.timedOut) samples.push(r.durationMs);
    }
    const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null;
    termStats[target] = avg;
    console.log(`  ${target}: ${avg === null ? "TIMEOUT/FAIL" : avg + "ms"} (ok=${samples.length}/3)`);
  }
  const bestTerminal = (termStats.iterm2 ?? 1e9) <= (termStats.terminal ?? 1e9) ? "iterm2" : "terminal";
  const runTarget = termStats[bestTerminal] != null ? bestTerminal : (termStats.terminal != null ? "terminal" : "iterm2");
  console.log(`  -> using "${runTarget}" for model code runs\n`);

  const results = [];
  for (const [provider, model] of MODELS) {
    const tag = `${provider}/${model}`;
    process.stdout.write(`• ${tag} ... `);
    try {
      const g = await generate(provider, model);
      const code = stripFences(g.text);
      if (!code) { console.log("NO CODE"); results.push({ model: tag, ran: false, correct: false, gen_ms: g.gen_ms }); continue; }
      // Write code straight to a host file (we run on the host), then just run
      // it in the terminal — avoids shell-escaping / base64 portability issues.
      const file = `/tmp/bench_${model.replace(/[^a-z0-9]/gi, "_")}.py`;
      fs.writeFileSync(file, code + "\n");
      const r = await runInTerminal(runTarget, `python3 ${file}`, 25000); // watchdog kills hangs ~20s
      // Honest scoring: bridgeError → correct/ran = null (unmeasured ≠ wrong); tok/s stays real.
      const s = scoreRun(r, EXPECTED);
      const rec = {
        model: tag, gen_ms: g.gen_ms, tok_s: g.tok_s ? +g.tok_s.toFixed(1) : null,
        exec_ms: r.durationMs ?? null, ran: s.ran, correct: s.correct,
        total_ms: g.gen_ms + (r.durationMs || 0), out: s.out.slice(0, 40),
        ...(s.bridgeError ? { bridgeError: s.bridgeError } : {}),
      };
      results.push(rec);
      if (s.bridgeError) {
        console.log(`? bridge-error (${s.bridgeError}) — unmeasured | gen ${g.gen_ms}ms ${rec.tok_s || "?"}tok/s`);
      } else {
        console.log(`${s.correct ? "✓ correct" : (rec.ran ? "✗ wrong out" : "✗ failed")} | gen ${g.gen_ms}ms ${rec.tok_s || "?"}tok/s | exec ${r.durationMs}ms`);
      }
    } catch (e) {
      console.log("ERROR", e.message);
      results.push({ model: tag, ran: false, correct: false, error: e.message });
    }
  }

  // Rank + pick via the shared pure selector (v17, single source of ranking
  // truth; default metric "latency" preserves the prior correct-first→total_ms).
  const ranked = rankModels(results);
  const best = pickModel(results);
  const bestModel = best.model;

  console.log("\n== RANKED (correct first, then total latency) ==");
  ranked.forEach((r, i) => console.log(`  ${i + 1}. ${r.model} ${r.correct == null ? "?" : r.correct ? "✓" : "✗"} total=${r.total_ms || "-"}ms tok/s=${r.tok_s || "-"}`));
  console.log(`\n>> bestModel: ${bestModel}  (${best.reason})  bestTerminal: ${bestTerminal}`);

  // v4 cross-platform schema: one normalized record per model, keyed by
  // platform+device+method so macOS and iOS runs accumulate in the same file.
  const ts = new Date().toISOString();
  const method = PLATFORM === "ios" ? "ios-cli" : "app-generate";
  const records = results.map((/** @type {any} */ r) =>
    benchRecord({
      platform: PLATFORM,
      device: DEVICE.device,
      method,
      model: r.model,
      responseTps: r.tok_s ?? null,
      latencyMs: r.total_ms ?? r.gen_ms ?? null,
      correct: r.correct ?? null,
      ts,
    }),
  );
  const report = { ts, platform: PLATFORM, device: DEVICE, task: "first10primes", expected: EXPECTED, results: ranked, records, termStats, bestModel, bestTerminal };
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, "benchmark.json"), JSON.stringify(report, null, 2));
  console.log(`\nreport -> ${path.join(STATE, "benchmark.json")}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
