#!/usr/bin/env node
// @ts-check
// PreToolUse safety hook (matcher Bash) — deny irreversible/destructive commands.
// Modern signal: permissionDecision="deny" JSON on exit 0 (enforced even under bypass mode).
// Non-Bash tools pass (no stdout). Diagnostics → stderr only.

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  if (p.tool_name !== "Bash") process.exit(0);
  const cmd = String(p.tool_input?.command ?? "");

  const DANGER = [
    { re: /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\/\*|\$HOME)(\s|$)/, why: "recursive delete of / ~ or $HOME" },
    { re: /\brm\s+-[a-z]*f[a-z]*r?\s+(\/|~|\/\*)(\s|$)/,        why: "recursive force delete of root/home" },
    { re: /\bfind\s+(\/|~|\.)\s[^\n]*-delete\b/,                 why: "find -delete (recursive deletion)" },
    { re: /\bfind\s+(\/|~|\.)\s[^\n]*-exec\s+rm\b/,              why: "find -exec rm (recursive deletion)" },
    { re: /\bgit\s+clean\s+-[a-z]*f[a-z]*d|\bgit\s+clean\s+-[a-z]*d[a-z]*f/, why: "git clean -fd (wipes untracked)" },
    { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,                why: "fork bomb" },
    { re: /\bdd\b[^\n]*\bof=\/dev\/(disk|sd|rdisk|nvme)/,        why: "raw disk overwrite via dd" },
    { re: /\bmkfs(\.\w+)?\b/,                                    why: "filesystem format" },
    { re: /\btruncate\s+-s\s*0\b/,                               why: "truncate -s0 (data wipe)" },
    { re: />\s*\/dev\/(sd[a-z]|disk\d|nvme\d)/,                  why: "write to raw disk device" },
    { re: /\bgit\s+push\b[^\n]*(--force(?!-with-lease)|\s-f\b)/, why: "git push --force (use --force-with-lease)" },
    { re: /\bchmod\s+-R\s+777\s+\//,                            why: "world-writable recursive on /" },
  ];

  for (const d of DANGER) {
    if (d.re.test(cmd)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Destructive command blocked: ${d.why}. If truly intended, ask the operator to run it manually.`,
        },
      }));
      process.exit(0);
    }
  }
  process.exit(0);
});
