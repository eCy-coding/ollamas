#!/usr/bin/env node
// git_commit — stage all + commit. Optional push with --push (guarded).
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";
import { interpretGitCommit } from "./lib/git-commit-parse.mjs";

main(async () => {
  const args = process.argv.slice(2);
  const push = args.includes("--push");
  const message = args.filter((a) => a !== "--push").join(" ").trim();
  if (!message) throw new Error("commit message required");
  const q = JSON.stringify(message);
  // No `| tail` — piping through tail made the pipeline exit 0 even when git failed
  // (reported false success) AND let `&& git push` run after a failed commit. Keep
  // git's real exit code; the output is trimmed in interpretGitCommit instead.
  let cmd = `cd ${REPO} && git add -A && git commit -m ${q} 2>&1`;
  if (push) cmd += ` && git push 2>&1`;
  const r = await bridgeRun(cmd, { timeoutMs: 30000 });
  emit(interpretGitCommit(r, push));
});
