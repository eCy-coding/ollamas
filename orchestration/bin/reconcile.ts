#!/usr/bin/env tsx
/**
 * orchestration/bin/reconcile.ts — vO23 Autonomous Fleet Reconcile CLI + continuous loop.
 *
 * One-shot: probe the live fleet (dispatchdoctor) + read the benchmark choice (DISPATCH_SELECTION.json)
 * → build desired/actual → `reconcile` → emit RECONCILE.md (single next action). `--watch` runs the
 * uninterrupted real-time loop (setInterval, heartbeat.ts pattern): probe → reconcile → emit, delta-notify
 * only on action change (alert-fatigue guard). Benchmark-driven, no human in the loop. Scope §3: orchestration only.
 *
 * Çalıştır: tsx orchestration/bin/reconcile.ts [--mode inference-offload|full-remote] [--model qwen3:8b] [--json] [--watch [--interval 5000]]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { classifyWorker, fleetReadiness, type WorkerProbe } from "./lib/dispatchdoctor";
import { reconcile, renderReconcile, type DesiredState, type ActualState, type HybridMode, type ReconcileAction } from "./lib/reconcile";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const POOL = join(homedir(), ".ollamas", "backends.json");
const MAC_GATEWAY = process.env.OLLAMAS_URL || "http://127.0.0.1:8090";
const PROBE_MS = Number(process.env.DISPATCH_PROBE_MS || 800);

function opt(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

interface PoolEntry { name: string; url: string; }
function readPool(): PoolEntry[] {
  if (!existsSync(POOL)) return [];
  try {
    const j = JSON.parse(readFileSync(POOL, "utf8"));
    return (Array.isArray(j) ? j : []).filter((e: unknown) => e && typeof e === "object" && typeof (e as PoolEntry).url === "string")
      .map((e: PoolEntry) => ({ name: String(e.name || e.url), url: e.url }));
  } catch { return []; }
}
async function probe(base: string, path: string): Promise<string | null> {
  try {
    const r = await fetch(base.replace(/\/$/, "") + path, { signal: AbortSignal.timeout(PROBE_MS) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
async function probeWorker(name: string, url: string, control: boolean): Promise<WorkerProbe> {
  const [healthBody, tagsBody] = await Promise.all([probe(url, "/api/health"), probe(url, "/api/tags")]);
  return { name, url, control, healthBody, tagsBody };
}

/** Read the benchmark-chosen variant for the desired mode from DISPATCH_SELECTION.json (null if none). */
function readVariant(): string | null {
  const f = join(ORCH_DIR, "DISPATCH_SELECTION.json");
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as { machines?: { variant?: string | null }[] };
    for (const m of j.machines || []) if (m && m.variant) return m.variant; // first measured variant
    return null;
  } catch { return null; }
}

/** Probe the fleet → build (desired, actual). */
async function snapshot(mode: HybridMode, requiredModel: string): Promise<{ desired: DesiredState; actual: ActualState }> {
  const pool = readPool().filter((e) => e.url !== MAC_GATEWAY);
  const probes = await Promise.all([probeWorker("mac", MAC_GATEWAY, true), ...pool.map((e) => probeWorker(e.name, e.url, false))]);
  const statuses = probes.map(classifyWorker);
  const readiness = fleetReadiness(statuses, requiredModel);
  const actual: ActualState = {
    anyReachable: statuses.some((s) => s.capability !== "down"),
    offloadGo: readiness.inferenceOffload.go,
    fullRemoteGo: readiness.fullRemoteDispatch.go,
    remediation: (mode === "full-remote" ? readiness.fullRemoteDispatch : readiness.inferenceOffload).remediation,
  };
  return { desired: { mode, requiredModel, variant: readVariant() }, actual };
}

function actionKey(a: ReconcileAction): string {
  return `${a.kind}|${a.detail}`;
}

async function main(): Promise<void> {
  const mode = (opt("--mode", "inference-offload") === "full-remote" ? "full-remote" : "inference-offload") as HybridMode;
  const requiredModel = opt("--model", "qwen3:8b");
  const watch = process.argv.includes("--watch");
  const interval = Number(opt("--interval", "5000"));
  const json = process.argv.includes("--json");

  if (!watch) {
    const { desired, actual } = await snapshot(mode, requiredModel);
    const action = reconcile({ desired, actual, attempt: 0 });
    const ts = new Date().toISOString();
    if (json) { console.log(JSON.stringify({ ts, desired, actual, action }, null, 2)); return; }
    const md = renderReconcile({ desired, actual, attempt: 0 }, action, ts);
    writeFileSync(join(ORCH_DIR, "RECONCILE.md"), md.endsWith("\n") ? md : md + "\n");
    process.stdout.write(md + "\n");
    console.error(`[reconcile] RECONCILE.md · ${mode} · ▶ ${action.kind}`);
    return;
  }

  // --watch: uninterrupted reconcile loop (heartbeat pattern). Delta-notify only on action change.
  let lastKey = "";
  let attempt = 0;
  let ticks = 0;
  const maxTicks = Number(opt("--max-ticks", "0")); // 0 = forever
  console.error(`[reconcile] --watch every ${interval}ms · ${mode} · Ctrl-C to stop`);
  const tick = async (): Promise<void> => {
    ticks++;
    const { desired, actual } = await snapshot(mode, requiredModel);
    attempt = actual.anyReachable ? 0 : attempt + 1; // backoff attempt counter
    const action = reconcile({ desired, actual, attempt });
    const key = actionKey(action);
    if (key !== lastKey) { // delta-notify (alert-fatigue guard)
      lastKey = key;
      const ts = new Date().toISOString();
      writeFileSync(join(ORCH_DIR, "RECONCILE.md"), renderReconcile({ desired, actual, attempt }, action, ts) + "\n");
      console.error(`[reconcile] tick ${ticks} · ▶ ${action.kind} — ${action.detail}`);
    }
    if (maxTicks > 0 && ticks >= maxTicks) { clearInterval(timer); console.error(`[reconcile] reached --max-ticks ${maxTicks}, stopping.`); }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error("[reconcile] tick error:", (e as Error)?.message)); }, interval);
  await tick(); // immediate first tick
}

if (process.argv[1] && /reconcile\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[reconcile] hata:", (e as Error)?.message ?? e); process.exit(1); });
}
