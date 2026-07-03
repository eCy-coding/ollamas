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
  /** Where the operator creates a key (guided KeyVault onboarding). */
  signupUrl: string;
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
    signupUrl: "https://console.groq.com/keys",
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
    signupUrl: "https://cloud.cerebras.ai",
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
    signupUrl: "https://z.ai/manage-apikey/apikey-list",
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
    signupUrl: "https://cloud.sambanova.ai/apis",
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
    signupUrl: "https://build.nvidia.com/settings/api-keys",
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
    signupUrl: "https://github.com/settings/personal-access-tokens",
    defaultModel: "openai/gpt-4o-mini",
    limits: { perMin: 10, perDay: 50 },
    trainsOnData: false,
    maxContext: 128_000,
    toolCalling: "probe",
    resetBoundary: "utc-midnight",
  },
  mistral: {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    signupUrl: "https://console.mistral.ai/api-keys",
    defaultModel: "mistral-small-latest",
    limits: { perMin: 30, perDay: 0 }, // Experiment tier ≈1B tok/mo; RPM unpublished — conservative
    // CAUTIOUS default: the free Experiment tier's terms have historically tied free usage to a
    // training opt-in (the paid API does NOT train). Verified-safe → flip to false with a source.
    trainsOnData: true,
    maxContext: 32_000,
    toolCalling: "probe",
    resetBoundary: "rolling",
  },
  cloudflare: {
    id: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    envKey: "CLOUDFLARE_API_TOKEN",
    signupUrl: "https://dash.cloudflare.com/profile/api-tokens",
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

// Legacy key pages, moved here from KeyVault.tsx so the guided-onboarding source of truth
// lives server-side with the catalog (the UI derives its rows from /api/keys/pool).
const LEGACY_SIGNUP: Record<string, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  openrouter: "https://openrouter.ai/keys",
  "ollama-cloud": "https://ollama.com/settings/keys",
};

const LEGACY_ENV_KEY: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "ollama-cloud": "OLLAMA_CLOUD_KEY",
};

/** Guided key page for ANY keyed provider (catalog or legacy); "" when unknown. */
export function keySignupUrl(provider: string): string {
  return PROVIDER_CATALOG[provider]?.signupUrl ?? LEGACY_SIGNUP[provider] ?? "";
}

/** Env var slot for ANY keyed provider (catalog or legacy); "" when unknown. */
export function envKeyFor(provider: string): string {
  return PROVIDER_CATALOG[provider]?.envKey ?? LEGACY_ENV_KEY[provider] ?? "";
}

// ── Capability model (T3-F1) — what each connected provider is GOOD FOR, so the
// orchestra can hand out roles automatically when a key goes live. Report-only surface:
// council/fleet seats stay key-gated prefer-lists; MODEL_SELECTION champions stay
// bench-driven. Capability vocabulary: code, fast, tools, long-ctx, stt, vision,
// embed, image, reasoning.

const CATALOG_CAPABILITIES: Record<string, readonly string[]> = {
  groq: ["code", "fast", "tools", "stt"],           // whisper STT rides the same key
  cerebras: ["code", "fast"],                        // 8K ctx cap → fast/short work
  zai: ["code", "long-ctx"],                         // glm-4.7-flash, 200K ctx
  sambanova: ["code"],
  "nvidia-nim": ["code", "vision"],
  "github-models": ["code", "tools"],
  cloudflare: ["code", "embed", "image"],
  mistral: ["code", "tools"],
};

const LEGACY_CAPABILITIES: Record<string, readonly string[]> = {
  gemini: ["code", "tools", "long-ctx", "vision", "embed"],
  anthropic: ["code", "tools", "reasoning", "long-ctx"],
  openai: ["code", "tools", "reasoning"],
  openrouter: ["code", "tools", "long-ctx"], // aggregator — capability of its :free pool
  "ollama-cloud": ["code", "long-ctx"],
};

export function capabilitiesFor(provider: string): readonly string[] {
  return CATALOG_CAPABILITIES[provider] ?? LEGACY_CAPABILITIES[provider] ?? [];
}

/** Invert ready providers into capability → providers (only capabilities actually live). */
export function capabilityReport(readyProviders: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of readyProviders ?? []) {
    for (const c of capabilitiesFor(p)) (out[c] ??= []).push(p);
  }
  return out;
}

// Council seat needs expressed as capability requirements (council-roster.ts semantics):
// cloud-alt = parallel cloud analyst seats, fast-verify = quick reviewer/verifier,
// adversarial = independent second-opinion. Report-only mapping.
const SEAT_NEEDS: Record<"cloud-alt" | "fast-verify" | "adversarial", readonly string[]> = {
  "cloud-alt": ["code"],
  "fast-verify": ["fast"],
  adversarial: ["reasoning", "code"], // any-of
};

/** Which ready providers could fill each council seat need (any-of capability match). */
export function suggestRoles(readyProviders: string[]): Record<"cloud-alt" | "fast-verify" | "adversarial", string[]> {
  const fill = (needs: readonly string[]) =>
    (readyProviders ?? []).filter((p) => capabilitiesFor(p).some((c) => needs.includes(c)));
  return {
    "cloud-alt": fill(SEAT_NEEDS["cloud-alt"]),
    "fast-verify": fill(SEAT_NEEDS["fast-verify"]),
    adversarial: fill(SEAT_NEEDS.adversarial),
  };
}

/** Parse a `provider::model` routed model string (same syntax as the council/fleet seats).
 *  Bare/malformed strings return {model} verbatim — callers keep their legacy behavior. */
export function parseProviderModel(s: string): { provider?: string; model: string } {
  const i = s.indexOf("::");
  if (i <= 0) return { model: s };
  const provider = s.slice(0, i);
  const model = s.slice(i + 2);
  if (!model) return { model: s };
  return { provider, model };
}
