# LANE_PROMPTS_DISPATCH — yapıştır-hazır görev prompt'ları (vO19 teslimat)

> Orchestration lane üretti (`SPEC_DISPATCH.md`'den). Her blok **sahibi lane sekmesine** yapıştırılır;
> o lane uygular (Scope §3 — bu sekme kod yazmaz). Sıra: a→b→c→d (cli), s.1→s.2 (scripts), e.1 (e2e).
> Ortak çalışma prensibi (her görev): root-cause → TDD (test önce) → evidence-first (komut+çıktı) →
> kalite kapısı (`tsc --noEmit` → `vitest run` taze → lint) green → conventional commit. ToolRegistry import YOK (N-012).

---

## cli v1.x-a — `RemoteAgentClient` (remote `/api/agent/chat` dispatch)
**Lane:** cli · **Dosya:** `cli/lib/remote-agent.ts` (+ `cli/lib/remote-agent.test.ts`)

```
Implement RemoteAgentClient: zero-dep thin fetch wrapper that dispatches one agent task to a
REMOTE ollamas server over HTTP and returns a structured report — mirrors scripts/agent-dispatch.mjs
exactly, NEVER imports server/tool-registry (N-012 choke-point law; verify with the grep gate).

API: dispatch(host: string, port: number, task: { prompt: string; provider?: string; model?: string;
  maxSteps?: number; root: string; timeoutMs?: number }): Promise<DispatchReport>
- POST http://<host>:<port>/api/agent/chat, Accept: text/event-stream, body shape IDENTICAL to
  agent-dispatch.mjs ({ provider, model?, autoApply:true, maxSteps, messages:[{role:"user",content}] }).
- Parse the SSE stream (data: lines) → collect steps {n,tool,ok,out}, files, errors, messages.
- DispatchReport: { host, steps, files, errors, demoSuspected, verdict } where
  demoSuspected = steps.length===0 && messages.length>0 && errors.length===0;
  verdict = DONE|BLOCKED from final message regex, else OK|INCOMPLETE (agent-dispatch.mjs parity).
- AbortController timeout (default 180000ms). Never throw on HTTP error → report.errors + verdict INCOMPLETE.

Pure split: a pure parseSseReport(lines) (testable, no IO) + thin dispatch() (fetch only).
TDD first: parseSseReport over canned SSE frames (step/message/done/error, demo case, timeout). Reuse
cli/lib/client.ts GatewayClient patterns. Gate: grep -rn "tool-registry" cli/lib/remote-agent.ts = empty.
```

---

## cli v1.x-b — dağıtık ledger `(taskId)` + `assignWorker`
**Lane:** cli · **Dosya:** `cli/lib/dispatch.ts` (+ `cli/lib/dispatch.test.ts`)

```
Port orchestration/bin/lib/claims.ts engine from (lane|version) to (taskId) work items, AND port the
pure assignWorker from orchestration/bin/lib/dispatchbench.ts (the reference impl — copy logic + tests).

Ledger: append-only JSONL at ~/.ollamas/dispatch-ledger.jsonl, atomic mkdir-lock, LWW (ts→fence→tab),
TTL/heartbeat stale-takeover, monotonic fence. Event: { ts, taskId, worker, tab, status
(queued|claimed|running|done|failed), ttlMs, fence, taskSpec, report }. Keep the pure core (parse/fold/
active/stale/collision/nextFence) IO-free and unit-tested; IO wrapper does the lock+append.

assignWorker(task, workers, opts?) — pure, deterministic, mirrors cli/lib/fleet.ts decideTransition:
host-tool→mac only (mac down→null); codegen/analysis→highest-tok/s healthy remote, else mac substrate
failover; thrash-guard: keep opts.current if still eligible. Copy the 8 test cases from
orchestration/tests/dispatchbench.test.ts (assignWorker block) verbatim, adapt imports.

TDD first. Gate: tsc + vitest + grep no tool-registry.
```

---

## cli v1.x-c — `ollamas remote dispatch` subcommand
**Lane:** cli · **Dosya:** `cli/commands/remote.ts` (extend) (+ tests)

```
Add `ollamas remote dispatch` subcommand: split an epic into independent sub-agent tasks → assignWorker
each → claim in the (taskId) ledger → dispatch via RemoteAgentClient (remote) or local /api/agent/chat
(mac) → renew heartbeat during the SSE stream → close done|failed → merge structured reports into ONE
epic report (epicOk = every task done && no demoSuspected).

Flags: `--epic <file|->` (task list, one per line or JSON), `--root <base>` (per-task subdir = write-root
isolation), `--max-steps N`, `--json`. Workers discovered from ~/.ollamas/backends.json + a mac entry;
health via existing probe. On remote worker down mid-run → ledger stale-takeover re-routes to mac substrate
(decideTransition) — the task must still complete (Hybrid failback). Exit 0 only if epicOk.

Reuse: cli/commands/remote.ts pool/probe code, cli/lib/dispatch.ts (b), cli/lib/remote-agent.ts (a),
cli/lib/fleet.ts decideTransition. TDD: pure split/merge + a fake-dispatch injected client. Gate green.
```

---

## cli v1.x-d — failover re-route (worker down → substrate)
**Lane:** cli · **Dosya:** `cli/lib/fleet.ts` / `cli/commands/remote.ts` (extend) (+ tests)

```
Wire the dispatch supervisor to the existing failover: when a claimed remote task's worker fails health
(or SSE errors/times out), mark the ledger event failed → re-queue the task and re-run assignWorker, which
(remote now unhealthy) returns the mac substrate. Keep thrash-guard minDwellMs + exponential backoff from
fleet.ts. Add a pure decideReroute(taskState, workers, now) returning {action:"reroute",to}|{action:"hold",
delayMs}|{action:"stay"} mirroring decideTransition. TDD: worker-down→reroute-to-mac; flapping→hold;
healthy→stay. No mocks of fleet logic — pure fn tests. Gate green.
```

---

## scripts s.1 — desktop-ert7724 server bring-up + ready parity
**Lane:** scripts/server · **Dosya:** `scripts/fleet-join.ps1` (extend) + `scripts/ready.mjs` (parity check)

```
Extend the Windows fleet-join so desktop-ert7724 runs a FULL ollamas agent server (not just ollama):
ensure Tailscale up, OLLAMA_HOST=0.0.0.0:11434, qwen3:8b pulled (ready.mjs parity), start the ollamas
server bound to the tailnet on a fixed port, open the firewall for that port, and expose it via
`tailscale serve` (HTTPS over MagicDNS) restricted by ACL to the mac orchestrator group. Add a
`scripts/ready.mjs --remote desktop-ert7724` check that probes the remote /api/health + /api/version and
asserts mode=live (not demo) + qwen3:8b present. Evidence: paste the real probe JSON. No secrets in repo.
```

---

## scripts s.2 — `agent-dispatch.mjs --remote <host>` + merge aggregator
**Lane:** scripts · **Dosya:** `scripts/agent-dispatch.mjs` (extend) + `scripts/dispatch-merge.mjs` (new)

```
Add `--remote <host>` (and `--port`) to agent-dispatch.mjs so it targets http://<host>:<port>/api/agent/chat
instead of OLLAMAS_URL — same body, same structured report, same exit semantics. Add scripts/dispatch-merge.mjs:
read N per-task JSON reports (stdin/glob) → emit ONE merged epic report { tasks[], files[], errors[],
allOk, verdict }. Keep zero-dep node. Evidence: dispatch a trivial task to --remote and show the report.
```

---

## e2e e.1 — distributed conformance (real Tailscale + GPU)
**Lane:** scripts(e2e) · **Dosya:** `tests/dispatch.e2e.test.ts` (new)

```
E2E, NO MOCKS. Boot the real mac server AND require a live desktop-ert7724 over Tailscale (skip-with-loud-
warn if unreachable, like smoke-live.e2e.test.ts live gates). Assert:
(1) dispatch a real coding task to desktop-ert7724 → structured report with files written ON DESKTOP +
    verdict===DONE + GPU tok/s within the proven 24–47 range;
(2) kill the desktop worker mid-run → ledger stale-takeover re-routes to mac substrate → epic still allOk;
(3) dispatchbench produces a deterministic DISPATCH_SELECTION.json (run twice → identical).
Wire into npm scripts (e.g. npm run dispatch:e2e). Gates: npm test / npm run conformance / npm run smoke stay green.
```
