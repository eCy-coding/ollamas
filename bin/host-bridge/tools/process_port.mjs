#!/usr/bin/env node
// process_port — list the process(es) listening on a TCP port.
import { bridgeRun, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const port = Number(process.argv[2]) || 3000;
  const r = await bridgeRun(`lsof -nP -iTCP:${port} -sTCP:LISTEN || echo 'no listener on ${port}'`, { timeoutMs: 15000 });
  const out = (r.output || "").trim();
  emit({ ok: r.exitCode === 0, port, listening: !out.includes("no listener"), output: out });
});
