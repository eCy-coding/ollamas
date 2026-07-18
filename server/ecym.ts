/**
 * server/ecym.ts — eCy Distillation Engine (v10). Develops Emre's personal model
 * `ecy:latest` by DISTILLING the project's benchmark evidence + working principles
 * into a fresh Modelfile and rebuilding the model via `ollama create`.
 *
 * Reuses the real engines: optimize.ts (selectBest/optimalConfig — hardware-aware
 * base+params from BENCH.json), ai.ts generate (validation probe), council.ts
 * checkAnswer (probe verdict), db (version history, atomic save).
 * Security: model names whitelisted; Modelfile written inside the workspace only;
 * subprocess uses execFile arg-array (no shell interpolation).
 */
import { execFile } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { generate } from "./ai";
import { checkAnswer } from "./council";
import {
  optimalConfig,
  parseSysctl,
  selectBest,
  type OptConfig,
  type SysInfo,
} from "../orchestration/bin/lib/optimize";

// ============ TYPES ============

export interface EcymVersion {
  id: string;
  createdAt: string;
  base: string;
  numCtx: number;
  temperature: number;
  probeOk: boolean;
  note: string;
}

export interface EcymStatus {
  exists: boolean;
  model: string;
  base: string;
  systemHead: string;
  benchAggs: number;
  championCandidate: string | null;
  versions: EcymVersion[];
}

export interface DistillEvent {
  stage: "plan" | "modelfile" | "create" | "probe" | "done" | "error";
  status: "running" | "done" | "fail";
  text?: string;
  version?: EcymVersion;
}

interface DBLike {
  data: { workspacePath: string; ecymVersions?: EcymVersion[] };
  save: () => void;
}
type Guard = (req: Request, res: Response, next: () => void) => void;

// Only these targets may ever be created/rebuilt — never arbitrary model names.
export const ECYM_WHITELIST = ["ecy:latest", "ecy:candidate"] as const;
export type EcymModelName = (typeof ECYM_WHITELIST)[number];
export const DEFAULT_ECYM_BASE = "qwen3:8b-16k"; // measured current base of ecy:latest

const PROBE_QUESTION = "Compute 2 + 7 * 3 and reply with just the number.";
const PROBE_ANSWER = "23";

// ============ SYSTEM-PROMPT DISTILLATION (pure) ============

/** The stable eCy identity core — who the model is, independent of tuning. */
export const ECY_IDENTITY = [
  "You are eCy — Emre's personal, self-hosted AI. You run fully local ($0, private); nothing leaves this machine.",
  "Voice: direct, terse, evidence-first. Türkçe soruya Türkçe, English to English.",
].join("\n");

/** Project working principles distilled into the model (from the ollamas laws). */
export const ECY_PRINCIPLES = [
  "Root cause over symptom fix.",
  "Evidence before claims — show the command/output, never assert blindly.",
  "Honest uncertainty: say 'I don't know' instead of inventing facts.",
  "Prefer reuse over rebuild; smallest correct change wins.",
  "Never fake success; report failures plainly.",
].join(" ");

/**
 * Build the distilled Modelfile (pure — unit-testable, no I/O).
 * FROM <hardware-chosen base> + SYSTEM <identity+principles> + PARAMETER tuning.
 */
export function buildEcymModelfile(opts: {
  base: string;
  config: OptConfig;
  sys: SysInfo;
  temperature?: number;
  /** Existing persona core — PRESERVED verbatim when present (never overwrite Emre's voice). */
  identity?: string;
}): string {
  const temperature = Math.min(1, Math.max(0, opts.temperature ?? 0.4));
  const identity = (opts.identity ?? "").trim() || ECY_IDENTITY;
  return [
    `# eCy — distilled by ollamas eCy Studio (${new Date().toISOString()})`,
    `# Hardware: ${opts.sys.chip} · ${opts.sys.ramGb}GB · ${opts.sys.cores} cores`,
    `FROM ${opts.base}`,
    ``,
    `SYSTEM """`,
    identity,
    ``,
    `Working principles: ${ECY_PRINCIPLES}`,
    `"""`,
    ``,
    `PARAMETER num_ctx ${opts.config.num_ctx}`,
    `PARAMETER num_thread ${opts.config.num_thread}`,
    `PARAMETER temperature ${temperature}`,
    ``,
  ].join("\n");
}

/** Fetch the CURRENT full SYSTEM prompt of a model from ollama (persona preservation). */
export async function getCurrentSystem(model: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const r = await fetchImpl("http://localhost:11434/api/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return "";
    const j = (await r.json()) as { system?: string; modelfile?: string };
    if (j.system?.trim()) return j.system.trim();
    return (/SYSTEM\s+"""([\s\S]*?)"""/.exec(j.modelfile || "")?.[1] || "").trim();
  } catch {
    return "";
  }
}

// ============ BENCH-DRIVEN BASE SELECTION ============

interface BenchFile {
  aggs?: unknown[];
}

/** Read BENCH.json (best-effort). */
export function readBench(repoRoot: string): BenchFile {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, "orchestration", "BENCH.json"), "utf8")) as BenchFile;
  } catch {
    return { aggs: [] };
  }
}

/** Detect hardware (sysctl on macOS; honest fallback elsewhere). */
export function detectSys(): SysInfo {
  try {
    const mem = execSync("sysctl -n hw.memsize", { encoding: "utf8" }).trim();
    const cpu = execSync("sysctl -n hw.physicalcpu", { encoding: "utf8" }).trim();
    const brand = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf8" }).trim();
    return parseSysctl(mem, cpu, brand);
  } catch {
    return { arch: process.arch, ramGb: 16, cores: 8, chip: "unknown" };
  }
}

/**
 * Pick the distillation base: benchmark champion when real bench data exists,
 * otherwise honestly keep the current base (never guess an unbenchmarked swap).
 */
export function pickBase(bench: BenchFile, ramGb: number, currentBase: string): { base: string; reason: string } {
  const aggs = Array.isArray(bench.aggs) ? bench.aggs : [];
  if (aggs.length > 0) {
    const best = selectBest(aggs as never, ramGb);
    if (best) return { base: best.model, reason: `benchmark champion (${best.tokS} tok/s, score ${best.score})` };
  }
  return { base: currentBase, reason: "no benchmark data — keeping current base (honest fallback)" };
}

// ============ STATUS ============

export async function getEcymStatus(db: DBLike, fetchImpl: typeof fetch = fetch): Promise<EcymStatus> {
  const versions = db.data.ecymVersions ?? [];
  const bench = readBench(process.cwd());
  const aggs = Array.isArray(bench.aggs) ? bench.aggs.length : 0;
  try {
    const r = await fetchImpl("http://localhost:11434/api/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ecy:latest" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`ollama show → ${r.status}`);
    const j = (await r.json()) as { details?: { parent_model?: string; family?: string }; system?: string; modelfile?: string };
    const base = j.details?.parent_model || j.details?.family || DEFAULT_ECYM_BASE;
    const systemHead = (j.system || /SYSTEM\s+"""([\s\S]*?)"""/.exec(j.modelfile || "")?.[1] || "").slice(0, 240).trim();
    const sys = detectSys();
    const pick = pickBase(bench, sys.ramGb, base);
    return { exists: true, model: "ecy:latest", base, systemHead, benchAggs: aggs, championCandidate: pick.base !== base ? pick.base : null, versions };
  } catch {
    return { exists: false, model: "ecy:latest", base: DEFAULT_ECYM_BASE, systemHead: "", benchAggs: aggs, championCandidate: null, versions };
  }
}

// ============ VERSION HISTORY ============

export function recordEcymVersion(db: DBLike, v: EcymVersion): void {
  if (!Array.isArray(db.data.ecymVersions)) db.data.ecymVersions = [];
  db.data.ecymVersions.push(v);
  // Keep the last 50 — the ledger is evidence, not a landfill.
  if (db.data.ecymVersions.length > 50) db.data.ecymVersions = db.data.ecymVersions.slice(-50);
  db.save();
}

// ============ DISTILL (async generator → SSE) ============

interface DistillDeps {
  runCreate?: (modelfilePath: string, model: EcymModelName) => Promise<string>;
  probe?: (model: EcymModelName) => Promise<boolean>;
}

function defaultRunCreate(modelfilePath: string, model: EcymModelName): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ollama", ["create", model, "-f", modelfilePath], { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout || stderr || "created");
    });
  });
}

async function defaultProbe(model: EcymModelName): Promise<boolean> {
  const { text } = await generate(PROBE_QUESTION, { model });
  return checkAnswer(text, PROBE_ANSWER);
}

/**
 * The distillation loop: plan (hw+bench) → Modelfile → ollama create → probe →
 * version record. Yields SSE-ready events; deps injectable for tests.
 */
export async function* distillEcym(db: DBLike, target: string, deps: DistillDeps = {}): AsyncGenerator<DistillEvent> {
  if (!(ECYM_WHITELIST as readonly string[]).includes(target)) {
    yield { stage: "error", status: "fail", text: `model '${target}' is not in the eCy whitelist` };
    return;
  }
  const model = target as EcymModelName;
  const runCreate = deps.runCreate ?? defaultRunCreate;
  const probe = deps.probe ?? defaultProbe;

  yield { stage: "plan", status: "running" };
  const sys = detectSys();
  const bench = readBench(process.cwd());
  const status = await getEcymStatus(db).catch(() => null);
  const currentBase = status?.base || DEFAULT_ECYM_BASE;
  const { base, reason } = pickBase(bench, sys.ramGb, currentBase);
  const config = optimalConfig(sys.ramGb, sys.cores, base);
  yield { stage: "plan", status: "done", text: `base=${base} (${reason}) · num_ctx=${config.num_ctx} thread=${config.num_thread}` };

  yield { stage: "modelfile", status: "running" };
  // Preserve Emre's existing eCy persona verbatim; only the principles+params refresh.
  const identity = await getCurrentSystem("ecy:latest");
  const modelfile = buildEcymModelfile({ base, config, sys, identity });
  const dir = path.join(db.data.workspacePath, ".ecym");
  const mfPath = path.join(dir, "Modelfile");
  // The write stays inside the workspace — same containment rule as FilesystemManager.
  if (!path.resolve(mfPath).startsWith(path.resolve(db.data.workspacePath) + path.sep)) {
    yield { stage: "error", status: "fail", text: "modelfile path escapes workspace" };
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mfPath, modelfile, "utf8");
  yield { stage: "modelfile", status: "done", text: mfPath };

  yield { stage: "create", status: "running", text: `ollama create ${model}` };
  try {
    const out = await runCreate(mfPath, model);
    yield { stage: "create", status: "done", text: out.slice(0, 200) };
  } catch (err) {
    yield { stage: "error", status: "fail", text: `ollama create failed: ${(err as Error).message.slice(0, 300)}` };
    return;
  }

  yield { stage: "probe", status: "running", text: PROBE_QUESTION };
  let probeOk = false;
  try {
    probeOk = await probe(model);
  } catch {
    probeOk = false;
  }
  yield { stage: "probe", status: probeOk ? "done" : "fail", text: probeOk ? "probe PASS" : "probe FAIL — model answered incorrectly" };

  const version: EcymVersion = {
    id: `ecym-${Date.now()}`,
    createdAt: new Date().toISOString(),
    base,
    numCtx: config.num_ctx,
    temperature: 0.4,
    probeOk,
    note: reason,
  };
  recordEcymVersion(db, version);
  yield { stage: "done", status: probeOk ? "done" : "fail", version };
}

// ============ ROUTES ============

export function registerEcymRoutes(app: { get: Function; post: Function }, db: DBLike, guard: Guard): void {
  app.get("/api/ecym/status", guard, async (_req: Request, res: Response) => {
    res.json(await getEcymStatus(db));
  });

  app.get("/api/ecym/versions", guard, (_req: Request, res: Response) => {
    res.json((db.data.ecymVersions ?? []).slice().reverse());
  });

  app.post("/api/ecym/distill", guard, async (req: Request, res: Response) => {
    const target = String((req.body as { model?: unknown })?.model ?? "ecy:latest");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
      for await (const ev of distillEcym(db, target)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ stage: "error", status: "fail", text: (err as Error)?.message || "distill failed" })}\n\n`);
      res.end();
    }
  });
}
