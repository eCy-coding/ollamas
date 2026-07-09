#!/usr/bin/env node
// @ts-check
// run_tests — run the project's vitest unit suite inside the container.
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const r = await bridgeRun(
    `cd ${REPO} && docker compose exec -T mission-control npx vitest run tests/MissionControl.test.ts < /dev/null 2>&1 | tail -8`,
    { timeoutMs: 90000 }
  );
  const out = r.output || "";
  emit({ ok: r.exitCode === 0, passed: r.exitCode === 0, exitCode: r.exitCode, summary: out.split("\n").filter((l) => /Tests|passed|failed/.test(l)).join(" | ") || out.slice(-200) });
});
