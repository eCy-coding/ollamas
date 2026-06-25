#!/usr/bin/env node
// kill_process — kill a PID, or all listeners on a port (':<port>').
// Optional signal: --sig TERM|KILL|INT (default TERM).
import { bridgeRun, emit, main } from "./lib/bridge-client.mjs";
import { parseKillArgs, isValidKillTarget } from "./lib/kill-args.mjs";

main(async () => {
  const { target, sig } = parseKillArgs(process.argv.slice(2));
  if (!target) throw new Error("target required: a PID or ':<port>'");
  // target is interpolated unquoted into a bash command below — constrain it to a PID or
  // :port so it cannot inject shell (the schema only checks min-length).
  if (!isValidKillTarget(target)) throw new Error(`invalid target '${target}': expected a PID or ':<port>'`);

  const command = target.startsWith(":")
    ? `lsof -ti${target} | xargs kill -${sig} 2>&1 && echo killed || echo no-proc`
    : `kill -${sig} ${target} 2>&1 && echo killed || echo no-such-pid`;
  const r = await bridgeRun(command, { timeoutMs: 15000 });
  const out = (r.output || "").trim();
  emit({ ok: out.includes("killed"), target, signal: sig, output: out });
});
