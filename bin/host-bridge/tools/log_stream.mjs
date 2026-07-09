#!/usr/bin/env node
// @ts-check
// log_stream — last N lines of the app container logs.
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const lines = Number(process.argv[2]) || 40;
  const r = await bridgeRun(`cd ${REPO} && docker compose logs --tail=${lines} --no-color 2>&1 | tail -${lines}`, { timeoutMs: 20000 });
  emit({ ok: r.exitCode === 0, lines, output: (r.output || "").trim() });
});
