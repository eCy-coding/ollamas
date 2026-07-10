// O7 cookbook service — hardware-aware, rule-based local-model recommendation.
// REUSE, not rebuild (docs/odyssey/05-features/cookbook.md §1.1):
//   - parseSysctl / optimalConfig / modelVramGb from orchestration/bin/lib/optimize.ts
//   - sanitizeModelOverride from server/model-overrides.ts (the config bridge)
//   - bench flows through ToolRegistry.execute (the choke-point) — never execOnHost.
// No ML: a deterministic weighted score (memory headroom + quality). tok/s is
// NEVER fabricated — estTokS appears only when a real bench measurement exists.
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  parseSysctl,
  optimalConfig,
  modelVramGb,
} from "../../../orchestration/bin/lib/optimize";
import { sanitizeModelOverride, type ModelOverride } from "../../model-overrides";
import {
  type HardwareInfo,
  type RamClass,
  type FitBadge,
  type Tier,
  type ScoredModel,
  type Recommendation,
  type BenchResult,
} from "./schema";

export { sanitizeModelName, parseBenchInput } from "./schema";

/** Single fit-ratio source (K5): usable = ramGb × FIT_RATIO. Chosen 0.7 to match
 *  docs/model-guide.md ("size ≤ total × 0.7") and cockpit rankMacModels. */
export const FIT_RATIO = 0.7;

/** RAM class → example models, pinned to docs/model-guide.md "Quick pick" table.
 *  Changing the table is a deliberate change to this constant (docs-pin, K9). */
export const RAM_CLASS_MODELS: Record<RamClass, string[]> = {
  "8-16": ["qwen3:4b", "llama3.2:3b"],
  "18-24": ["qwen3:8b"],
  "32-48": ["qwen3-coder:30b", "deepseek-r1:32b"],
  "64+": ["llama3.3:70b"],
};

/** The scored catalog — mirrors docs/odyssey/handoff/cookbook/design.html models[]
 *  (params / size / footprint / quant / ctx / quality / layers). */
interface CatalogModel {
  id: string;
  family: string;
  letter: string;
  color: string;
  role: string;
  params: number;
  size: number;
  footprint: number;
  quant: string;
  ctx: number;
  ctxMax: number;
  quality: number;
  layers: string;
}

const CATALOG: CatalogModel[] = [
  { id: "qwen3:8b", family: "Qwen3", letter: "Q", color: "#00D4FF", role: "General reasoning + tool use", params: 8.2, size: 5.2, footprint: 6.6, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 4.5, layers: "33/33" },
  { id: "qwen3:4b", family: "Qwen3", letter: "Q", color: "#00D4FF", role: "Fast drafts, routing, autocomplete", params: 4.0, size: 2.6, footprint: 3.6, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 3.8, layers: "37/37" },
  { id: "qwen3:14b", family: "Qwen3", letter: "Q", color: "#00D4FF", role: "Deeper reasoning, long context", params: 14.8, size: 9.3, footprint: 11.0, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 4.7, layers: "41/41" },
  { id: "qwen3:32b", family: "Qwen3", letter: "Q", color: "#00D4FF", role: "Frontier-class, near-cloud quality", params: 32.8, size: 20.0, footprint: 22.5, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 5.0, layers: "65/65" },
  { id: "llama3.1:8b", family: "Llama 3.1", letter: "L", color: "#9B80CC", role: "Broad ecosystem + fine-tunes", params: 8.0, size: 4.9, footprint: 6.3, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 4.1, layers: "33/33" },
  { id: "deepseek-r1:8b", family: "DeepSeek R1", letter: "D", color: "#00C896", role: "Explicit chain-of-thought", params: 8.0, size: 5.2, footprint: 6.8, quant: "Q4_K_M", ctx: 32, ctxMax: 64, quality: 4.35, layers: "33/33" },
  { id: "qwen2.5-coder:7b", family: "Qwen2.5", letter: "Q", color: "#00D4FF", role: "Code completion + repo edits", params: 7.6, size: 4.7, footprint: 6.1, quant: "Q4_K_M", ctx: 32, ctxMax: 128, quality: 4.2, layers: "29/29" },
];

const CHAMPION = "qwen3:8b";

// ── Hardware detection ───────────────────────────────────────────────────────

/** Injectable probe seam (test-without-os, mirrors demo's _setDemoEmbedder). */
export interface HardwareProbe {
  totalmem: () => number;
  platform: () => string;
  arch: () => string;
  cpus: () => unknown[];
  /** sysctl enrichment; may throw → caller falls back gracefully (P1). */
  sysctl?: () => { memBytes: string; physCpu: string; brand: string };
}

const realProbe: HardwareProbe = {
  totalmem: () => os.totalmem(),
  platform: () => os.platform(),
  arch: () => os.arch(),
  cpus: () => os.cpus(),
  sysctl: () => {
    // Live sysctl (macOS): enrich chip name. Wrapped by detectHardware in try/catch.
    const read = (k: string) => execFileSync("sysctl", ["-n", k], { encoding: "utf8", timeout: 2000 }).trim();
    return { memBytes: read("hw.memsize"), physCpu: read("hw.physicalcpu"), brand: read("machdep.cpu.brand_string") };
  },
};

export function detectHardware(probe: HardwareProbe = realProbe): HardwareInfo {
  const arch = probe.arch();
  const platform = probe.platform();
  const ramGb = Math.round(probe.totalmem() / 1e9);
  const cores = probe.cpus().length;
  const metal = arch === "arm64" && platform === "darwin";

  let chip = metal ? "Apple Silicon" : `${arch} CPU`;
  try {
    if (probe.sysctl) {
      const s = probe.sysctl();
      const sys = parseSysctl(s.memBytes, s.physCpu, s.brand);
      if (sys.chip && sys.chip !== "?") chip = sys.chip;
    }
  } catch {
    // sysctl unavailable (non-macOS, sandbox) → keep the os.* fallback, never throw.
  }

  const usableGb = Math.round(ramGb * FIT_RATIO * 10) / 10;
  const memType = metal ? "Unified memory" : "System RAM";
  const accelLabel = metal ? "Metal · unified memory" : `${cores}-core CPU`;
  return {
    arch, platform, ramGb, usableGb, cores, chip, metal, memType, accelLabel,
    name: chip,
    sub: `${ramGb} GB · ${cores}-core`,
  };
}

// ── Rule base (pinned to model-guide.md) ─────────────────────────────────────

export function classifyRam(ramGb: number): RamClass {
  if (ramGb <= 16) return "8-16";
  if (ramGb <= 24) return "18-24";
  if (ramGb <= 48) return "32-48";
  return "64+";
}

/** ✓/⚠/✗ from the single FIT_RATIO source (K5). */
export function fitBadge(model: string, ramGb: number): FitBadge {
  const usable = ramGb * FIT_RATIO;
  const footprint = modelFootprint(model);
  if (footprint > usable) return "wont";
  const headroom = usable - footprint;
  return headroom <= usable * 0.15 ? "tight" : "fit";
}

/** Resident footprint GB. Catalog value when known, else optimize.modelVramGb + ~25%
 *  runtime overhead (kv-cache/context) so estimates stay conservative. */
function modelFootprint(id: string): number {
  const cat = CATALOG.find((m) => m.id === id);
  if (cat) return cat.footprint;
  return Math.round(modelVramGb(id) * 1.25 * 10) / 10;
}

// ── Scoring (deterministic, honest — no fabricated tok/s) ────────────────────

function score(m: CatalogModel, usableGb: number): { fit: number; tier: Tier; fits: boolean; headroom: number } {
  const headroom = Math.round((usableGb - m.footprint) * 10) / 10;
  const fits = headroom >= 0;
  let mem: number;
  if (fits) mem = Math.min(100, 60 + (headroom / usableGb) * 80);
  else mem = Math.max(3, Math.min(55, 45 + headroom * 7));
  const qual = (m.quality / 5) * 100;
  let fit = mem * 0.55 + qual * 0.45;
  if (!fits) fit = Math.min(fit, mem); // a model that won't fit can never score high
  fit = Math.round(Math.max(3, Math.min(99, fit)));
  const tier: Tier = !fits ? "wont" : fit >= 85 ? "excellent" : fit >= 72 ? "good" : "tight";
  return { fit, tier, fits, headroom };
}

const TIER_LABEL: Record<Tier, string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  tight: "Tight fit",
  wont: "Won't fit",
};

function decorate(
  m: CatalogModel,
  hw: HardwareInfo,
  installed: Set<string>,
  bench?: Record<string, { tps: number; runs: number; pp_tps?: number }>,
): ScoredModel {
  const sc = score(m, hw.usableGb);
  const badge: FitBadge = sc.tier === "wont" ? "wont" : sc.tier === "tight" ? "tight" : "fit";
  const cfg = configFor(hw, m.id);
  const b = bench?.[m.id];
  const measured = !!b && b.tps > 0;
  const headroomLabel = sc.fits
    ? `+${sc.headroom.toFixed(1)} GB free`
    : `${(m.footprint - hw.usableGb).toFixed(1)} GB short`;
  return {
    ...m,
    fit: sc.fit,
    tier: sc.tier,
    badge,
    fits: sc.fits,
    headroom: sc.headroom,
    headroomLabel,
    installed: installed.has(m.id),
    reason: reasonFor(m, hw, sc),
    why: whyPrimary(m, hw, sc),
    sizeLabel: (m.size % 1 ? m.size.toFixed(1) : String(m.size)) + " GB",
    config: { numCtx: cfg?.numCtx ?? 0, keepAlive: cfg?.keepAlive ?? "30m" },
    ...(measured ? { estTokS: b!.tps, measured: true } : {}),
  };
}

function reasonFor(m: CatalogModel, hw: HardwareInfo, sc: { fits: boolean; headroom: number }): string {
  if (!sc.fits) {
    const short = (m.footprint - hw.usableGb).toFixed(1);
    return `Needs ~${m.footprint} GB, only ${hw.usableGb} GB free — ${short} GB short. Would page to disk and crawl.`;
  }
  return `Fits with ${sc.headroom.toFixed(1)} GB to spare on ${hw.name}. Quant ${m.quant}, ${m.params}B params.`;
}

function whyPrimary(m: CatalogModel, hw: HardwareInfo, sc: { fits: boolean; headroom: number }): string {
  if (!sc.fits) {
    return `qwen3:8b needs about ${m.footprint} GB and ${hw.name} only frees ${hw.usableGb} GB — it would swap to disk. Pick a smaller model in the same family that is built to fit.`;
  }
  return `The efficient-yet-correct default for ${hw.name}: large enough for tools, code, and multi-step reasoning, small enough to stay responsive with ${sc.headroom.toFixed(0)} GB of headroom. 100% on-device — no data leaves the machine, $0 per token.`;
}

export function recommend(
  hw: HardwareInfo,
  installed: string[] = [],
  bench?: Record<string, { tps: number; runs: number; pp_tps?: number }>,
): Recommendation {
  const set = new Set(installed);
  const scored = CATALOG.map((m) => decorate(m, hw, set, bench));
  const primary = scored.find((x) => x.id === CHAMPION)!;
  const alternatives = scored
    .filter((x) => x.id !== CHAMPION)
    .sort((a, b) => b.fit - a.fit);
  const fallback = alternatives.filter((x) => x.fits).sort((a, b) => b.fit - a.fit)[0] ?? null;
  return { hardware: hw, ruleClass: classifyRam(hw.ramGb), primary, alternatives, fallback };
}

// ── Bench bridge (choke-point only) ──────────────────────────────────────────

type Execute = (name: string, args: unknown, ctx: unknown) => Promise<{ ok: boolean; output: unknown }>;

export interface BenchDeps {
  execute: Execute;
  /** Host deps handed to the bench_model tool (execOnHost/shArg). Route supplies real ones. */
  hostDeps?: unknown;
}

/** A .gguf ABSOLUTE path is required (K3): ollama-managed tags have no user-facing
 *  blob path, so we return 422 rather than guess a sha256 blob or fake a tps. */
function isGgufPath(model: string): boolean {
  return model.toLowerCase().endsWith(".gguf") && model.startsWith("/");
}

export async function benchModel(
  input: { model: string; n_tokens?: number },
  deps: BenchDeps,
): Promise<{ ok: true; result: BenchResult } | { ok: false; status: number; error: string }> {
  if (!isGgufPath(input.model)) {
    return {
      ok: false,
      status: 422,
      error:
        "bench needs an absolute .gguf path (ollama-managed models expose no user path — see docs/custom-model.md).",
    };
  }
  const ctx = { isLive: true, workspaceRoot: process.cwd(), autoApply: false, deps: deps.hostDeps ?? {} };
  // THE only dispatch path: ToolRegistry.execute (metering/audit/tier gate free).
  const r = await deps.execute("bench_model", { model: input.model, n_tokens: input.n_tokens }, ctx);
  if (!r.ok) return { ok: false, status: 500, error: "bench_model failed via the tool registry." };
  const out = (r.output ?? {}) as { tps?: number; pp_tps?: number; model?: string; runs?: number };
  if (typeof out.tps !== "number") {
    return { ok: false, status: 500, error: "bench_model returned no tps." };
  }
  return {
    ok: true,
    result: { tps: out.tps, pp_tps: out.pp_tps, runs: out.runs ?? 0, model: out.model ?? input.model, measured: true },
  };
}

// ── Config bridge (optimize.optimalConfig → ModelOverride) ────────────────────

/** Map optimize.optimalConfig → the per-model override shape, through the SAME
 *  sanitize the /api/model-overrides route uses. num_gpu/num_thread are out of the
 *  ModelOverride schema (K6) → applied only in Modelfile guidance, not here. */
export function configFor(hw: HardwareInfo, model: string): ModelOverride | null {
  const cfg = optimalConfig(hw.ramGb, hw.cores, model);
  return sanitizeModelOverride({ numCtx: cfg.num_ctx, keepAlive: cfg.keep_alive });
}
