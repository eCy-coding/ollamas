// oracle-lib (pure) — the inline helpers of bin/oracle.ts + bin/oracle-serve.ts, extracted verbatim so
// they are unit-testable without spawning the CLI or the daemon (precedent: fleet-conduct-lib.ts).
// Zero behavior change: render/exit mapping and the NDJSON line-dispatch are byte-identical to the bins.
import { verify, verifyMany, clearMemo, memoSize, type OracleInput, type OracleResult } from "../../oracle/index";

/** Human-readable verdict line (was inline in bin/oracle.ts). */
export function render(r: OracleResult): string {
  const mark = r.verdict === "TRUE" ? "✓ DOĞRU" : r.verdict === "FALSE" ? "✗ YANLIŞ" : "○ KARARSIZ (öznel/kapsam-dışı)";
  return `${mark}  [${r.category} · ${r.basis}]\n  ${r.proof}`;
}

/** exit-code contract: DOĞRU=0, YANLIŞ=1, KARARSIZ=3 (conduct-gate uyumlu; was inline in bin/oracle.ts). */
export function verdictExitCode(v: OracleResult["verdict"]): number {
  return v === "TRUE" ? 0 : v === "FALSE" ? 1 : 3;
}

/**
 * One NDJSON request line → one JSON-serializable response (was inline in bin/oracle-serve.ts).
 *   <OracleInput>                  → single verdict
 *   {"batch":[<OracleInput>,...]}  → {"results":[...]} (parallel)
 *   {"cmd":"ping"}                 → {"ok":true,"memo":N}
 *   {"cmd":"clear"}                → {"ok":true}
 * Malformed JSON / thrown errors → UNDECIDABLE daemon-error (the daemon never crashes on bad input).
 */
export async function handleOracleLine(line: string): Promise<unknown> {
  try {
    const msg = JSON.parse(line) as { batch?: OracleInput[]; cmd?: string };
    if (msg && Array.isArray(msg.batch)) return { results: await verifyMany(msg.batch) };
    if (msg && msg.cmd === "ping") return { ok: true, memo: memoSize() };
    if (msg && msg.cmd === "clear") { clearMemo(); return { ok: true }; }
    return verify(msg as OracleInput);
  } catch (e) {
    return { verdict: "UNDECIDABLE", basis: "daemon-error", proof: String((e as Error).message) };
  }
}
