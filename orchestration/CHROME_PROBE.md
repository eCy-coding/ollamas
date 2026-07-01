# CHROME_PROBE.md — "open Google Chrome" capability matrix (auto-generated)

> Auto: `tsx orchestration/bin/chrome-probe.ts` · 2026-07-01T23:20:01Z. Each model was handed the SAME task —
> open Google Chrome via a terminal command — one-by-one (sequential; single-GPU truth). "Capable"
> = a shell tool ran successfully AND the run reached a DONE/OK verdict (not a demo/no-tool reply).

## Result: 9/17 models opened Chrome

| # | Model | Provider | Called shell | Shell ok | Verdict | **Capable** | Proof |
|---|-------|----------|--------------|----------|---------|-------------|-------|
| 1 | `qwen3-coder-64k:latest` | ollama-local | — | — | INCOMPLETE | ❌ no | I see you're trying to access a file outside of the allowed directory. The error indicates |
| 2 | `qwen3:8b-16k` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 3 | `ollamas-reviewer:latest` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 4 | `qwen2.5vl:32b` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 5 | `qwen2.5vl:7b` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 6 | `qwen3:8b` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 7 | `qwen3:30b-a3b` | ollama-local | — | — | INCOMPLETE | ❌ no | spawnSync node ETIMEDOUT |
| 8 | `deepseek-r1:32b` | ollama-local | — | — | DONE | ❌ no | I'll help open Google Chrome on this Mac using terminal tools. Reasoning: 1. The task requ |
| 9 | `qwen3-coder:30b` | ollama-local | — | — | INCOMPLETE | ❌ no | ReAct loop complete. Reached step depth limit. |
| 10 | `qwen3:4b` | ollama-local | — | — | INCOMPLETE | ❌ no | spawnSync node ETIMEDOUT |
| 11 | `gpt-oss:20b` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | **Output of `pgrep -x "Google Chrome"`:** ``` 52878 ``` The process ID indicates that Goog |
| 12 | `phi4:latest` | ollama-local | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 13 | `kimi-k2.5:cloud` | ollama-cloud | ✅ | ✅ | INCOMPLETE | ❌ no | Authentication failure: invalid or missing key for ollama-cloud. Error: Ollama Cloud retur |
| 14 | `gpt-oss:20b-cloud` | ollama-cloud | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 15 | `gpt-oss:120b-cloud` | ollama-cloud | — | — | INCOMPLETE | ❌ no | spawnSync node ETIMEDOUT |
| 16 | `qwen3-coder:480b-cloud` | ollama-cloud | ✅ | ✅ | DONE | **✅ YES** | VERDICT: DONE Chrome opened |
| 17 | `llama3.3:70b` | ollama-local | — | — | INCOMPLETE | ❌ no | no output |

## Capable models (9)
- `qwen3:8b-16k` (ollama-local)
- `ollamas-reviewer:latest` (ollama-local)
- `qwen2.5vl:32b` (ollama-local)
- `qwen2.5vl:7b` (ollama-local)
- `qwen3:8b` (ollama-local)
- `gpt-oss:20b` (ollama-local)
- `phi4:latest` (ollama-local)
- `gpt-oss:20b-cloud` (ollama-cloud)
- `qwen3-coder:480b-cloud` (ollama-cloud)

## Ethics
> Opening Chrome runs on the operator's OWN Mac and was explicitly requested — the operator's request
> IS the gate for the privileged `macos_terminal` tier. Bounded (per-model timeout, sequential, no
> loop). No mass targeting, no other host. `open -a` is idempotent (focuses if already open).
