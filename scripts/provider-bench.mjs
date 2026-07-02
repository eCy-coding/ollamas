#!/usr/bin/env node
// @ts-check
// scripts/provider-bench.mjs — head-to-head provider benchmark for the "which path is best"
// decision (correctness → success-rate → latency). Repeatable; spends a little quota per cloud
// path (capped reps). Read-only otherwise; no key handling.
//
//   npm run provider:bench
//   REPS=2 GATEWAY=http://127.0.0.1:3000 node scripts/provider-bench.mjs

const PROVIDERS = [
  { provider: "gemini", model: "", note: "api-key pool (rotation)" },
  { provider: "gemini-cli", model: "", note: "keyless OAuth" },
  { provider: "ollama-local", model: "qwen3:8b", note: "$0 local baseline" },
];

/** @typedef {{ provider: string, n: number, ok: number, avgMs: number, source?: string }} BenchRow */

/** Rank results by success-rate desc, then avg latency asc. Pure → unit-tested.
 *  @param {BenchRow[]} results @returns {BenchRow[]} */
export function rankResults(results) {
  return [...results].sort((a, b) => (b.ok / b.n - a.ok / a.n) || (a.avgMs - b.avgMs));
}

/** @param {BenchRow} r @returns {string} */
export function fmtRow(r) {
  const rate = `${r.ok}/${r.n}`;
  const avg = r.ok > 0 ? `${(r.avgMs / 1000).toFixed(2)}s` : "n/a";
  return `${r.provider.padEnd(13)} ${rate.padEnd(5)} ${avg.padEnd(8)} ${r.source || "-"}`;
}

/** @param {string} gateway @param {string} provider @param {string} model
 *  @returns {Promise<{ ok: boolean, ms: number, source: string }>} */
async function one(gateway, provider, model) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${gateway}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, messages: [{ role: "user", content: "reply with exactly: OK" }] }),
      signal: AbortSignal.timeout(90000),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, ms, source: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, ms, source: j.source };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, source: String(e?.name || "err") };
  }
}

async function main() {
  const gateway = (process.env.GATEWAY || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const n = Math.max(1, Math.min(5, Number(process.env.REPS || 3)));
  const results = [];
  for (const { provider, model } of PROVIDERS) {
    let ok = 0, sum = 0, source = "";
    for (let i = 0; i < n; i++) {
      const r = await one(gateway, provider, model);
      if (r.ok) { ok++; sum += r.ms; source = r.source; }
      else source = source || r.source;
    }
    results.push({ provider, n, ok, avgMs: ok > 0 ? sum / ok : Infinity, source });
  }
  console.log(`\nPROVIDER BENCH (${n} reps · success → latency)\n${"provider".padEnd(13)} ok    avg      source`);
  for (const r of rankResults(results)) console.log(fmtRow(r));
  const best = rankResults(results).find((r) => r.ok > 0);
  if (best) console.log(`\nBest: ${best.provider} (${best.source}, ${(best.avgMs / 1000).toFixed(2)}s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
