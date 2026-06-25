// Pure interpretation of a git_commit bridge result — extracted so it is unit-testable
// without importing the tool (which runs main()/bridgeRun at import time).
//
// The old command ended each step with `| tail -N`, which made the shell pipeline exit
// 0 even when git failed (false success) AND let `&& git push` run after a failed
// commit. Now the command keeps git's real exit code and the output is trimmed here.

/** @param {{exitCode?: number, output?: string}} r  @param {boolean} push */
export function interpretGitCommit(r, push = false) {
  const ok = r?.exitCode === 0;
  const output = String(r?.output || "").trim();
  return {
    ok,
    committed: ok,
    pushed: push && ok,
    output: output.split("\n").filter(Boolean).slice(-6).join("\n"),
  };
}
