#!/usr/bin/env node
// mcp-tool-test — exercise each ollamas /mcp tool one-by-one with SAFE args (read-only/scratch).
// Real-time, deterministic (no LLM unless the tool is an LLM tool). Destructive tools are SKIPPED
// with a reason. Output: per-tool OK/ERR/SKIP table. Reusable (harness-ops --deep can call it).
//   node .claude/mcp-tool-test.mjs

import { mkdirSync } from "node:fs";
const URL = process.env.OLLAMAS_URL || "http://127.0.0.1:8090";
const TMP = "/tmp/mcp-tool-test";
const ACCEPT = "application/json, text/event-stream";

// Safe-arg matrix. value=args object to test; SKIP=reason string (not called).
const SKIP = {
  git_commit: "mutates history", build_app: "slow build", kill_process: "kills procs",
  pkg_install: "installs pkgs", apply_patch: "mutates files", self_heal: "mutates (apply)",
  bench_model: "slow/cost", test_generate: "LLM+writes", code_audit: "LLM heavy",
  storefront_generate: "writes/outward", eval_prompt: "needs config+LLM",
  run_tests: "slow (vitest 864) — run via npm test", lint_format: "slow (tsc) — run via gate",
};
const ARGS = {
  list_tree: {}, read_file: { path: "package.json" }, run_command: { command: "echo mcp-ok" },
  grep_search: { query: "ollamas" }, git_ops: { sub: "status" }, process_port: { port: 8090 },
  health_probe: {}, log_stream: { lines: 3 }, web_search: { query: "model context protocol" },
  tools_doctor: {}, shell_check: { command: "ls -la" }, logbook: { action: "tail", n: 3 },
  sample: { prompt: "Reply with the single word OK", maxTokens: 8 }, rag_search: { query: "harness" },
  count_tokens: { text: "hello world from mcp tool test" }, download_file: { path: "package.json" },
  seyir_stats: { json: true }, usage: { json: true }, model_select: { json: true },
  mac_power: { interval_ms: 200 },
  // scratch-safe destructive:
  write_file: { path: `${TMP}/w.txt`, content: "scratch" },
  write_host_file: { path: `${TMP}/wh.txt`, content: "scratch" },
  macos_terminal: { command: "echo mcp-term-ok", target: "iterm2" },
  rag_index: { id: "mcptest", text: "scratch rag index entry" },
  upload_file: { path: `${TMP}/up.txt`, base64: Buffer.from("scratch").toString("base64") },
};

async function call(name, args) {
  const res = await fetch(`${URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ") || l.startsWith("{")) || text;
  const json = JSON.parse(line.replace(/^data: /, ""));
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  const out = JSON.stringify(json.result?.content || json.result || "").slice(0, 60);
  return out;
}

const tools = (await (async () => {
  const res = await fetch(`${URL}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: ACCEPT }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const t = await res.text();
  return JSON.parse((t.split("\n").find((l) => l.startsWith("data: ") || l.startsWith("{")) || t).replace(/^data: /, "")).result.tools.map((x) => x.name);
})());

mkdirSync(TMP, { recursive: true });
let ok = 0, err = 0, skip = 0;
const rows = [];
for (const name of tools) {
  if (SKIP[name]) { rows.push([name, "SKIP", SKIP[name]]); skip++; continue; }
  if (!(name in ARGS)) { rows.push([name, "SKIP", "no safe-arg defined"]); skip++; continue; }
  try { const o = await call(name, ARGS[name]); rows.push([name, "OK", o]); ok++; }
  catch (e) { rows.push([name, "ERR", String(e.message).slice(0, 60)]); err++; }
}

console.log(`# MCP tool test — ${ok} OK · ${err} ERR · ${skip} SKIP / ${tools.length} tools\n`);
console.log("| tool | st | evidence |\n|---|:--:|---|");
for (const [n, s, e] of rows) console.log(`| ${n} | ${s} | ${String(e).replace(/\|/g, "/").slice(0, 56)} |`);
process.exit(err > 0 ? 1 : 0);
