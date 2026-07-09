#!/usr/bin/env node
// @ts-check
// Automated proof for the macOS terminal bridge. Drives REAL iTerm2 + Terminal.app.
// First run triggers a one-time macOS Automation (TCC) prompt — approve it, then
// reruns are uninterrupted. Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.PORT || 7345;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN =
  process.env.HOST_BRIDGE_TOKEN ||
  (() => { try { return fs.readFileSync(path.join(os.homedir(), ".llm-mission-control/bridge.token"), "utf8").trim(); } catch { return ""; } })();

let pass = 0, fail = 0;
function ok(name, cond, extra = "") { (cond ? (pass++, console.log(`  ✓ ${name} ${extra}`)) : (fail++, console.log(`  ✗ ${name} ${extra}`))); }

async function run(target, command, timeoutMs = 60000, withToken = true) {
  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withToken ? { "X-Bridge-Token": TOKEN } : {}) },
    body: JSON.stringify({ target, command, timeoutMs }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  console.log("== macOS terminal bridge tests ==");

  // 1. health
  const h = await fetch(`${BASE}/health`).then((r) => r.json());
  ok("health ok", h.ok === true);
  ok("iTerm2 detected", h.terminals?.iterm2 === true);
  ok("Terminal.app detected", h.terminals?.terminal === true);

  // 2/3. echo roundtrip both terminals
  for (const t of ["terminal", "iterm2"]) {
    const stamp = `BRIDGE_OK_${t}_${Date.now()}`;
    const r = await run(t, `echo ${stamp}`);
    ok(`${t}: echo roundtrip`, r.body.ok && r.body.output?.includes(stamp), `rc=${r.body.exitCode} ${r.body.durationMs}ms`);
  }

  // 4. multi-step coding flow on iterm2: write a python file, run it
  const py = "/tmp/llm-bridge-fib.py";
  const flow = `printf 'a,b=0,1\\nfor _ in range(8):\\n  print(a,end=" ")\\n  a,b=b,a+b\\nprint()\\n' > ${py} && python3 ${py}`;
  const f = await run("iterm2", flow);
  ok("coding flow: python fib runs", f.body.ok && f.body.output?.includes("0 1 1 2 3 5 8 13"), `out="${(f.body.output || "").trim().slice(-30)}"`);
  ok("coding flow: file created on host", fs.existsSync(py));

  // 5. exit code propagation
  const ec = await run("terminal", `sh -c 'exit 3'`);
  ok("exit code captured", ec.body.exitCode === 3, `got ${ec.body.exitCode}`);

  // 6. timeout
  const to = await run("terminal", `sleep 5`, 1200);
  ok("timeout handled", to.body.timedOut === true, `timedOut=${to.body.timedOut}`);

  // 7. token rejection (only meaningful if token configured)
  if (TOKEN) {
    const bad = await run("terminal", `echo nope`, 5000, false);
    ok("token rejection (401)", bad.status === 401, `status=${bad.status}`);
  } else {
    console.log("  - token test skipped (no token configured)");
  }

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
