#!/usr/bin/env node
// git_commit — stage all + commit. Optional push with --push (guarded).
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const args = process.argv.slice(2);
  const push = args.includes("--push");
  const message = args.filter((a) => a !== "--push").join(" ").trim();
  if (!message) throw new Error("commit message required");
  const q = JSON.stringify(message);
  let cmd = `cd ${REPO} && git add -A && git commit -m ${q} 2>&1 | tail -4`;
  if (push) cmd += ` && git push 2>&1 | tail -3`;
  const r = await bridgeRun(cmd, { timeoutMs: 30000 });
  emit({ ok: r.exitCode === 0, committed: r.exitCode === 0, pushed: push, output: (r.output || "").trim() });
});
