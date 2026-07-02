# CHROME_SHORTCUTS.md — "find the dev/AI keyboard shortcuts to drive Chrome" probe (auto-generated)

> Auto: `tsx orchestration/bin/chrome-probe.ts --task shortcuts` · 2026-07-02T02:55:37Z. Each model was handed the
> SAME task one-by-one (sequential; single-GPU truth): open Google Chrome AND list the keyboard
> shortcuts a developer/AI uses to control it. "Opened" = a shell tool ran + DONE/OK (not a demo).
> "Shortcuts" = how many of the 14 canonical Chrome shortcuts it correctly named.

## Result: 11/17 opened Chrome · 4/17 named ≥1 real shortcut

| # | Model | Provider | Opened | Verdict | Shortcuts (hit/total) | Named (canonical) |
|---|-------|----------|--------|---------|-----------------------|-------------------|
| 1 | `qwen3-coder-64k:latest` | ollama-local | ❌ | INCOMPLETE | 0/14 | — |
| 2 | `qwen3:8b-16k` | ollama-local | ✅ | OK | 0/14 | — |
| 3 | `ollamas-reviewer:latest` | ollama-local | ✅ | OK | 0/14 | — |
| 4 | `qwen2.5vl:32b` | ollama-local | ✅ | OK | 0/14 | — |
| 5 | `qwen2.5vl:7b` | ollama-local | ✅ | OK | 0/14 | — |
| 6 | `qwen3:8b` | ollama-local | ✅ | OK | 0/14 | — |
| 7 | `qwen3:30b-a3b` | ollama-local | ✅ | OK | 11/14 | Cmd+L, Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+R, Cmd+Shift+R, Cmd+Opt+I, Cmd+Opt+J, Cmd+ |
| 8 | `deepseek-r1:32b` | ollama-local | ❌ | INCOMPLETE | 0/14 | — |
| 9 | `qwen3-coder:30b` | ollama-local | ❌ | INCOMPLETE | 0/14 | — |
| 10 | `qwen3:4b` | ollama-local | ✅ | OK | 9/14 | Cmd+L, Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+R, Cmd+Shift+R, Cmd+Opt+I, Cmd+F, Cmd+Shif |
| 11 | `gpt-oss:20b` | ollama-local | ✅ | DONE | 12/14 | Cmd+L, Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+R, Cmd+Shift+R, Cmd+Opt+I, Cmd+Opt+J, Cmd+ |
| 12 | `phi4:latest` | ollama-local | ✅ | OK | 0/14 | — |
| 13 | `kimi-k2.5:cloud` | ollama-cloud | ❌ | INCOMPLETE | 0/14 | — |
| 14 | `gpt-oss:20b-cloud` | ollama-cloud | ❌ | BLOCKED | 0/14 | — |
| 15 | `gpt-oss:120b-cloud` | ollama-cloud | ✅ | OK | 0/14 | — |
| 16 | `qwen3-coder:480b-cloud` | ollama-cloud | ✅ | DONE | 13/14 | Cmd+L, Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+R, Cmd+Shift+R, Cmd+Opt+I, Cmd+Opt+J, Cmd+ |
| 17 | `llama3.3:70b` | ollama-local | ❌ | INCOMPLETE | 0/14 | — |

## Ground-truth shortcuts (14)
- `Cmd+L` — focus the address bar (omnibox)
- `Cmd+T` — open a new tab
- `Cmd+W` — close the current tab
- `Cmd+Shift+T` — reopen the last closed tab
- `Cmd+R` — reload the page
- `Cmd+Shift+R` — hard reload (bypass cache)
- `Cmd+Opt+I` — open DevTools
- `Cmd+Opt+J` — open the JavaScript console
- `Cmd+Opt+C` — inspect element (element picker)
- `Cmd+Opt+U` — view page source
- `Cmd+F` — find in page
- `Cmd+Shift+N` — open an incognito window
- `Cmd+[` — go back
- `Cmd+]` — go forward

## Ethics
> Same bound as /chrome-probe: opening Chrome is on the operator's OWN Mac and explicitly requested
> (the request IS the gate for the privileged `macos_terminal` tier). The task only LISTS shortcuts
> (knowledge) + opens Chrome — it injects no keystrokes. Bounded (per-model timeout, sequential).
