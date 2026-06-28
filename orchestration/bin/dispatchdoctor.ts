#!/usr/bin/env tsx
/**
 * orchestration/bin/dispatchdoctor.ts — vO21 Fleet dispatch readiness doctor CLI (read-only probe).
 *
 * Reads ~/.ollamas/backends.json (Backend pool) + the implicit mac control gateway, probes each worker's
 * /api/health (ollamas gateway marker) + /api/tags (ollama-native) → classify (gateway|inference-only|down)
 * → per-Hybrid-mode GO/NO-GO + remediation → DISPATCH_DOCTOR.md. Thin IO only; logic in lib/dispatchdoctor.
 * Scope §3: reads pool + network, writes only orchestration/. Honest: no fabrication.
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/dispatchdoctor.ts [--model qwen3:8b] [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { classifyWorker, fleetReadiness, renderDispatchDoctor, type WorkerProbe } from "./lib/dispatchdoctor";

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
    const arr = Array.isArray(j) ? j : [];
    return arr
      .filter((e: unknown) => e && typeof e === "object" && typeof (e as PoolEntry).url === "string")
      .map((e: PoolEntry) => ({ name: String(e.name || e.url), url: e.url }));
  } catch { return []; }
}

/** GET <base><path> body, or null on any non-200/timeout/error (never throws). */
async function probe(base: string, path: string): Promise<string | null> {
  try {
    const r = await fetch(base.replace(/\/$/, "") + path, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function probeWorker(name: string, url: string, control: boolean): Promise<WorkerProbe> {
  const [healthBody, tagsBody] = await Promise.all([probe(url, "/api/health"), probe(url, "/api/tags")]);
  return { name, url, control, healthBody, tagsBody };
}

async function main(): Promise<void> {
  const requiredModel = opt("--model", "qwen3:8b");
  // Workers: implicit mac control gateway + the discovered/added remote pool (dedupe mac url).
  const pool = readPool().filter((e) => e.url !== MAC_GATEWAY);
  const probes = await Promise.all([
    probeWorker("mac", MAC_GATEWAY, true),
    ...pool.map((e) => probeWorker(e.name, e.url, false)),
  ]);
  const statuses = probes.map(classifyWorker);
  const readiness = fleetReadiness(statuses, requiredModel);
  const ts = new Date().toISOString();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ts, requiredModel, statuses, readiness }, null, 2));
    return;
  }

  const md = renderDispatchDoctor(statuses, readiness, requiredModel, ts);
  writeFileSync(join(ORCH_DIR, "DISPATCH_DOCTOR.md"), md.endsWith("\n") ? md : md + "\n");
  process.stdout.write(md + "\n");
  console.error(`[dispatchdoctor] DISPATCH_DOCTOR.md · ${statuses.length} worker · offload ${readiness.inferenceOffload.go ? "GO" : "NO-GO"} · full-remote ${readiness.fullRemoteDispatch.go ? "GO" : "NO-GO"}`);
}

if (process.argv[1] && /dispatchdoctor\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[dispatchdoctor] hata:", (e as Error)?.message ?? e); process.exit(1); });
}
