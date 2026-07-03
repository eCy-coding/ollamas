---
description: The ONE truthful quality gate — runs `tsc --noEmit` + `vitest run`, captures each command's REAL exit status + output (no masked pipe), and exits 0 only when every check is green. Use this instead of ad-hoc `tsc 2>&1 | head; echo $?`, where `$?` is the pipe's last stage and silently hides a red tsc (RISK-ORCH-041).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/gate.ts:*), Bash(npx tsx orchestration/bin/gate.ts:*)
argument-hint: "[--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/gate.ts $ARGUMENTS`.

Measures the tree's real health: `tsc --noEmit` error count + `vitest run` pass/fail, read from each command's true exit code (execFileSync → `e.status`), never from a piped tail/head. Exit 0 ⇔ every check green.

- (no args) — run the gate, print the verdict table, exit with the real code.
- `--json` — machine output `{ok, checks:[{name, ok, detail}]}`.

**Never measure the gate with `<cmd> | head` / `| tail`** — the pipe makes `$?` the pager's exit (0), masking a failing command. That bug (RISK-ORCH-041) measured "0 errors" on a 28-error tree. Extensible: add a check to `gateChecks` (`bin/lib/gate.ts`) and it is counted + gated identically. See `.claude/BRAIN.md`.
