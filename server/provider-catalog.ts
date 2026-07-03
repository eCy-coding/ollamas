// server/provider-catalog.ts — free-tier cloud provider catalog (pure data, zero-dep).
// Every entry is an OpenAI-compatible endpoint reached via fetch — NO provider SDKs, so
// nothing here needs an adopt-gate row. Adding a provider = adding an entry; the router
// (providers.ts) drives all catalog providers through the shared openai-compat path.
// Limits are best-effort free-tier defaults (July 2026, from official docs) — the reactive
// 429 cooldown remains the backstop, and `KEY_LIMIT_*` env overrides (key-limits.ts) win.

export interface CatalogEntry {
  id: string;
  /** OpenAI-compat base URL. May contain `{account_id}` (cloudflare) — resolve via catalogBaseUrl. */
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  limits: { perMin: number; perDay: number; tokensPerDay?: number }; // 0 = unknown/unlimited
  /** Free tier trains on your prompts → excluded when privateMode is requested. */
  trainsOnData: boolean;
  /** Hard context cap on the FREE tier (tokens) — router skips when the prompt won't fit. */
  maxContext: number;
  /** Tool-calling support: native = documented, probe = verify once + cache, none = never. */
  toolCalling: "native" | "probe" | "none";
  /** Daily-quota reset semantics (persisted quota windows, quota-persist.ts). */
  resetBoundary?: "rolling" | "utc-midnight" | "pt-midnight";
}

export const PROVIDER_CATALOG: Record<string, CatalogEntry> = {
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    limits: { perMin: 30, perDay: 1000, tokensPerDay: 500_000 },
    trainsOnData: false,
    maxContext: 131_072,
    toolCalling: "native",
    resetBoundary: "rolling",
  },
  cerebras: {
    id: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    defaultModel: "gpt-oss-120b",
    limits: { perMin: 30, perDay: 14_400, tokensPerDay: 1_000_000 },
    trainsOnData: false,
    maxContext: 8192, // free-tier hard cap — long-context work must route elsewhere
    toolCalling: "probe",
    resetBoundary: "rolling",
  },
  zai: {
    id: "zai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    envKey: "ZAI_API_KEY",
    defaultModel: "glm-4.7-flash",
    limits: { perMin: 10, perDay: 0 }, // free tier is concurrency-limited (≈1), not RPD-published
    trainsOnData: false,
    maxContext: 200_000,
    toolCalling: "probe",
    resetBoundary: "rolling",
  },
  sambanova: {
    id: "sambanova",
    baseUrl: "https://api.sambanova.ai/v1",
    envKey: "SAMBANOVA_API_KEY",
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    limits: { perMin: 20, perDay: 0 },
    trainsOnData: false,
    maxContext: 16_384,
    toolCalling: "probe",
    resetBoundary: "rolling",
  },
  "nvidia-nim": {
    id: "nvidia-nim",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
    defaultModel: "meta/llama-3.3-70b-instruct",
    limits: { perMin: 40, perDay: 0 },
    trainsOnData: false,
    maxContext: 128_000,
    toolCalling: "probe",
    resetBoundary: "rolling",
  },
  "github-models": {
    id: "github-models",
    baseUrl: "https://models.github.ai/inference",
    envKey: "GITHUB_MODELS_TOKEN",
    defaultModel: "openai/gpt-4o-mini",
    limits: { perMin: 10, perDay: 50 },
    trainsOnData: false,
    maxContext: 128_000,
    toolCalling: "probe",
    resetBoundary: "utc-midnight",
  },
  cloudflare: {
    id: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    envKey: "CLOUDFLARE_API_TOKEN",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    limits: { perMin: 20, perDay: 300 }, // 10K neurons/day ≈ a few hundred chat calls — conservative
    trainsOnData: false,
    maxContext: 24_000,
    toolCalling: "probe",
    resetBoundary: "utc-midnight",
  },
};

export function catalogEntry(provider: string): CatalogEntry | undefined {
  return PROVIDER_CATALOG[provider];
}

/** Resolve the entry's base URL; cloudflare needs CLOUDFLARE_ACCOUNT_ID composed into the path.
 *  Missing account id → "" so the caller raises an honest config error instead of a bogus fetch. */
export function catalogBaseUrl(provider: string, env: NodeJS.ProcessEnv = process.env): string {
  const e = PROVIDER_CATALOG[provider];
  if (!e) return "";
  if (!e.baseUrl.includes("{account_id}")) return e.baseUrl;
  const acct = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  return acct ? e.baseUrl.replace("{account_id}", acct) : "";
}

// The five legacy keyed cloud providers hardcoded across server.ts before the catalog existed.
// Kept FIRST and in their historical order so every existing UI/SSE consumer sees a stable prefix.
const LEGACY_KEYED = ["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"];

/** Every keyed cloud provider: legacy five + catalog ids. Single source for server.ts lists. */
export function keyedCloudProviders(): string[] {
  return [...LEGACY_KEYED, ...Object.keys(PROVIDER_CATALOG)];
}

// Legacy providers whose FREE tier trains on user prompts (paid tiers differ; we flag the
// free tier honestly). Catalog providers carry their own flag.
const LEGACY_TRAINS_ON_DATA: Record<string, boolean> = {
  gemini: true, // AI Studio free tier: prompts+responses used for training (outside EU/UK/EEA)
  "gemini-cli": true, // same Gemini free-tier data policy via OAuth
};

/** privateMode filter input: does this provider's free tier train on prompts? Unknown → false. */
export function trainsOnData(provider: string): boolean {
  const e = PROVIDER_CATALOG[provider];
  if (e) return e.trainsOnData;
  return LEGACY_TRAINS_ON_DATA[provider] ?? false;
}
