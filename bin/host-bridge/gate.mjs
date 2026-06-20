#!/usr/bin/env node
// Zero-manual quality gate runner (scripts lane, v11). ONE command runs the whole
// scripts gate in order and reports a machine-readable verdict — no human stitches
// `npm run lint && npm test && make harden && drift && swift test` by hand. Used by
// `make gate`, the CI workflow, and the autonomous trigger chain.
//
// runGate() is PURE orchestration (injectable runner) so the pass/fail logic is
// unit-tested without spawning processes. The CLI supplies a real spawnSync runner
// that THROWS on any non-zero exit (RISK-SCR-014: never swallow a step's exit code
// → a false-green gate). A step whose binary is absent is recorded as skipped
// (never silently dropped).
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { commitDecision } from "./lib/commit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OLLAMAS_REPO || join(HERE, "..", "..");

// Pure: run each step through `exec`, collect {name, ok, ms, skipped?}. Verdict.ok
// is true only if every non-skipped step passed. `now` injectable for deterministic tests.
/**
 * @param {Array<{name:string,cmd?:string,cwd?:string,skip?:boolean,reason?:string}>} steps
 * @param {{exec:(step:any)=>unknown,now?:()=>number}} [opts]
 * @returns {Promise<{ok:boolean,results:any[],failed:string[]}>}
 */
export async function runGate(steps, { exec, now = () => Date.now() } = {}) {
  if (typeof exec !== "function") throw new Error("runGate: exec runner required");
  const results = [];
  for (const s of steps) {
    if (s.skip) { results.push({ name: s.name, ok: true, skipped: true, reason: s.reason || "skipped", ms: 0 }); continue; }
    const t0 = now();
    let ok = true, error;
    try { await exec(s); } catch (e) { ok = false; error = String((e && e.message) || e); }
    results.push({ name: s.name, ok, ms: now() - t0, ...(error ? { error } : {}) });
  }
  return { ok: results.every((r) => r.ok), results, failed: results.filter((r) => !r.ok).map((r) => r.name) };
}

// True if a binary is on PATH (for graceful skip of swift/actionlint where absent).
// Pure PATH scan (no shell, no process spawn) — avoids shell-injection surface.
function have(bin) {
  return (process.env.PATH || "").split(":").some((dir) => {
    if (!dir) return false;
    try { accessSync(join(dir, bin), constants.X_OK); return true; } catch { return false; }
  });
}

// The canonical scripts gate, in order. cmd runs via `bash -lc` from REPO (or cwd).
export function defaultSteps() {
  return [
    { name: "tsc", cmd: "npx tsc --noEmit" },
    { name: "vitest", cmd: "npx vitest run" },
    { name: "harden", cmd: "make harden" },
    { name: "drift", cmd: "node bin/host-bridge/drift-check.mjs" },
    have("swift")
      ? { name: "swift", cmd: "swift build && swift test", cwd: join(REPO, "bin", "ios-bridge") }
      : { name: "swift", skip: true, reason: "swift not on PATH" },
    have("actionlint")
      ? { name: "actionlint", cmd: "actionlint" }
      : { name: "actionlint", skip: true, reason: "actionlint not on PATH (CI docker image covers it)" },
    // Opt-in budget SLO-step: over the monthly unit budget → gate RED (v12).
    ...(process.env.USAGE_BUDGET
      ? [{ name: "budget", cmd: `node bin/host-bridge/tools/usage.mjs --budget ${Number(process.env.USAGE_BUDGET) || 0}` }]
      : []),
  ];
}

// Scope-guarded autonomous commit after a green gate (v12). git via arg-arrays
// (no shell) — never push, never tag. Returns {ok, reason}.
function autoCommit(message) {
  if (!message) return { ok: false, reason: "--commit requires --message \"<conventional msg>\"" };
  const st = spawnSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" });
  if (st.status !== 0) return { ok: false, reason: "git status failed" };
  const decision = commitDecision(st.stdout, message);
  if (!decision.ok) return { ok: false, reason: decision.reason, violations: decision.violations };
  for (const path of decision.stage) {
    const add = spawnSync("git", ["-C", REPO, "add", "--", path], { stdio: "inherit" });
    if (add.status !== 0) return { ok: false, reason: `git add failed: ${path}` };
  }
  const ci = spawnSync("git", ["-C", REPO, "commit", "-m", message], { stdio: "inherit" });
  if (ci.status !== 0) return { ok: false, reason: "git commit failed" };
  return { ok: true, reason: "committed", staged: decision.stage };
}

// Real runner: spawn the command, THROW on non-zero exit so runGate marks it failed.
function spawnExec(step) {
  const r = spawnSync("bash", ["-lc", step.cmd], { cwd: step.cwd || REPO, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${step.name} exited ${r.status ?? "signal " + r.signal}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const jsonOut = process.argv.includes("--json");
  const verdict = await runGate(defaultSteps(), { exec: spawnExec });
  if (jsonOut) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log("──────────── scripts gate ────────────");
    for (const r of verdict.results) {
      const tag = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
      console.log(`  ${tag}  ${r.name.padEnd(10)} ${r.skipped ? "(" + r.reason + ")" : Math.round(r.ms) + "ms"}`);
    }
    console.log("───────────────────────────────────────");
    console.log(verdict.ok ? "[+] GATE GREEN" : `[!] GATE RED — failed: ${verdict.failed.join(", ")}`);
  }
  if (!verdict.ok) process.exit(1);

  // --commit: autonomous scope-guarded conventional commit on a green gate (v12).
  if (process.argv.includes("--commit")) {
    const mi = process.argv.indexOf("--message");
    const message = mi >= 0 ? process.argv[mi + 1] : "";
    const res = autoCommit(message);
    if (!res.ok) {
      console.error(`[!] auto-commit blocked: ${res.reason}` + (res.violations?.length ? ` → ${res.violations.join(", ")}` : ""));
      process.exit(1);
    }
    console.log(`[+] auto-committed ${res.staged.length} file(s) (no push, no tag): ${message.split("\n")[0]}`);
  }
  process.exit(0);
}
