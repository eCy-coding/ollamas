#!/usr/bin/env node
// @ts-check
// kill_process — kill a PID, or all listeners on a port (':<port>').
// Optional signal: --sig TERM|KILL|INT (default TERM).
import { bridgeRun, emit, main } from "./lib/bridge-client.mjs";

const SIGNALS = { TERM: "TERM", KILL: "KILL", INT: "INT", HUP: "HUP" };

main(async () => {
  const args = process.argv.slice(2);
  const sigIdx = args.indexOf("--sig");
  const sig = sigIdx >= 0 ? (SIGNALS[(args[sigIdx + 1] || "").toUpperCase()] || "TERM") : "TERM";
  // With no --sig, sigIdx is -1 so `i !== sigIdx + 1` (i !== 0) would drop index 0
  // — the target itself. Only skip the signal-value slot when --sig is present.
  const target = args.filter((a, i) => a !== "--sig" && (sigIdx < 0 || i !== sigIdx + 1))[0];
  if (!target) throw new Error("target required: a PID or ':<port>'");

  const command = target.startsWith(":")
    ? `lsof -ti${target} | xargs kill -${sig} 2>&1 && echo killed || echo no-proc`
    : `kill -${sig} ${target} 2>&1 && echo killed || echo no-such-pid`;
  const r = await bridgeRun(command, { timeoutMs: 15000 });
  const out = (r.output || "").trim();
  emit({ ok: out.includes("killed"), target, signal: sig, output: out });
});
