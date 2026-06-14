# macOS / bash Command Expertise (for the agent)

Rules the agent must follow when writing shell for `macos_terminal` / host tools.
Goal: correct, portable, low-error commands on **macOS (BSD userland + zsh/bash)**.

## Strict, safe shell
- Multi-step scripts: start with `set -euo pipefail` (errexit + nounset + pipefail).
- **Quote every expansion**: `"$var"`, `"$(cmd)"` — prevents word-splitting/globbing (shellcheck SC2086).
- Prefer `[[ … ]]` over `[ … ]`. Prefer `printf` over `echo` for data.
- Non-interactive: feed `< /dev/null` to commands that may read stdin (e.g. `docker compose exec -T … < /dev/null`) to avoid SIGTTIN/hangs.

## macOS is BSD, not GNU — the differences that bite
| Need | GNU/Linux (WRONG on macOS) | macOS / portable (RIGHT) |
|------|----------------------------|--------------------------|
| base64 decode | `base64 -d` | `base64 -D` (or `base64 --decode`) — **better: don't pipe, write file directly** |
| in-place sed | `sed -i 's/a/b/' f` | `sed -i '' 's/a/b/' f` (empty backup arg) |
| date math | `date -d '1 day ago'` | `date -v-1d` |
| timeout | `timeout 5 cmd` | NOT installed → use the bridge watchdog, or `gtimeout` (coreutils) |
| PCRE grep | `grep -P` | not supported → use `grep -E` or `perl -ne` |
| xargs no-run-if-empty | `xargs -r` | `-r` absent → guard with `[ -n "$x" ]` first |
| readlink -f | `readlink -f p` | use `python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' p` |
| stat format | `stat -c` | `stat -f` |

## Node.js (this project runs Node 24)
- **Global `fetch` exists** — never `import 'node-fetch'` / `'undici'` (not installed) and never use `Deno.*` (this is Node, not Deno).
- ESM `.mjs`: use `import`, NOT `require()`.
- Read bridge token from `~/.llm-mission-control/bridge.token` (NOT a relative path).

## Heredocs (when writing files via a shell)
- Terminator must be **alone on its line** (`EOF`, not `EOF;`). Better: use the `write_host_file` tool (no heredoc) for multi-line files.

## Tooling
- Run **`shell_check`** on any non-trivial command BEFORE `macos_terminal` — it runs shellcheck + flags the BSD/GNU pitfalls above. Fix what it reports, then execute.
- Project tests/typecheck live in the container (devDeps): run via `docker compose exec -T … < /dev/null` or the builder image — `tsc`/`vitest` are NOT in the runtime image.

Sources: shellharden "how to do things safely in bash", clig.dev, GNU-vs-BSD CLI references.
