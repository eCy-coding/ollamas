#!/usr/bin/env node
// @ts-check
// git_ops — read-only git inspection. Subcommand: status|diff|branch|log (default status).
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

const SUBS = {
  status: "git status --short && echo '---' && git log --oneline -3",
  diff: "git --no-pager diff --stat && echo '---' && git --no-pager diff | head -200",
  branch: "git branch -a && echo '---' && git status -sb | head -1",
  log: "git --no-pager log --oneline -15",
};

main(async () => {
  const sub = (process.argv[2] || "status").toLowerCase();
  const gitCmd = SUBS[sub];
  if (!gitCmd) throw new Error(`unknown subcommand '${sub}' (use: ${Object.keys(SUBS).join("|")})`);
  const r = await bridgeRun(`cd ${REPO} && ${gitCmd}`, { timeoutMs: 20000 });
  emit({ ok: r.exitCode === 0, sub, output: (r.output || "").trim() });
});
