// Colab-style ergonomic AI façade (v1.11) — mirrors `google.colab.ai`'s
// two-function surface (`list_models()` / `generate_text(prompt, ...)`) on top of
// the existing ProviderRouter. Single-string prompt, zero-config: when no model
// is given we auto-pick the first local ollama model. No new inference engine —
// the ProviderRouter fallback chain (ollama-local → … → demo) is preserved.

import { ProviderRouter, type GenerateConfig, type GenerateResult } from "./providers";

export type AiProvider = "ollama-local" | "gemini";

export interface AiOptions {
  /** Inference backend. Default "ollama-local" (Colab-faithful, zero-config). */
  provider?: AiProvider;
  /** Override the auto-selected model (e.g. "qwen3:8b" or "gemini-2.5-pro"). */
  model?: string;
  temperature?: number;
  /** Optional system instruction, prepended as a system message. */
  system?: string;
}

const ollamaHost = () => process.env.OLLAMA_HOST || "http://localhost:11434";

// Gemini default — used when provider is "gemini" and no model is given. Matches
// the ProviderRouter "gemini" case default (server/providers.ts).
const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash";
// Best local coder on M4 per orchestration vO6 benchmark — preferred local
// fallback for code tasks when Gemini is unavailable.
export const LOCAL_CODER_HINT = "coder";

// Default-model resolution is cached briefly so back-to-back calls don't hammer
// /api/tags on every request.
let defaultModelCache: { model: string; at: number } | null = null;
const DEFAULT_MODEL_TTL_MS = 30_000;

/** Reset the default-model cache. Internal — for deterministic tests. */
export function _resetDefaultModelCache(): void {
  defaultModelCache = null;
}

/** Flat list of available local ollama model names (Colab `list_models()`). */
export async function listModels(): Promise<string[]> {
  // .env OLLAMA_HOST is often a docker value (host.docker.internal:11434) unreachable
  // from a local boot — probe [configured, 127.0.0.1, localhost] like ProviderRouter's
  // ollama-local case (providers.ts) so /api/ai/models works in docker AND local.
  const bases = [...new Set([ollamaHost(), "http://127.0.0.1:11434", "http://localhost:11434"])];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) continue;
      const data: any = await res.json();
      return (data.models || []).map((m: any) => m.name);
    } catch { /* unreachable base — try next */ }
  }
  return [];
}

/** Prefer a coder-tuned local model (qwen3-coder per orchestration vO6 M4 benchmark). */
export async function resolveLocalCoder(): Promise<string> {
  const models = await listModels();
  if (!models.length) throw new Error("no local ollama model available");
  return models.find((m) => m.includes(LOCAL_CODER_HINT)) ?? models[0];
}

/** Auto-pick the first local ollama model. Throws if none are installed. */
export async function resolveDefaultModel(): Promise<string> {
  if (defaultModelCache && Date.now() - defaultModelCache.at < DEFAULT_MODEL_TTL_MS) {
    return defaultModelCache.model;
  }
  const models = await listModels();
  if (!models.length) throw new Error("no local ollama model available");
  defaultModelCache = { model: models[0], at: Date.now() };
  return models[0];
}

/** Resolve {provider, model} from opts: explicit wins, else provider-aware default. */
async function resolveTarget(opts: AiOptions): Promise<{ provider: AiProvider; model: string }> {
  const provider = opts.provider ?? "ollama-local";
  if (opts.model) return { provider, model: opts.model };
  if (provider === "gemini") return { provider, model: GEMINI_DEFAULT_MODEL };
  return { provider, model: await resolveDefaultModel() };
}

function buildMessages(prompt: string, system?: string): GenerateConfig["messages"] {
  const messages: GenerateConfig["messages"] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  return messages;
}

/** Lower-level: full GenerateResult (text + source + tokensPerSec) for one prompt. */
export async function generate(prompt: string, opts: AiOptions = {}): Promise<GenerateResult> {
  const { provider, model } = await resolveTarget(opts);
  const config: GenerateConfig = {
    provider,
    model,
    messages: buildMessages(prompt, opts.system),
    temperature: opts.temperature,
  };
  return ProviderRouter.generate(config);
}

/** Generate text from a single prompt string (Colab `generate_text(prompt)`). */
export async function generateText(prompt: string, opts: AiOptions = {}): Promise<string> {
  return (await generate(prompt, opts)).text;
}

/**
 * Streaming variant (Colab `generate_text(..., stream=True)`). Bridges
 * ProviderRouter's chunk callback into an AsyncGenerator: chunks are queued as
 * they arrive and yielded in order; the generator ends when generate() settles
 * and re-throws any provider error.
 */
export async function* generateTextStream(prompt: string, opts: AiOptions = {}): AsyncGenerator<string> {
  const { provider, model } = await resolveTarget(opts);
  const config: GenerateConfig = {
    provider,
    model,
    messages: buildMessages(prompt, opts.system),
    temperature: opts.temperature,
    stream: true,
  };

  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let error: unknown = null;
  const wake = () => {
    const r = resolveNext;
    resolveNext = null;
    r?.();
  };

  const done = ProviderRouter.generate(config, (chunk) => {
    queue.push(chunk);
    wake();
  })
    .then(() => {
      finished = true;
      wake();
    })
    .catch((e) => {
      error = e;
      finished = true;
      wake();
    });

  while (true) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    if (finished) break;
    await new Promise<void>((r) => {
      resolveNext = r;
    });
  }

  await done;
  if (error) throw error;
}

// ── Engine selection (benchmark-driven) ──────────────────────────────────────

/** True when a Gemini API key is configured (vault or GEMINI_API_KEY env). */
export function hasGeminiKey(): boolean {
  try {
    return !!ProviderRouter.getDecryptedKey("gemini");
  } catch {
    return false;
  }
}

/**
 * Pick the best engine for a task class. Code analysis/triage prefers Gemini
 * (stronger reasoning, zero local cost). Without a Gemini key it falls back to a
 * local coder-tuned model (qwen3-coder per orchestration vO6 M4 benchmark) or the
 * first installed model. Returned shape feeds straight into generate()/opts.
 */
export async function pickEngine(task: "code" | "chat" = "code"): Promise<{ provider: AiProvider; model: string }> {
  if (task === "code" && hasGeminiKey()) {
    return { provider: "gemini", model: GEMINI_DEFAULT_MODEL };
  }
  const models = await listModels();
  if (!models.length) throw new Error("no local model and no Gemini key available");
  const model = task === "code" ? (models.find((m) => m.includes(LOCAL_CODER_HINT)) ?? models[0]) : models[0];
  return { provider: "ollama-local", model };
}
