#!/usr/bin/env node
// tools_doctor — observability self-test for the toolkit. Runs the fast,
// read-only tools and verifies they return ok; for slow/destructive tools it
// only checks the file is present + parses. Emits a JSON health matrix.
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, main } from "./lib/bridge-client.mjs";

const execFileP = promisify(execFile);
const DIR = dirname(fileURLToPath(import.meta.url));

// [name, args, mode]  mode: "run" = execute + expect ok; "check" = presence+syntax only
const PLAN = [
  ["health_probe", [], "run"],
  ["git_ops", ["status"], "run"],
  ["process_port", ["3000"], "run"],
  ["log_stream", ["5"], "run"],
  ["web_search", ["bridge automation"], "run"],
  ["run_tests", [], "check"],
  ["lint_format", [], "check"],
  ["build_app", [], "check"],
  ["git_commit", [], "check"],
  ["kill_process", [], "check"],
  ["pkg_install", [], "check"],
  ["apply_patch", [], "check"],
];

async function probe([name, args, mode]) {
  const file = join(DIR, `${name}.mjs`);
  if (!existsSync(file)) return { name, ok: false, mode, note: "missing" };
  if (mode === "check") {
    try { await execFileP("node", ["--check", file]); return { name, ok: true, mode, note: "parses" }; }
    catch (e) { return { name, ok: false, mode, note: "syntax error" }; }
  }
  try {
    const { stdout } = await execFileP("node", [file, ...args], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    let ok = true;
    try { ok = JSON.parse(stdout).ok !== false; } catch { ok = stdout.trim().length > 0; }
    return { name, ok, mode, note: ok ? "ok" : "returned ok:false" };
  } catch (e) {
    return { name, ok: false, mode, note: String(e.code || e.message || e).slice(0, 60) };
  }
}

main(async () => {
  const results = [];
  for (const p of PLAN) results.push(await probe(p)); // serial: bridge /run is mutex'd
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  emit({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed, results });
});
