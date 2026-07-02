---
description: Run a bash / Apple-terminal command in a REAL, visible Terminal.app or iTerm2 window on the host and capture its output + exit code, via the ollamas host bridge (/run). The operator's first-class "run this in a terminal" entry — the privileged macos_terminal capability made directly usable on any request. `--check` verifies the capability end-to-end (terminals available + a live probe runs with exit 0 + Automation permission). Token-authed, loopback-only, watchdog-timed; operator's own Mac.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/term-exec.ts:*), Bash(npx tsx orchestration/bin/term-exec.ts:*)
argument-hint: "\"<command>\" [--target iterm2|terminal] | --check"
---
Run `./node_modules/.bin/tsx orchestration/bin/term-exec.ts $ARGUMENTS`.

It resolves the reachable host bridge (`GET /health` on :7345), reads the bridge token (`~/.llm-mission-control/bridge.token`), and POSTs `/run` — which drives Terminal.app / iTerm2 via osascript, runs your command in a real window, and reads back its **output + exit code** (script-file + watchdog, robust for multi-line/heredoc). The CLI mirrors the command's exit code.

- `term-exec "<command>"` — run in iTerm2 (default) and capture. `--target terminal` for Terminal.app. `--json` for structured, `--timeout <ms>`.
- `term-exec --check` — verify the capability end-to-end: reports terminals available + runs a live probe (`echo ollamas-term-ok; whoami; sw_vers`) and prints whether the authority is **GRANTED**. If Automation permission is missing (osascript -1743), it says exactly how to grant it (System Settings → Privacy & Security → Automation).

Prereq: the bridge must be running (`bash bin/host-bridge/start-bridge.sh`). See `.claude/BRAIN.md`.
