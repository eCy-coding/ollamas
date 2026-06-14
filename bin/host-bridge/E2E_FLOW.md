# E2E Flow: Real-Time Task → Real macOS Terminal

How a real-time task flows through LLM Mission Control when the ReAct agent
drives the host terminal bridge. Traced from `server.ts:411-678` +
`bin/host-bridge/terminal-bridge.mjs`.

## Components
```
Browser/caller ──HTTP──▶ Express (container :3000) ──HTTP──▶ host bridge (:7345) ──osascript──▶ iTerm2 / Terminal.app
                              │                                      │
                         ProviderRouter ──▶ ollama (host :11434)     └─ shared /tmp/llm-bridge/<id>.{sh,out,rc}
```

## Step-by-step (one real-time task)
1. **Request** — `POST /api/agent/chat` `{provider, model, messages, autoApply, maxSteps=8, sessionId?}` (server.ts:412). Response is an SSE stream.
2. **ReAct iteration** — `ProviderRouter.generate({provider, model, messages, tools: AGENT_TOOLS, stream:false})` (server.ts:531). Model returns text + optional `toolCalls`.
3. **`thought` event** — emitted with the model's reasoning + any `toolCalls` (server.ts:528/541/546).
4. **Tool dispatch** — for each tool call (server.ts:548-609):
   - `list_tree` → `FilesystemManager.getTree()`
   - `read_file` / `write_file` (write pauses with a diff unless `autoApply`)
   - `run_command` / `grep_search` → `TerminalManager.execute()` (in-container, allowlisted)
   - **`macos_terminal`** → `runOnHostTerminal(target, command)` (server.ts:21-33) → `POST host.docker.internal:7345/run` with `X-Bridge-Token`.
5. **Bridge `/run`** (terminal-bridge.mjs):
   - Serialized via mutex; command written to `/tmp/llm-bridge/<id>.sh`.
   - Dedicated per-app window (tracked by id, created with readiness delay).
   - osascript types a watchdog-wrapped line: `cat sh; bash sh > out 2>&1 (killed after timeout); echo $? > rc; cat out`.
   - Polls `<id>.rc` for completion → returns `{ok, exitCode, output, durationMs}` (timeout → `{timedOut, ...}` + drops stuck window for self-heal).
6. **`step` event** — `{stepNum, tool, args, ok, latency, result, diff, applied}` (server.ts:617). This is what an observer/tracer reads.
7. **Feedback** — tool output pushed to `activeHistory` as `{role:"tool", name, tool_call_id, content}` (server.ts:628) → next iteration.
8. **Halt** — `write_file` without `autoApply` → `paused`; or `stepNum > maxSteps` → `done{status:"limit"}`; else `done{status:"complete"}` (server.ts:636-649).

## SSE event schemas (observer contract)
| event | payload |
|-------|---------|
| `thought` | `{text, toolCalls?}` |
| `message` | `{text, step}` |
| `step` | `{stepNum, tool, args, ok, latency, result, diff, applied}` |
| `paused` | `{message}` |
| `done` | `{text, status: "complete"｜"limit"}` |
| `error` | `{message}` |

## Adding a new agent tool
1. Append to `AGENT_TOOLS` (server.ts:426) — `{type:"function", function:{name, description, parameters}}`. Clear schema = fewer failures.
2. Add an `else if (toolName === "...")` handler in the dispatch switch (server.ts:560).
3. Rebuild container. (Or keep as a host CLI under `bin/host-bridge/tools/` invoked via `macos_terminal` — no rebuild.)

## Agent-CLI rules these bridge tools follow (researched)
Non-interactive (no TTY prompts), reliable exit codes, clean stdout/stderr,
machine-readable (JSON) output, bounded runtime (bridge watchdog).
