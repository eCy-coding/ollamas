// `ollamas remote` — fleet pool management + gateway failover supervisor.
// IO boundary: all fetch/exec/spawn/fs live here. Pure logic in lib/remote + lib/fleet.
import { parseArgs } from "node:util";
import { execFile, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GatewayClient } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx } from "../lib/output";
import {
  buildRemoteCheck,
  formatRemoteCheck,
  parseBackendPool,
  selectBackend,
  parseTailscalePeers,
  assignDiscoveredPriorities,
  formatPool,
  shouldVerify,
} from "../lib/remote";
import type { Backend, BackendProbe } from "../lib/remote";
import { decideTransition } from "../lib/fleet";
import type { FleetState } from "../lib/fleet";
import { assignWorker, type LedgerEvent, type FleetWorker, type TaskKind, type DispatchTask as LedgerTask } from "../lib/dispatch-ledger";
import { RemoteAgentClient, type DispatchTask as RemoteTask, type DispatchReport } from "../lib/remote-agent";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Pool persistence — ~/.ollamas/backends.json (plain JSON, no secrets)
// ---------------------------------------------------------------------------

function poolPath(): string {
  return join(homedir(), ".ollamas", "backends.json");
}

function loadPool(): Backend[] {
  try {
    return parseBackendPool(JSON.parse(readFileSync(poolPath(), "utf8")));
  } catch {
    return [];
  }
}

function savePool(pool: Backend[]): void {
  const dir = join(homedir(), ".ollamas");
  mkdirSync(dir, { recursive: true });
  writeFileSync(poolPath(), JSON.stringify(pool, null, 2));
}

// ---------------------------------------------------------------------------
// IO: probe a raw ollama backend (not via gateway)
// ---------------------------------------------------------------------------

async function probeBackend(url: string): Promise<BackendProbe> {
  const base = url.replace(/\/+$/, "");
  let reachable = false;
  let mode: string | undefined;
  let models: string[] = [];
  try {
    const vRes = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (vRes.ok) {
      reachable = true;
      const body = await vRes.json().catch(() => ({}));
      mode = typeof body?.version === "string" ? "ollama" : undefined;
    }
  } catch {
    // unreachable
  }
  if (reachable) {
    try {
      const tRes = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (tRes.ok) {
        const body = await tRes.json().catch(() => ({}));
        models = Array.isArray(body?.models)
          ? body.models.map((m: any) => (typeof m?.name === "string" ? m.name : "")).filter(Boolean)
          : [];
      }
    } catch {
      // tags fetch failed — treat as no models
    }
  }
  return { url, reachable, mode, models };
}

async function probeAll(pool: Backend[]): Promise<BackendProbe[]> {
  return Promise.all(pool.map((b) => probeBackend(b.url)));
}

// Inference liveness probe: a backend can be reachable (/api/tags OK) yet hung on
// /api/generate (the desktop-ert7724 incident). A tiny 1-token generate under a
// bounded timeout distinguishes "serving" from "reachable-but-dead". 12s > a warm
// first-token / cold-load, < a true hang (100s+).
async function probeResponsive(url: string, model: string, timeoutMs = 12_000): Promise<boolean> {
  const base = url.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "hi",
        stream: false,
        keep_alive: "30m",
        options: { num_predict: 1, num_ctx: 256 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // ANY HTTP response (incl. 503 "server busy" / transient 5xx) proves the backend
    // is ALIVE and not hung — the failure we guard against is NO response within the
    // timeout. Marking a momentarily-busy backend dead would thrash the supervisor.
    res.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false; // AbortError (timeout = hung) or connection error (offline) → not serving
  }
}

// Generate-verify candidates in PRIORITY order, stopping at the first responsive one.
// Mutates `probes[i].responsive` and the persistent `cache` so a hung backend is
// skipped by selectBackend and a recovered one is re-admitted. Bounded by pool size.
async function verifyCandidates(
  pool: Backend[],
  probes: BackendProbe[],
  required: string[] | undefined,
  cache: Map<string, boolean>,
): Promise<void> {
  const req = required ?? ["qwen3:8b"];
  const model = req[0] ?? "qwen3:8b";
  for (const backend of pool) {
    const p = probes.find((x) => x.url === backend.url);
    if (!p || !p.reachable) continue;
    if (!req.every((m) => p.models.includes(m))) continue;
    const ok = await probeResponsive(backend.url, model);
    cache.set(backend.url, ok);
    p.responsive = ok;
    if (ok) return; // highest-priority responsive backend found — stop probing the rest
  }
}

// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------

const USAGE = `ollamas remote — fleet pool management + gateway failover

usage: ollamas remote <subcommand> [options]

subcommands:
  check [--all]           probe gateway health (default); --all probes entire pool
  discover                auto-discover ollama backends via tailscale status --json
  add <name> <url>        add a backend to the pool
    [--priority N]        (default 50)
  rm <name>               remove a backend from the pool
  ls                      list pool + probe all backends
  pick                    print the best backend URL (for scripting)
  dispatch <task>...      split an epic → assign each task to a fleet worker → dispatch over
    [--epic <file|->]     /api/agent/chat (remote or mac) → failover remote-down→mac → merge report
    [--root dir] [--max-steps n] [--json]
  up [--watch]            launch gateway against best backend; optionally supervise
    [--exec <cmd>]        gateway command (default: npm start)
    [--interval <ms>]     probe interval when watching (default: 5000)
    [--min-dwell <ms>]    minimum ms between switches (default: 10000)
    [--dry-run]           print chosen command without running

options:
  --json       machine-readable output
  --help       this message

exit codes: 0=ok  1=fail/unreachable  2=usage error
`;

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function runCheck(args: string[], cfg: ReturnType<typeof loadConfig>): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      json: { type: "boolean" },
      all: { type: "boolean" },
      required: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) { process.stdout.write(USAGE); return 0; }

  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const requiredOpt = values.required
    ? (values.required as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  if (values.all) {
    // Probe entire pool
    const pool = loadPool();
    if (pool.length === 0) {
      process.stderr.write("ollamas remote: pool is empty — run 'remote add' or 'remote discover'\n");
      return 1;
    }
    const probes = await probeAll(pool);
    const best = selectBackend(pool, probes, { required: requiredOpt });
    process.stdout.write(formatPool(pool, probes, ctx, best?.url ?? undefined) + "\n");
    return best ? 0 : 1;
  }

  // Original single-gateway check behavior
  const client = new GatewayClient(cfg.gateway, cfg.apiKey, cfg.saasAdminToken);

  let health: any = null;
  let models: string[] = [];
  try { health = await client.health(); } catch { /* unreachable */ }
  try { models = await client.listModels("ollama-local"); } catch { /* empty */ }

  const report = buildRemoteCheck(health, models, { required: requiredOpt, gateway: cfg.gateway });
  process.stdout.write(formatRemoteCheck(report, ctx) + "\n");
  return report.pass ? 0 : 1;
}

async function runDiscover(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: { json: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);

  let statusJson: any;
  try {
    // NEVER shell — array args prevent injection
    const { stdout } = await execFileP("tailscale", ["status", "--json"]);
    statusJson = JSON.parse(stdout);
  } catch (e: any) {
    if (e.code === "ENOENT" || /not found/i.test(e.message ?? "")) {
      process.stderr.write(
        "ollamas remote discover: 'tailscale' binary not found — install Tailscale or add backends manually with 'remote add'\n",
      );
    } else {
      process.stderr.write(`ollamas remote discover: tailscale error — ${e.message}\n`);
    }
    return 1;
  }

  const peers = parseTailscalePeers(statusJson);
  if (peers.length === 0) {
    process.stderr.write("ollamas remote discover: no online Tailscale peers found\n");
    return 1;
  }

  // Build backends: peers excluding Self get priority 10, 20, …; Self gets 99
  // (Mac-local is the control plane, less preferred for GPU work). Pure-fn so the
  // priority arithmetic is unit-tested (workers must stay below Self's 99).
  const selfHost =
    statusJson?.Self?.DNSName?.replace(/\.$/, "") ?? "";

  const discovered: Backend[] = assignDiscoveredPriorities(peers, selfHost);

  // Probe all
  const probes = await probeAll(discovered);

  // Merge with existing pool (discovered entries override by url)
  const existing = loadPool();
  const existingByUrl = new Map(existing.map((b) => [b.url, b]));
  for (const d of discovered) existingByUrl.set(d.url, d);
  const merged = parseBackendPool([...existingByUrl.values()]);
  savePool(merged);

  const best = selectBackend(merged, probes);
  process.stdout.write(formatPool(merged, probes, ctx, best?.url ?? undefined) + "\n");
  process.stderr.write(`Saved ${merged.length} backends to ${poolPath()}\n`);
  return 0;
}

async function runAdd(args: string[]): Promise<number> {
  const positional: string[] = [];
  const { values, positionals } = parseArgs({
    args,
    strict: false,
    allowPositionals: true,
    options: {
      priority: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }

  const [name, url] = positionals;
  if (!name || !url) {
    process.stderr.write("usage: ollamas remote add <name> <url> [--priority N]\n");
    return 2;
  }

  const priority = values.priority ? parseInt(values.priority as string, 10) : 50;
  if (isNaN(priority)) {
    process.stderr.write("ollamas remote add: --priority must be a number\n");
    return 2;
  }

  const pool = loadPool();
  // Replace if same url, else append
  const idx = pool.findIndex((b) => b.url === url);
  const entry: Backend = { name, url, priority };
  if (idx >= 0) pool[idx] = entry;
  else pool.push(entry);

  savePool(parseBackendPool(pool));
  process.stdout.write(`Added backend '${name}' (${url}, priority ${priority})\n`);
  return 0;
}

async function runRm(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    strict: false,
    allowPositionals: true,
    options: { help: { type: "boolean" } },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }

  const [name] = positionals;
  if (!name) {
    process.stderr.write("usage: ollamas remote rm <name>\n");
    return 2;
  }

  const pool = loadPool();
  const next = pool.filter((b) => b.name !== name);
  if (next.length === pool.length) {
    process.stderr.write(`ollamas remote rm: no backend named '${name}'\n`);
    return 1;
  }
  savePool(next);
  process.stdout.write(`Removed backend '${name}'\n`);
  return 0;
}

async function runLs(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: { json: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);

  const pool = loadPool();
  if (pool.length === 0) {
    process.stdout.write("Pool is empty. Use 'remote add' or 'remote discover'.\n");
    return 0;
  }
  const probes = await probeAll(pool);
  const best = selectBackend(pool, probes);
  process.stdout.write(formatPool(pool, probes, ctx, best?.url ?? undefined) + "\n");
  return 0;
}

async function runPick(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: { required: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }

  const pool = loadPool();
  const requiredOpt = values.required
    ? (values.required as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const probes = await probeAll(pool);
  const best = selectBackend(pool, probes, { required: requiredOpt });
  if (!best) {
    process.stderr.write("ollamas remote pick: no reachable backend with required models\n");
    return 1;
  }
  process.stdout.write(best.url + "\n");
  return 0;
}

async function runUp(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      watch: { type: "boolean" },
      exec: { type: "string" },
      interval: { type: "string" },
      "min-dwell": { type: "string" },
      "dry-run": { type: "boolean" },
      required: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }

  const pool = loadPool();
  if (pool.length === 0) {
    process.stderr.write("ollamas remote up: pool is empty — run 'remote add' or 'remote discover'\n");
    return 1;
  }

  const requiredOpt = values.required
    ? (values.required as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const intervalMs = parseInt((values.interval as string) ?? "5000", 10) || 5000;
  const minDwellMs = parseInt((values["min-dwell"] as string) ?? "10000", 10) || 10_000;
  // Split exec safely — never pass to shell. Default: npm start
  const execCmd = (values.exec as string | undefined) ?? "npm start";
  const [execBin, ...execArgv] = execCmd.split(/\s+/).filter(Boolean);

  // Persistent inference-liveness cache across watch ticks (url → responsive).
  const responsiveByUrl = new Map<string, boolean>();

  // Initial probe — reachability, then generate-verify candidates in priority order
  // so we never spawn the gateway on a reachable-but-hung backend.
  let probes = await probeAll(pool);
  await verifyCandidates(pool, probes, requiredOpt, responsiveByUrl);
  const best = selectBackend(pool, probes, { required: requiredOpt });
  if (!best) {
    process.stderr.write("ollamas remote up: no reachable + responsive backend found\n");
    return 1;
  }

  if (values["dry-run"]) {
    process.stdout.write(`Would run: OLLAMA_HOST=${best.url} ${execCmd}\n`);
    return 0;
  }

  // Spawn gateway
  const spawnChild = (ollamaHost: string) => {
    process.stderr.write(`[fleet] spawning gateway with OLLAMA_HOST=${ollamaHost}\n`);
    return spawn(execBin, execArgv, {
      stdio: "inherit",
      env: { ...process.env, OLLAMA_HOST: ollamaHost },
    });
  };

  let child = spawnChild(best.url);
  let state: FleetState = { current: best.url, attempt: 0, lastSwitchMs: Date.now() };
  let shuttingDown = false;

  // Graceful teardown (mirrors watch.ts SIGINT pattern)
  const teardown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\n[fleet] shutting down...\n");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    // Let the force-kill timer be garbage-collected if child exits first
    child.once("exit", () => clearTimeout(force));
  };

  process.on("SIGINT", teardown);
  process.on("SIGTERM", teardown);

  if (!values.watch) {
    // Spawn-once: exit when child exits
    return new Promise<number>((resolve) => {
      child.once("exit", (code) => resolve(code ?? 0));
    });
  }

  // Watch loop
  return new Promise<number>((resolve) => {
    let pendingTick: ReturnType<typeof setTimeout> | undefined;
    let tickCount = 0;
    const tick = async () => {
      if (shuttingDown) return;
      tickCount++;
      probes = await probeAll(pool);
      // forget liveness for backends that went unreachable (force a fresh verify on return)
      for (const p of probes) if (!p.reachable) responsiveByUrl.delete(p.url);
      // re-apply cached liveness (probeAll resets responsive to undefined each tick)
      for (const p of probes) { const c = responsiveByUrl.get(p.url); if (c !== undefined) p.responsive = c; }
      // throttled generate-verify (~every 30s): catches a mid-run hang of the active
      // backend AND a hung higher-priority backend recovering — bounded, no per-tick storm.
      if (shouldVerify(tickCount, intervalMs)) {
        await verifyCandidates(pool, probes, requiredOpt, responsiveByUrl);
      }
      const nowMs = Date.now();
      const transition = decideTransition(state, pool, probes, nowMs, { required: requiredOpt, minDwellMs });

      if (transition.action === "stay") {
        schedule(intervalMs);
        return;
      }

      if (transition.action === "wait") {
        schedule(Math.min(transition.delayMs, intervalMs));
        return;
      }

      if (transition.action === "switch") {
        const next = transition.to;
        process.stderr.write(`[fleet] switching backend: ${state.current ?? "none"} → ${next.url}\n`);
        // Kill current child gracefully
        child.kill("SIGTERM");
        await new Promise<void>((res) => {
          const force = setTimeout(() => { child.kill("SIGKILL"); res(); }, 5000);
          child.once("exit", () => { clearTimeout(force); res(); });
        });
        state = { current: next.url, attempt: 0, lastSwitchMs: Date.now() };
        child = spawnChild(next.url);
        child.once("exit", (code) => {
          if (!shuttingDown) {
            process.stderr.write(`[fleet] child exited (${code}); restarting tick\n`);
            schedule(intervalMs);
          } else {
            resolve(code ?? 0);
          }
        });
      }

      // Keep probing after a switch too, so a recovered higher-priority backend
      // triggers failback (was: only the child-exit path re-ticked -> one-shot).
      schedule(intervalMs);
    };

    const schedule = (ms: number) => {
      if (shuttingDown) return;
      if (pendingTick) clearTimeout(pendingTick);
      pendingTick = setTimeout(tick, ms);
    };

    child.once("exit", (code) => {
      if (shuttingDown) resolve(code ?? 0);
    });

    // First tick after intervalMs
    schedule(intervalMs);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// dispatch — split an epic into sub-agent tasks, assign each to a fleet worker
// (assignWorker), dispatch over HTTP /api/agent/chat (RemoteAgentClient), failover
// remote-down → mac substrate, merge into one epic report. N-012: HTTP only, no ToolRegistry.
// Reproduces the DISPATCH_SIM golden trace: host-tool→mac, codegen→remote, remote-down→mac.
// ---------------------------------------------------------------------------

interface DispatchResult { taskId: string; worker: string | null; report: DispatchReport | null; failedOver: boolean; }
export interface EpicReport {
  tasks: { taskId: string; worker: string | null; verdict: string; failedOver: boolean }[];
  files: string[]; errors: string[]; allOk: boolean; verdict: "DONE" | "INCOMPLETE";
}

/** Epic text → one task per non-empty, non-`#` line. Pure. */
export function parseEpic(text: string): { id: string; prompt: string }[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((prompt, i) => ({ id: `t${i + 1}`, prompt }));
}

/** Heuristic kind: terminal/shell work = host-tool (mac only); analyse = analysis; else codegen. Pure. */
export function inferTaskKind(prompt: string): TaskKind {
  if (/\b(terminal|shell|iterm|run it|execute|open app|macos)\b/i.test(prompt)) return "host-tool";
  if (/\b(analy|review|explain|investigate|audit)\b/i.test(prompt)) return "analysis";
  return "codegen";
}

/** Fleet workers = pool backends (remote) + the mac control plane. Pure. */
export function buildWorkers(pool: Backend[], macHealthy = true): FleetWorker[] {
  const remotes: FleetWorker[] = pool.map((b) => ({ name: b.name, kind: "remote", healthy: true }));
  return [...remotes, { name: "mac", kind: "mac", healthy: macHealthy }];
}

/** Merge per-task results → one epic report (allOk = every task DONE/OK && none demo). Pure. */
export function mergeEpicReport(results: DispatchResult[]): EpicReport {
  const files = new Set<string>(); const errors: string[] = [];
  const tasks: EpicReport["tasks"] = [];
  let allOk = results.length > 0;
  for (const r of results) {
    const v = r.report?.verdict ?? "INCOMPLETE";
    if (r.report) { for (const f of r.report.files) files.add(f); errors.push(...r.report.errors); }
    const ok = (v === "DONE" || v === "OK") && !r.report?.demoSuspected;
    if (!ok) allOk = false;
    tasks.push({ taskId: r.taskId, worker: r.worker, verdict: v, failedOver: r.failedOver });
  }
  return { tasks, files: [...files], errors, allOk, verdict: allOk ? "DONE" : "INCOMPLETE" };
}

async function runDispatch(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: false,
    options: {
      epic: { type: "string" }, root: { type: "string" }, "max-steps": { type: "string" },
      provider: { type: "string" }, model: { type: "string" }, port: { type: "string" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  if (values.help) { process.stdout.write(USAGE); return 0; }

  // Epic source: --epic <file|-> | positionals | stdin.
  let epicText = "";
  const epicArg = values.epic as string | undefined;
  if (epicArg && epicArg !== "-") {
    try { epicText = readFileSync(epicArg, "utf8"); }
    catch { process.stderr.write(`ollamas remote dispatch: cannot read epic '${epicArg}'\n`); return 2; }
  } else if (positionals.length) {
    epicText = positionals.join("\n");
  } else if (!process.stdin.isTTY) {
    epicText = readFileSync(0, "utf8");
  }
  const rawTasks = parseEpic(epicText);
  if (!rawTasks.length) { process.stderr.write('usage: ollamas remote dispatch "<task>"... | --epic <file|-> [--root dir] [--json]\n'); return 2; }

  const root = (values.root as string) || `${homedir()}/.llm-mission-control/agent-work`;
  const maxSteps = Number(values["max-steps"] ?? "10");
  const port = Number(values.port ?? "8090");
  const provider = values.provider as string | undefined;
  const model = values.model as string | undefined;

  const pool = loadPool();
  const baseWorkers = buildWorkers(pool);
  const client = new RemoteAgentClient();
  let fence = 1;
  const ledger: LedgerEvent[] = [];
  const results: DispatchResult[] = [];

  for (const rt of rawTasks) {
    const kind = inferTaskKind(rt.prompt);
    const ltask: LedgerTask = { id: rt.id, kind };
    const remoteTask: RemoteTask = { prompt: rt.prompt, root: `${root}/${rt.id}`, provider, model, maxSteps };
    let workers = baseWorkers;
    let assignment = assignWorker(ltask, workers);
    let report: DispatchReport | null = null;
    let failedOver = false;

    // Up to 2 hops: initial assignment, then failover to the mac substrate on failure.
    for (let hop = 0; hop < 2 && assignment.worker; hop++) {
      const wname = assignment.worker;
      ledger.push({ ts: Date.now(), taskId: rt.id, worker: wname, status: "claimed", ttlMs: 1_200_000, fence: fence++ });
      try {
        if (wname === "mac") report = await client.dispatch("127.0.0.1", port, remoteTask);
        else {
          const b = pool.find((p) => p.name === wname);
          report = b ? await client.dispatchToBackend(b, remoteTask) : await client.dispatch(wname, port, remoteTask);
        }
      } catch { report = null; }
      const ok = !!report && (report.verdict === "DONE" || report.verdict === "OK") && !report.demoSuspected && report.errors.length === 0;
      if (ok) { ledger.push({ ts: Date.now(), taskId: rt.id, worker: wname, status: "done", ttlMs: 0, fence: fence++ }); break; }
      // Failover: mark the failed worker unhealthy → re-assign (assignWorker yields mac substrate).
      ledger.push({ ts: Date.now(), taskId: rt.id, worker: wname, status: "failed", ttlMs: 0, fence: fence++ });
      workers = workers.map((w) => (w.name === wname ? { ...w, healthy: false } : w));
      const next = assignWorker(ltask, workers);
      if (!next.worker || next.worker === wname) { assignment = next; break; }
      assignment = next; failedOver = true;
    }
    results.push({ taskId: rt.id, worker: assignment.worker, report, failedOver });
  }

  const epic = mergeEpicReport(results);
  if (values.json) { process.stdout.write(JSON.stringify(epic, null, 2) + "\n"); return epic.allOk ? 0 : 1; }
  const okCount = epic.tasks.filter((t) => t.verdict === "DONE" || t.verdict === "OK").length;
  const L: string[] = [`── ollamas remote dispatch ──  ${results.length} task`];
  for (const t of epic.tasks) L.push(`  ${t.taskId}  → ${t.worker ?? "—"}  ${t.verdict}${t.failedOver ? " (failed-over)" : ""}`);
  if (epic.files.length) L.push(`  files: ${epic.files.join(", ")}`);
  if (epic.errors.length) L.push(`  errors: ${epic.errors.slice(0, 5).join(" | ").slice(0, 300)}`);
  L.push(`  VERDICT: ${epic.verdict}  (${okCount}/${epic.tasks.length} ok)`);
  process.stdout.write(L.join("\n") + "\n");
  return epic.allOk ? 0 : 1;
}

export async function runRemote(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "--help" || sub === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  // Default: bare `ollamas remote` → check
  const subcmd = sub === undefined ? "check" : sub;
  const args = sub === subcmd ? rest : argv; // if sub was a subcommand, rest is the args

  const cfg = loadConfig();

  switch (subcmd) {
    case "check":
      return runCheck(sub === "check" ? rest : argv, cfg);
    case "discover":
      return runDiscover(rest);
    case "add":
      return runAdd(rest);
    case "rm":
      return runRm(rest);
    case "ls":
      return runLs(rest);
    case "pick":
      return runPick(rest);
    case "up":
      return runUp(rest);
    case "dispatch":
      return runDispatch(rest);
    default:
      process.stderr.write(`ollamas remote: unknown subcommand '${sub}'\n${USAGE}`);
      return 2;
  }
}
