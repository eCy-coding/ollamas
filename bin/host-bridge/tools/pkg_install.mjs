#!/usr/bin/env node
// pkg_install — install a package via npm (in container), pip, or brew.
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const manager = process.argv[2];
  const pkg = process.argv.slice(3).join(" ").trim();
  if (!manager || !pkg) throw new Error("usage: pkg_install <npm|pip|brew> <package>");
  const cmds = {
    npm: `cd ${REPO} && docker compose exec -T mission-control npm install ${pkg} < /dev/null 2>&1 | tail -5`,
    pip: `pip3 install ${pkg} 2>&1 | tail -5`,
    brew: `brew install ${pkg} 2>&1 | tail -5`,
  };
  const cmd = cmds[manager];
  if (!cmd) throw new Error(`unknown manager '${manager}' (npm|pip|brew)`);
  const r = await bridgeRun(cmd, { timeoutMs: 120000 });
  emit({ ok: r.exitCode === 0, manager, package: pkg, output: (r.output || "").slice(-300) });
});
