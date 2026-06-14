#!/usr/bin/env node
// build_app — rebuild + recreate the app container, then health-check.
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const r = await bridgeRun(
    `cd ${REPO} && docker compose build 2>&1 | tail -2 && docker compose up -d --force-recreate 2>&1 | tail -2 && ` +
    `sleep 4 && (curl -fs http://127.0.0.1:3000/api/health >/dev/null && echo HEALTHY || echo UNHEALTHY)`,
    { timeoutMs: 220000 }
  );
  const out = r.output || "";
  emit({ ok: out.includes("HEALTHY"), built: r.exitCode === 0, healthy: out.includes("HEALTHY"), output: out.slice(-200) });
});
