#!/usr/bin/env node
// @ts-check
// PreToolUse fast commit-policy guard (matcher Bash). Enforces CLAUDE.md commit rules cheaply
// (the heavy typecheck+test gate lives in .git/hooks/pre-commit). Modern signal:
// permissionDecision="deny" JSON on exit 0. Diagnostics → stderr; stdout = decision JSON only.
//   1. no `git add -A` / `git add .` / `git commit -a`   (per-file staging law)
//   2. no `--no-verify`
//   3. a plain commit must have something staged   (EXCEPT --amend, which is legitimate with nothing new)

import { execSync } from "node:child_process";

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  if (p.tool_name !== "Bash") process.exit(0);
  const cmd = String(p.tool_input?.command ?? "");
  const isAdd = /\bgit\s+add\b/.test(cmd);
  const isCommit = /\bgit\s+commit\b/.test(cmd);
  if (!isAdd && !isCommit) process.exit(0);

  const deny = (reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Commit policy: ${reason}` },
    }));
    process.exit(0);
  };

  if (/\bgit\s+add\b[^\n]*\s(-A|--all)\b/.test(cmd) || /\bgit\s+add\s+\.(\s|$)/.test(cmd))
    deny("`git add -A/.` forbidden — stage files individually (CLAUDE.md per-file add).");
  if (/\bgit\s+commit\b[^\n]*\s-[a-z]*a/.test(cmd) && !/--amend/.test(cmd))
    deny("`git commit -a` forbidden — stage explicitly, then commit.");
  if (/--no-verify\b/.test(cmd))
    deny("`--no-verify` forbidden — do not skip git hooks.");

  // --amend is legitimate with nothing newly staged → skip the staged-empty check.
  if (isCommit && !/--amend/.test(cmd)) {
    // Worktree-aware: if the command `cd`s into a dir first, check THAT repo/worktree's index
    // (the hook runs in CLAUDE_PROJECT_DIR = main repo; without this, worktree commits wrongly
    // report "nothing staged" because the main index is empty).
    const cds = [...cmd.matchAll(/(?:^|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/g)];
    const last = cds[cds.length - 1]; // effective cwd = the LAST cd in the chain
    const cwd = last ? last[1].replace(/^['"]|['"]$/g, "") : undefined;
    try {
      execSync("git diff --cached --quiet", { stdio: "ignore", ...(cwd ? { cwd } : {}) }); // exit 0 = nothing staged
      deny("nothing staged — `git add <file>` the intended changes before committing.");
    } catch { /* non-zero = staged changes exist (or cwd unresolvable → let git surface it) → OK */ }
  }
  process.exit(0);
});
