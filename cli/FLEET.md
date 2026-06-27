# Fleet — 3 machines as one, minimum-manual (1 Mac + 2 Windows GPUs)

Run the ollamas project across a fleet: the **Mac** is the always-on control
plane (gateway, CLI, agents, UI); two **Windows PCs** are GPU inference workers.
The gateway proxies inference to the **best reachable** worker and **fails over**
to the next when one drops. Builds on `REMOTE_GPU.md` (single remote backend) —
read that first for the Tailscale/Ollama basics.

```
                 Tailscale mesh — auto-discovered (no hand-typed IPs)
┌─ Mac (control, always on) ─────────────────────────────────────────────┐
│ ollamas gateway :3000  ── OLLAMA_HOST = <current best backend> ───┐     │
│ supervisor: probe pool by priority → pick best → on loss re-pick + relaunch │
│ Mac-local ollama  (priority 99 = last-resort fallback)            │     │
└──────────────────────────────────────────────────────────────────┘     │
        │ priority 10                          │ priority 20
┌─ Windows #1 (GPU) ─────┐           ┌─ Windows #2 (GPU) ─────┐
│ ollama 0.0.0.0:11434   │           │ ollama 0.0.0.0:11434   │
└────────────────────────┘           └────────────────────────┘
```

## Minimum-manual setup — one command per machine

### On each Windows GPU worker (once)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\fleet-join.ps1
```
Idempotent. Verifies Tailscale (installs via winget if missing) + Ollama, sets
`OLLAMA_HOST=0.0.0.0:11434` (so the tailnet can reach it), opens the firewall on
11434, pulls `qwen3:8b`, restarts the daemon. Re-running is a safe no-op. The only
truly manual bits are account logins: `tailscale up` (same account as the Mac)
and installing Ollama if absent — the script tells you when.

### On the Mac control plane (once, then it stays running)
```sh
./scripts/fleet-up.sh
```
Idempotent. Runs the readiness gate (`npm run ready`), checks Tailscale is up,
**auto-discovers** every ollama backend on the tailnet (`ollamas remote discover`
— no IPs typed), then launches the failover supervisor (`ollamas remote up
--watch`). Ctrl-C stops the supervisor.

That's it: two commands on Windows (one each) + one on the Mac.

## What the supervisor does (`ollamas remote up --watch`)

- Loads the backend pool (`~/.ollamas/backends.json`), probes every backend.
- Picks the **lowest-priority** backend that is reachable **and** serves the
  required model (default `qwen3:8b`) — workers (10, 20) before Mac-local (99).
- Launches the gateway as a child with `OLLAMA_HOST=<best>` (default child command
  `npm start`; override with `--exec`).
- Every `--interval` ms (default 5000) re-probes. If the active backend dies, it
  kills the child (SIGTERM → SIGKILL grace) and **respawns** against the next-best
  backend. A `--min-dwell` (default 10000 ms) thrash-guard prevents flapping; when
  all backends are down it retries with exponential backoff.

### ⚠️ Honest limit — failover is relaunch, not zero-downtime
The gateway reads `OLLAMA_HOST` once at boot (`server.ts:168`) and caches its mode
(`server.ts:188`). Switching backends therefore means **relaunching the gateway**
(a few seconds of downtime), not a live in-flight reroute. True zero-downtime
failover would need a backend pool *inside* the gateway (server lane) — out of
scope here by design (minimal, CLI-only). For a single always-on home fleet this
is the right trade.

## Manual pool control (when there's no tailnet, or to tune)
```sh
ollamas remote ls                          # show pool + live probe of each backend
ollamas remote add win1 http://win1.<tailnet>.ts.net:11434 --priority 10
ollamas remote rm  win1
ollamas remote check --all                 # probe every backend, table output
ollamas remote pick                         # print the best backend URL (for scripts)
```
The pool lives in `~/.ollamas/backends.json` (plain JSON — URLs, not secrets).
`discover` rebuilds it from the tailnet; `add`/`rm` edit it by hand.

## End-to-end verification

| Check | Command | Expect |
|---|---|---|
| Auto-discovery | (Mac) `ollamas remote discover` | both Windows + Mac-local listed, **no IPs typed** |
| Pool health | `ollamas remote check --all` | win1(10)/win2(20)/mac(99), each qwen3:8b ✓ |
| Failover | `ollamas remote up --watch`, then stop ollama on win1 | supervisor switches to win2 within `--interval`+grace; gateway relaunched |
| Recovery | restart ollama on win1 | supervisor switches back to win1 after `--min-dwell` (priority) |
| Real inference | `ollamas agent run "..."` | `source: ollama_local`, served by the active worker's GPU |

## Notes
- `tailscale status --json` is read via `execFile` (array args, no shell) — safe.
- Zero runtime deps: `node:fetch` + the `tailscale` CLI; no npm additions.
- The 2-machine path (one remote GPU, no failover) is still `REMOTE_GPU.md` +
  `ollamas remote check`. This doc is the multi-worker extension.
