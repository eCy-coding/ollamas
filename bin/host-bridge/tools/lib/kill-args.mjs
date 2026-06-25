// Pure argv parser for kill_process — extracted so the parse logic is unit-testable
// without importing the tool itself (which runs main()/bridgeRun at import time).
const SIGNALS = { TERM: "TERM", KILL: "KILL", INT: "INT", HUP: "HUP" };

/**
 * Parse kill_process argv (the part after `node kill_process.mjs`). Returns
 * { target, sig }. `--sig <SIG>` may appear anywhere; crucially, its ABSENCE must
 * not consume the target (the old index-based filter dropped args[0] when --sig
 * was missing because sigIdx=-1 → sigIdx+1=0).
 */
export function parseKillArgs(argv) {
  const args = [...argv];
  let sig = "TERM";
  const sigIdx = args.indexOf("--sig");
  if (sigIdx >= 0) {
    sig = SIGNALS[(args[sigIdx + 1] || "").toUpperCase()] || "TERM";
    args.splice(sigIdx, 2); // drop the flag AND its value, wherever they sit
  }
  return { target: args[0], sig };
}
