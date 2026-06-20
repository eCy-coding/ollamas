# Observability — `ollamas top` (v8)

A zero-dep terminal dashboard over the gateway's telemetry: request rate, latency
(avg / ~p50 / ~p90), MCP tool calls, usage, and a logbook tail.

## Usage

```sh
ollamas top                      # one snapshot, then exit
ollamas top --json               # machine-readable snapshot
ollamas top --watch              # live repaint (default every 2s)
ollamas top --watch --interval 5 # repaint every 5s
ollamas --profile box top --watch
```

## What it reads

| Panel | Source | Auth |
|-------|--------|------|
| requests / latency | `GET /metrics` (Prometheus) | **none** — open endpoint |
| usage (calls/tokens) | `GET /api/saas/usage/timeseries` | tenant key (`OLLAMAS_API_KEY`) |
| mcp tool calls | `mcp_tool_calls_total` from `/metrics` | none |
| logbook tail | `~/.llm-mission-control/seyir-defteri.jsonl` | local file |

The metrics panel always renders (no key needed). Without a key, the usage panel
shows a hint instead — everything else still works.

## Notes & caveats

- **~p50 / ~p90 are approximate.** They're read from Prometheus histogram buckets
  (le boundaries 25/50/100/200/500/1000/2000/5000 ms), so the value is the bucket
  upper bound that crosses the percentile — not an exact quantile.
- **req/s needs two samples.** In `--watch` the first frame shows `—`; the rate
  appears from the second tick on (Δ request-count ÷ Δt). A gateway restart
  (counter reset) shows 0 for that tick, not a negative spike.
- **`--watch` needs a TTY.** Piped/non-TTY (`ollamas top --watch | cat`) refuses
  the loop and emits a single snapshot instead.
- **Terminal restore.** `--watch` uses the alternate screen + hides the cursor;
  `Ctrl-C` (SIGINT/SIGTERM) always restores the cursor and leaves the alternate
  screen. Over SSH/tmux the alternate screen may be stripped — it still repaints
  in place; only the polish degrades.
- **Logbook is local-host-only.** The tail reads the gateway's
  `seyir-defteri.jsonl` on *this* machine. Pointed at a remote gateway, the panel
  is skipped (the file isn't there). No HTTP endpoint exposes it yet.
- **`NO_COLOR` / non-TTY** drop ANSI; the dashboard renders as plain text.

## Live cockpit — multi-pane (v16)

On a **wide terminal (≥100 cols)** `top` renders side-by-side panes — **requests |
latency | tool calls | sessions** — instead of the vertical list. Width is
auto-detected from `process.stdout.columns`, so there is nothing to configure; a
narrow terminal or a piped/non-TTY run falls back to the vertical layout
(unchanged). `--watch` repaints the cockpit every 2 s (k9s/docker-stats model);
SIGINT still restores the terminal.

```sh
ollamas top                # snapshot — panes if the terminal is wide enough
ollamas top --watch        # live cockpit, repaint every 2s
ollamas top --no-sessions  # skip the sessions network call
```

- The **sessions pane** lists recent agent sessions (`GET /api/agent/sessions`);
  it is best-effort — a missing tenant key or a fetch error just omits the pane.
- Live activity shows up in real time: as requests hit the gateway, the requests
  pane count + req/s sparkline climb (dogfooded: 8 → 16 while driving commands).
- A live **tail of a running agent session** (`agent --watch <id>`) needs a server
  event-stream endpoint that does not exist yet — planned for v17.
