#!/usr/bin/env tsx
/**
 * orchestration/bin/gate.ts — the ONE truthful quality gate. Runs `tsc --noEmit` + `vitest run`, captures each
 * command's REAL exit status and output (execFileSync throws on nonzero → we read e.status/e.stdout), and
 * reports the true verdict. There is no pipe that could mask the exit code (the RISK-ORCH-041 bug).
 *
 * Use THIS instead of ad-hoc `tsc 2>&1 | head; echo $?` — a piped tail/head makes `$?` the pipe's LAST stage,
 * silently hiding a red tsc. Extensible: add a check to CHECKS and it is measured + gated the same way.
 *
 * Run:  tsx orchestration/bin/gate.ts            # exit 0 only when every check is green
 *       tsx orchestration/bin/gate.ts --json
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gateChecks, gateExitCode, renderGateReport } from "./lib/gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const JSON_OUT = process.argv.includes("--json");

/** Run a command, returning its REAL exit code + combined output — never throws, never masks. */
function run(bin: string, args: string[]): { exit: number; output: string } {
  try {
    const output = execFileSync(bin, args, { cwd: REPO, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] });
    return { exit: 0, output };
  } catch (e: any) {
    // execFileSync throws on nonzero exit — e.status is the REAL code, e.stdout/e.stderr the output.
    const output = `${e?.stdout ?? ""}${e?.stderr ?? ""}`;
    return { exit: typeof e?.status === "number" ? e.status : 1, output };
  }
}

const bin = (p: string) => join(REPO, "node_modules", ".bin", p);

function main(): void {
  console.error("[gate] tsc --noEmit …");
  const tsc = run(bin("tsc"), ["--noEmit"]);
  console.error("[gate] vitest run …");
  const vitest = run(bin("vitest"), ["run"]);

  const checks = gateChecks(tsc, vitest);
  const code = gateExitCode(checks);
  if (JSON_OUT) console.log(JSON.stringify({ ok: code === 0, checks }));
  else console.log(renderGateReport(checks));
  process.exit(code);
}

main();
