#!/usr/bin/env node
// agent-dispatch — drive the local ollamas ReAct agent as a calibrated sub-agent.
//
// Hands a task to /api/agent/chat (real host tools: write_host_file + macos_terminal
// in iTerm2/Terminal.app + safe tools), streams the SSE run, and prints ONE compact
// structured REPORT (per-step tool/ok/output, files written, demo detection, verdict).
// This is the "sub-agent reports back to me" contract: deterministic stdout, exit 0
// only when every step succeeded and a real (non-demo) provider served the run.
//
// Usage:
//   node scripts/agent-dispatch.mjs "<task>" [--model qwen3:8b] [--provider ollama-local]
//                                            [--root <abs-write-root>] [--steps 10] [--json]
//   echo "<task>" | node scripts/agent-dispatch.mjs --model qwen3-coder:30b
//   node scripts/agent-dispatch.mjs "<task>" --remote desktop-ert7724 [--port 8090]
//
// Env: OLLAMAS_URL (default http://127.0.0.1:8090), OLLAMAS_TIMEOUT_MS (default 180000).

const args = process.argv.slice(2);
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

// Target host: --remote <host>[:--port] overrides OLLAMAS_URL (fleet dispatch — drive the ReAct
// loop ON a remote worker; body/SSE/report/exit semantics stay identical). Default = local.
const REMOTE = opt("--remote", null);
const PORT = opt("--port", "8090");
const URL = REMOTE ? `http://${REMOTE}:${PORT}` : (process.env.OLLAMAS_URL || "http://127.0.0.1:8090");
// Provider: --provider flag > OLLAMAS_PROVIDER env > ollama-local default. (env knob lets the
// harness pin a provider, e.g. gemini/ollama-cloud, without editing this script.)
const PROVIDER = opt("--provider", process.env.OLLAMAS_PROVIDER || "ollama-local");
// ollama-local → bench-proven qwen3:8b default (docs/AGENT_TOPOLOGY.md: fastest correct on
// coding; avoid qwen3:4b = demo-suspected). Override with --model or OLLAMAS_MODEL; other
// providers keep their own default (empty → omitted). ready.mjs guarantees qwen3:8b is pulled.
const MODEL = opt("--model", PROVIDER === "ollama-local" ? (process.env.OLLAMAS_MODEL || "qwen3:8b") : (process.env.OLLAMAS_MODEL || ""));
const STEPS = Number(opt("--steps", "10"));
const TIMEOUT = Number(process.env.OLLAMAS_TIMEOUT_MS || "180000");
const ROOT = opt("--root", `${process.env.HOME}/.llm-mission-control/agent-work`);
const JSON_OUT = has("--json");

// The task is the first non-flag arg, or stdin.
const positional = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
let task = positional[0];
if (!task && !process.stdin.isTTY) task = (await import("node:fs")).readFileSync(0, "utf8").trim();
if (!task) { console.error("usage: agent-dispatch \"<task>\" [--model m] [--provider p] [--root dir] [--steps n] [--remote host] [--port p] [--json]"); process.exit(2); }

// eCyPro calibration: my standards, injected into the task so the sub-agent matches
// the main-thread quality bar (root-cause, evidence, terse, real output, clear verdict).
const STANDARDS = [
  "[ollamas sub-agent — operate at eCyPro standards]",
  "- Minimize steps. Do NOT call the same tool twice with the same args. No exploration the task does not require.",
  `- The ONLY writable root is ${ROOT} — write files there with absolute paths.`,
  "- For a fresh file: write_host_file it directly, then immediately macos_terminal to RUN it and show the exact stdout. Investigate existing code (read_file/grep_search) ONLY when the task references code that already exists.",
  "- grep_search: pass ONE literal pattern, NO shell metacharacters (| & ; > < ` $ are blocked). For alternation run separate searches. If a tool is refused, change approach — do NOT retry the same call.",
  "- Evidence over assertion: never fabricate output — show the real macos_terminal stdout and confirm it matches the expected result.",
  "- If a tool errors, report the exact error and stop (do not retry blindly).",
  "- When the result is verified, STOP immediately and emit a final line exactly: VERDICT: DONE <one-line proof>   (or  VERDICT: BLOCKED <reason>).",
  "",
  "TASK:",
  task,
].join("\n");

const body = JSON.stringify({ provider: PROVIDER, ...(MODEL ? { model: MODEL } : {}), autoApply: true, maxSteps: STEPS,
  messages: [{ role: "user", content: STANDARDS }] });

/** @type {{url:string,provider:string,model:string,root:string,steps:{n:number,tool:string,ok:boolean,out:string}[],messages:string[],files:string[],errors:string[],demoSuspected:boolean}} */
const report = { url: URL, provider: PROVIDER, model: MODEL || "(provider default)", root: ROOT, steps: [], messages: [], files: [], errors: [], demoSuspected: false };

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), TIMEOUT);

try {
  const res = await fetch(`${URL}/api/agent/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ac.signal,
  });
  if (!res.ok || !res.body) { console.error(`dispatch failed: HTTP ${res.status}`); process.exit(1); }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      let ev; try { ev = JSON.parse(s.slice(5).trim()); } catch { continue; }
      if (ev.type === "step") {
        const out = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result);
        report.steps.push({ n: ev.stepNum, tool: ev.tool, ok: ev.ok, out: (out || "").slice(0, 2000) });
        if (ev.tool === "write_host_file" || ev.tool === "write_file") {
          const p = ev.args?.path; if (p) report.files.push(p);
        }
      } else if (ev.type === "message") {
        if (ev.text?.trim()) report.messages.push(ev.text.trim());
      } else if (ev.type === "done") {
        if (ev.text?.trim()) report.messages.push(ev.text.trim());
      } else if (ev.type === "error") {
        report.errors.push(ev.message || "unknown");
      }
    }
  }
} catch (e) {
  report.errors.push(ac.signal.aborted ? `timeout after ${TIMEOUT}ms` : (e?.message || String(e)));
} finally {
  clearTimeout(timer);
}

// Demo detection: a real run drives tools; zero tool steps + a chatty message is the
// classic demo/refusal signature.
report.demoSuspected = report.steps.length === 0 && report.messages.length > 0 && report.errors.length === 0;
const allOk = report.steps.length > 0 && report.steps.every((s) => s.ok) && report.errors.length === 0 && !report.demoSuspected;
const finalMsg = report.messages[report.messages.length - 1] || "";
const verdict = /VERDICT:\s*DONE/i.test(finalMsg) ? "DONE" : /VERDICT:\s*BLOCKED/i.test(finalMsg) ? "BLOCKED" : (allOk ? "OK" : "INCOMPLETE");

if (JSON_OUT) { console.log(JSON.stringify({ ...report, allOk, verdict }, null, 2)); process.exit(allOk ? 0 : 1); }

const L = [];
L.push(`── ollamas sub-agent report ──  ${PROVIDER}/${report.model}`);
for (const s of report.steps) L.push(`  step ${s.n}  ${s.ok ? "✓" : "✗"} ${s.tool}  →  ${s.out.replace(/\n/g, " ").slice(0, 120)}`);
if (report.files.length) L.push(`  files: ${[...new Set(report.files)].join(", ")}`);
if (report.errors.length) L.push(`  errors: ${report.errors.join(" | ").slice(0, 300)}`);
if (report.demoSuspected) L.push(`  ⚠ demo/no-tool run suspected (no tool steps)`);
if (finalMsg) L.push(`  final: ${finalMsg.replace(/\n/g, " ").slice(0, 240)}`);
L.push(`  VERDICT: ${verdict}  (${report.steps.length} steps, ${report.steps.filter((s) => s.ok).length} ok)`);
console.log(L.join("\n"));
process.exit(allOk ? 0 : 1);
