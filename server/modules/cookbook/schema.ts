// O7 cookbook module — wire types + input validation (honest 400/422 before any
// work). Mirrors server/modules/demo/schema.ts. Types are shared with the
// frontend CookbookPanel via the /api/modules/cookbook/* JSON payloads.

export type RamClass = "8-16" | "18-24" | "32-48" | "64+";
export type FitBadge = "fit" | "tight" | "wont";
export type Tier = "excellent" | "good" | "tight" | "wont";

export interface HardwareInfo {
  arch: string;
  platform: string;
  ramGb: number;
  usableGb: number; // ramGb * FIT_RATIO — the single "free for inference" number (K5)
  cores: number;
  chip: string;
  metal: boolean;
  memType: string;
  accelLabel: string;
  name: string;
  sub: string;
}

/** A structured tok/s measurement — only ever produced by a real bench run. */
export interface BenchResult {
  tps: number;
  pp_tps?: number;
  runs: number;
  model?: string;
  measured: true;
}

export interface ScoredModel {
  id: string;
  family: string;
  letter: string;
  color: string;
  role: string;
  params: number;
  size: number; // download size GB
  footprint: number; // resident GB
  quant: string;
  ctx: number;
  ctxMax: number;
  quality: number;
  layers: string;
  // derived, hardware-aware
  fit: number; // 0..100
  tier: Tier;
  badge: FitBadge; // ✓ / ⚠ / ✗ single source
  fits: boolean;
  headroom: number;
  headroomLabel: string;
  installed: boolean;
  reason: string;
  why: string;
  sizeLabel: string;
  config: { numCtx: number; keepAlive: string };
  estTokS?: number; // ONLY set when a bench measurement exists (honest)
  measured?: boolean;
}

export interface Recommendation {
  hardware: HardwareInfo;
  ruleClass: RamClass;
  primary: ScoredModel;
  alternatives: ScoredModel[];
  fallback: ScoredModel | null;
}

/** Ollama model tags are `[namespace/]name[:tag]` — allow only that alphabet so a
 *  name can never smuggle shell metacharacters, a URL (SSRF), or log-injection. */
const MODEL_NAME_RE = /^[a-zA-Z0-9._:/-]+$/;

export function sanitizeModelName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  // Reject `//` / `://` outright: a real ollama tag is `[namespace/]name[:tag]`
  // with single slashes only — `//` means a URL was smuggled in (SSRF shape).
  if (!name || name.includes("//") || !MODEL_NAME_RE.test(name)) {
    throw new Error("invalid model name (allowed: letters, digits, . _ : / -; no URLs)");
  }
  return name;
}

/** Validate a POST /bench body. Requires a model reference (tag or .gguf path). */
export function parseBenchInput(body: unknown): { model: string; n_tokens?: number } {
  const model = (body as { model?: unknown })?.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("field 'model' must be a non-empty string");
  }
  const n = Number((body as { n_tokens?: unknown })?.n_tokens);
  return { model: model.trim(), ...(Number.isFinite(n) && n > 0 ? { n_tokens: Math.floor(n) } : {}) };
}
