# AUTOMATOR_PROBE.md — "produce Automator artifacts that support the project" tracking (auto-generated)

> Auto: `tsx orchestration/bin/automator-probe.ts` · 2026-07-02T03:21:48Z. Each model was handed the SAME task
> one-by-one (sequential; single-GPU truth): author macOS Automator-compatible artifacts (Quick Action /
> Run Shell Script / AppleScript / shell) that support ollamas, into `~/Desktop/ollamas-automator/<model>/`.
> "Produced" = the model wrote ≥1 real file into its own directory (tracked by a filesystem scan).

## Result: 12/17 models produced artifacts

| # | Model | Provider | Produced | Files | Kinds | Verdict | Note |
|---|-------|----------|----------|-------|-------|---------|------|
| 1 | `qwen3-coder-64k:latest` | ollama-local | — | 0 | — | INCOMPLETE | I see you're encountering an access denied error. It looks like you're |
| 2 | `qwen3:8b-16k` | ollama-local | ✅ | 4 | applescript, readme, shell | OK | I have created the following files for the Qwen3 8B-16K model automati |
| 3 | `ollamas-reviewer:latest` | ollama-local | ✅ | 4 | applescript, readme, shell | OK | The ollamas Automator artifacts have been successfully created and sav |
| 4 | `qwen2.5vl:32b` | ollama-local | ✅ | 6 | applescript, other, readme, shell | OK | I have created the following files for the Qwen2.5vl_32b model: 1. `st |
| 5 | `qwen2.5vl:7b` | ollama-local | ✅ | 4 | applescript, readme, shell | OK | The `ollamas Automator artifacts` have been successfully created and w |
| 6 | `qwen3:8b` | ollama-local | ✅ | 4 | applescript, readme, shell | OK | The ollamas automator artifacts have been successfully created, and th |
| 7 | `qwen3:30b-a3b` | ollama-local | ✅ | 4 | applescript, readme, shell | INCOMPLETE | Okay, the user tried to read the README.md file, but got an error sayi |
| 8 | `deepseek-r1:32b` | ollama-local | — | 0 | — | DONE | Let me create useful macOS-compatible automation artifacts for ollamas |
| 9 | `qwen3-coder:30b` | ollama-local | — | 0 | — | INCOMPLETE | I see you're encountering an access denied error when trying to access |
| 10 | `qwen3:4b` | ollama-local | ✅ | 4 | applescript, readme, shell | OK | Okay, let me try to figure out what the user needs here. They provided |
| 11 | `gpt-oss:20b` | ollama-local | ✅ | 4 | applescript, readme, shell | DONE | start-ollamas.command – shell script that `cd`s into the ollamas repo  |
| 12 | `phi4:latest` | ollama-local | ✅ | 5 | applescript, other, readme, shell | DONE | VERDICT: DONE start-ollamas.sh,open-ollamas.cockpit.applescript,post-p |
| 13 | `kimi-k2.5:cloud` | ollama-cloud | — | 0 | — | INCOMPLETE | Authentication failure: invalid or missing key for ollama-cloud. Error |
| 14 | `gpt-oss:20b-cloud` | ollama-cloud | ✅ | 5 | applescript, readme, shell | DONE | /Users/emrecnyngmail.com/Desktop/ollamas-automator/gpt-oss_20b-cloud/s |
| 15 | `gpt-oss:120b-cloud` | ollama-cloud | ✅ | 4 | applescript, readme, shell | DONE | start-ollamas.command – Bash script that launches the Ollamas server ( |
| 16 | `qwen3-coder:480b-cloud` | ollama-cloud | ✅ | 4 | applescript, readme, shell | OK | ReAct loop complete. Reached step depth limit. |
| 17 | `llama3.3:70b` | ollama-local | — | 0 | — | INCOMPLETE | no output |

## What each model produced
- **`qwen3-coder-64k:latest`**: (nothing) — INCOMPLETE
- **`qwen3:8b-16k`** (4): `README.md` [readme], `open-ollamas-cockpit.applescript` [applescript], `post-prompt-to-ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`ollamas-reviewer:latest`** (4): `README.md` [readme], `open_ollamas_cockpit.applescript` [applescript], `post_prompt_to_ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`qwen2.5vl:32b`** (6): `README.md` [readme], `automator-import-instructions.txt` [other], `ollamas-artifacts-list.txt` [other], `open-ollamas-cockpit.applescript` [applescript], `post-to-ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`qwen2.5vl:7b`** (4): `README.md` [readme], `open-ollamas-cockpit.applescript` [applescript], `post-prompt-to-ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`qwen3:8b`** (4): `README.md` [readme], `open-ollamas.cockpit.applescript` [applescript], `post-prompt.sh` [shell], `start-ollamas.sh` [shell]
- **`qwen3:30b-a3b`** (4): `README.md` [readme], `curl-prompt.sh` [shell], `open-cockpit.applescript` [applescript], `start-ollamas.sh` [shell]
- **`deepseek-r1:32b`**: (nothing) — DONE
- **`qwen3-coder:30b`**: (nothing) — INCOMPLETE
- **`qwen3:4b`** (4): `README.md` [readme], `open-ollamas.applescript` [applescript], `post-ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`gpt-oss:20b`** (4): `README.md` [readme], `open-cockpit.applescript` [applescript], `post-prompt.sh` [shell], `start-ollamas.command` [shell]
- **`phi4:latest`** (5): `README.md` [readme], `ollamas-artifacts-list.txt` [other], `open-ollamas.cockpit.applescript` [applescript], `post-prompt-to-ollamas.sh` [shell], `start-ollamas.sh` [shell]
- **`kimi-k2.5:cloud`**: (nothing) — INCOMPLETE
- **`gpt-oss:20b-cloud`** (5): `OpenOllamas.applescript` [applescript], `README.md` [readme], `post_prompt.sh` [shell], `start-ollamas.command` [shell], `start-ollamas.sh` [shell]
- **`gpt-oss:120b-cloud`** (4): `README.md` [readme], `open-cockpit.applescript` [applescript], `post-prompt.command` [shell], `start-ollamas.command` [shell]
- **`qwen3-coder:480b-cloud`** (4): `README.md` [readme], `open-cockpit.applescript` [applescript], `send-prompt.sh` [shell], `start-ollamas.sh` [shell]
- **`llama3.3:70b`**: (nothing) — INCOMPLETE

## Ethics
> Producing files is on the operator's OWN Mac and explicitly requested (the request IS the gate for the
> privileged write tier). Writes are scoped to `~/Desktop/ollamas-automator/<model>/` (per-model, no
> arbitrary Desktop clutter). Artifacts are PRODUCED and tracked, never executed. Bounded (per-model
> timeout, sequential). No mass targeting, no other host.
