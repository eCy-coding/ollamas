// Token counting + cost accounting (v1.19) — js-tiktoken (MIT) for accurate token
// counts (cloud providers + pre-call estimates that ollama's eval_count can't give)
// and a small, env-overridable cost table. Used by the count_tokens tool and to
// enrich usage metering.
import { getEncoding, encodingForModel, type Tiktoken, type TiktokenModel } from "js-tiktoken";

const encoders = new Map<string, Tiktoken>();

/** Count tokens in `text` using the model's encoding (falls back to cl100k_base). */
export function countTokens(text: string, model?: string): number {
  const key = model || "cl100k_base";
  let enc = encoders.get(key);
  if (!enc) {
    try {
      enc = model ? encodingForModel(model as TiktokenModel) : getEncoding("cl100k_base");
    } catch {
      enc = getEncoding("cl100k_base"); // unknown model → modern default encoding
    }
    encoders.set(key, enc);
  }
  return enc.encode(text || "").length;
}

// USD per 1K tokens {in, out}. Override/extend via OLLAMA_COST_TABLE (JSON).
// Local models are free; cloud rates are coarse defaults operators can tune.
const DEFAULT_COST: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "ollama-local": { in: 0, out: 0 },
};

function costTable(): Record<string, { in: number; out: number }> {
  try {
    const extra = JSON.parse(process.env.OLLAMA_COST_TABLE || "{}");
    return { ...DEFAULT_COST, ...extra };
  } catch {
    return DEFAULT_COST;
  }
}

/** Estimate USD cost for a call. Unknown model → 0 (treated as local/free). */
export function estimateCost(model: string, inTokens: number, outTokens: number): number {
  const rate = costTable()[model];
  if (!rate) return 0;
  return (inTokens / 1000) * rate.in + (outTokens / 1000) * rate.out;
}
