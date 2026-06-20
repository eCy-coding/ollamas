// Colab-style ergonomic AI façade (v1.11) — mirrors `google.colab.ai`'s
// two-function surface (`list_models()` / `generate_text(prompt, ...)`) on top of
// the existing ProviderRouter. Single-string prompt, zero-config: when no model
// is given we auto-pick the first local ollama model. No new inference engine —
// the ProviderRouter fallback chain (ollama-local → … → demo) is preserved.

import { ProviderRouter, type GenerateConfig, type GenerateResult } from "./providers";

export interface AiOptions {
  /** Override the auto-selected local model (e.g. "qwen3:8b"). */
  model?: string;
  temperature?: number;
}

const ollamaHost = () => process.env.OLLAMA_HOST || "http://localhost:11434";

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
  const res = await fetch(`${ollamaHost()}/api/tags`);
  if (!res.ok) return [];
  const data: any = await res.json();
  return (data.models || []).map((m: any) => m.name);
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

/** Lower-level: full GenerateResult (text + source + tokensPerSec) for one prompt. */
export async function generate(prompt: string, opts: AiOptions = {}): Promise<GenerateResult> {
  const model = opts.model ?? (await resolveDefaultModel());
  const config: GenerateConfig = {
    provider: "ollama-local",
    model,
    messages: [{ role: "user", content: prompt }],
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
  const model = opts.model ?? (await resolveDefaultModel());
  const config: GenerateConfig = {
    provider: "ollama-local",
    model,
    messages: [{ role: "user", content: prompt }],
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
