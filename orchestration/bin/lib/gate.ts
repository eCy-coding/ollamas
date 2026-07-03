// gate.ts (pure) — the TRUTHFUL quality gate: parse tsc + vitest results by their REAL exit code and output,
// never by a masked pipe. IO-free → unit-tested; the CLI (bin/gate.ts) captures the real exit + stdout.
//
// Why: vO55 exposed a measurement bug — `tsc 2>&1 | head; echo $?` reports HEAD's exit (0), masking a tsc
// failure, so "0 errors" was measured on a red tree (RISK-ORCH-041). The permanent, extensible fix is one
// canonical gate that reads the real exit status (execFileSync throws → e.status) and COUNTS errors from the
// output — the pipe that lost the exit code is designed out. Reuses quality.parseTscResult (no duplication).

import { parseTscResult } from "./quality";

export interface CheckResult { name: string; ok: boolean; detail: string }

export { parseTscResult };

/** vitest run stdout → {ok, passed, failed}. exit 0 → ok. Parses the "Tests N passed | M failed" summary;
 *  falls back to failed=1 when the run failed but no count is parseable. */
export function parseVitestOutput(exitCode: number, output: string): { ok: boolean; passed: number; failed: number } {
  const out = output || "";
  const passed = Number((out.match(/Tests\s+(\d+)\s+passed/i) || [])[1] ?? (out.match(/(\d+)\s+passed/i) || [])[1] ?? 0);
  const failed = Number((out.match(/(\d+)\s+failed/i) || [])[1] ?? 0);
  if (exitCode === 0) return { ok: true, passed, failed: 0 };
  return { ok: false, passed, failed: Math.max(1, failed) };
}

/** Build the check rows from raw (exit, output) pairs — the single place results are interpreted. */
export function gateChecks(tsc: { exit: number; output: string }, vitest: { exit: number; output: string }): CheckResult[] {
  const t = parseTscResult(tsc.exit, tsc.output);
  const v = parseVitestOutput(vitest.exit, vitest.output);
  return [
    { name: "tsc --noEmit", ok: t.ok, detail: t.ok ? "0 errors" : `${t.errorCount} error(s)` },
    { name: "vitest run", ok: v.ok, detail: v.ok ? `${v.passed} passed` : `${v.failed} failed (${v.passed} passed)` },
  ];
}

/** Real gate exit code: 0 only when EVERY check passed. Deterministic, never masked. */
export function gateExitCode(checks: CheckResult[]): number {
  return checks.every((c) => c.ok) ? 0 : 1;
}

/** Render the truthful gate summary (all checks + verdict). */
export function renderGateReport(checks: CheckResult[]): string {
  const pass = checks.every((c) => c.ok);
  const L = [`GATE — ${pass ? "✅ GREEN" : "✗ RED"} (${checks.filter((c) => c.ok).length}/${checks.length} checks)`];
  for (const c of checks) L.push(`  ${c.ok ? "✅" : "✗"} ${c.name.padEnd(16)} ${c.detail}`);
  return L.join("\n");
}
