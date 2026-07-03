// server/key-doctor.ts — zero/minimum-manual key connection: DISCOVER candidate API keys
// already on this machine (env / macOS keychain / gh CLI), VALIDATE them against the real
// provider (testKeyOverride + singleAttempt semantics), CONNECT the valid ones to the
// encrypted vault, and REPORT what each connection unlocked (capability → orchestra role).
//
// SECURITY invariants: raw key values live ONLY in the `key` field consumed by
// validation/vault code paths — every report-facing field carries maskKey(); nothing here
// logs a value; keychain access is read-only over KNOWN service names.
import { keyedCloudProviders, envKeyFor, capabilitiesFor, capabilityReport, suggestRoles, keySignupUrl, catalogEntry } from "./provider-catalog";
import { EMBED_CATALOG, buildEmbedRequest } from "./embed-catalog";
import { ProviderRouter } from "./providers";
import { db } from "./db";
import { keyId } from "./key-usage";
import { readGenericPassword, keychainAvailable } from "./lib/keychain-scan";
import { execFileSync } from "node:child_process";

export type CandidateSource = "env" | "keychain" | "gh" | "vault";

export interface Candidate {
  provider: string;
  source: CandidateSource;
  /** RAW value — consumed by validate/connect only; never serialized into reports. */
  key: string;
  keyMasked: string;
  envName: string;
}

export interface SourceReaders {
  /** name → value for every discovery target env name (process.env slice). */
  env(): Record<string, string>;
  /** service name → secret for the given known service names (macOS keychain). */
  keychain(names: string[]): Record<string, string>;
  /** gh CLI OAuth token, or null when gh is absent/unauthenticated. */
  gh(): string | null;
}

export function maskKey(key: string): string {
  return `…${key.slice(-4)}`;
}

export interface DiscoveryTarget { provider: string; envName: string }

/** The full scan surface: every keyed chat provider's env name + rotation suffixes
 *  (NAME, NAME_1..9, NAMES — mirrors providers.ts keyPool) + embed/search modality keys. */
export function discoveryTargets(): DiscoveryTarget[] {
  const out: DiscoveryTarget[] = [];
  const push = (provider: string, base: string) => {
    if (!base) return;
    out.push({ provider, envName: base });
    for (let i = 1; i <= 9; i++) out.push({ provider, envName: `${base}_${i}` });
    out.push({ provider, envName: `${base}S` });
  };
  for (const p of keyedCloudProviders()) push(p, envKeyFor(p));
  for (const e of Object.values(EMBED_CATALOG)) {
    // gemini/cloudflare embed reuse chat keys already covered above
    if (!out.some((t) => t.envName === e.envKey)) push(e.id === "voyage" || e.id === "jina" ? e.id : e.id, e.envKey);
  }
  push("tavily", "TAVILY_API_KEY");
  return out;
}

const SOURCE_ORDER: CandidateSource[] = ["env", "keychain", "gh"];

/** Merge candidates from every reader. Pure given the injected readers. Precedence
 *  env > keychain > gh; identical values (keyId) collapse into the strongest source. */
export function discoverCandidates(readers: SourceReaders, targets: DiscoveryTarget[] = discoveryTargets()): Candidate[] {
  const byId = new Map<string, Candidate>(); // keyId(provider::value) → candidate
  const add = (provider: string, envName: string, source: CandidateSource, value: string | undefined | null) => {
    const key = (value ?? "").trim();
    if (!key) return;
    const id = `${provider}::${keyId(key)}`;
    const existing = byId.get(id);
    if (existing && SOURCE_ORDER.indexOf(existing.source) <= SOURCE_ORDER.indexOf(source)) return;
    byId.set(id, { provider, source, key, keyMasked: maskKey(key), envName });
  };

  const env = readers.env();
  for (const t of targets) {
    const v = env[t.envName];
    if (!v) continue;
    // NAMES (csv) may hold several keys — each joins as its own candidate.
    if (t.envName.endsWith("S") && v.includes(",")) v.split(",").forEach((k) => add(t.provider, t.envName, "env", k));
    else add(t.provider, t.envName, "env", v);
  }

  const kc = readers.keychain(targets.map((t) => t.envName));
  for (const t of targets) add(t.provider, t.envName, "keychain", kc[t.envName]);

  const ghTok = readers.gh();
  if (ghTok) add("github-models", "GITHUB_MODELS_TOKEN", "gh", ghTok);

  // Stable order: provider, then source precedence.
  return [...byId.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
}

// ── Default (production) source readers — thin IO, injectable in tests ────────────────
export function defaultReaders(sources: CandidateSource[]): SourceReaders {
  const want = new Set(sources);
  return {
    env: () => (want.has("env") ? { ...(process.env as Record<string, string>) } : {}),
    keychain: (names) => {
      if (!want.has("keychain") || !keychainAvailable()) return {};
      const out: Record<string, string> = {};
      // Base names only (~13 lookups) — rotation suffixes in the keychain are unlikely and
      // each miss can raise a macOS prompt; keep the surface tight.
      for (const n of names.filter((x) => !/_\d$|S$/.test(x))) {
        const v = readGenericPassword(n);
        if (v) out[n] = v;
      }
      return out;
    },
    gh: () => {
      if (!want.has("gh")) return null;
      try {
        return execFileSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
      } catch { return null; }
    },
  };
}

// ── Validation + connection (T3-F3) ───────────────────────────────────────────────────

export type CandidateStatus = "connected" | "already" | "invalid" | "connected-unverified" | "absent";

export interface DoctorDeps {
  /** Chat validation: /api/keys/test semantics in-process. Throws on failure. */
  chatValidate(provider: string, key: string): Promise<void>;
  /** Modality validators (embed/tavily): one cheap real request. Throws on failure. */
  embedValidate(providerId: string, key: string): Promise<void>;
  tavilyValidate(key: string): Promise<void>;
  vault: {
    hasPrimary(provider: string): boolean;
    knownKeyIds(provider: string): Set<string>;
    savePrimary(provider: string, key: string): void;
    addToPool(provider: string, key: string): void;
  };
}

export interface ProviderVerdict {
  status: CandidateStatus;
  source?: CandidateSource;
  keyMasked?: string;
  capabilitiesActivated: readonly string[];
  nextManualUrl?: string;
  note?: string;
}

export interface DoctorReport {
  providers: Record<string, ProviderVerdict>;
  capabilityReport: Record<string, string[]>;
  roleSuggestions: Record<"cloud-alt" | "fast-verify" | "adversarial", string[]>;
  dryRun: boolean;
}

const GH_REFRESH_CMD = "gh auth refresh -h github.com -s models:read";

/** Production deps: chat validation = /api/keys/test semantics IN-PROCESS
 *  (testKeyOverride + singleAttempt, finally-reset); embed/tavily = one cheap real call;
 *  vault = encrypted db (primary/pool), with knownKeyIds spanning the WHOLE active pool
 *  (vault + env) so an env-sourced key honestly reports "already" instead of re-saving. */
export function productionDoctorDeps(): DoctorDeps {
  return {
    async chatValidate(provider, key) {
      ProviderRouter.testKeyOverride = { provider, key };
      try {
        await ProviderRouter.generate({
          provider, model: "",
          messages: [{ role: "user", content: "ping test" }],
          singleAttempt: true,
        });
      } finally {
        ProviderRouter.testKeyOverride = null;
      }
    },
    async embedValidate(providerId, key) {
      const entry = EMBED_CATALOG[providerId];
      if (!entry) throw new Error(`unknown embed provider ${providerId}`);
      const req = buildEmbedRequest(entry, ["ping"], key);
      const r = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`${providerId} embeddings error ${r.status}`);
    },
    async tavilyValidate(key) {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: "ping", max_results: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`tavily error ${r.status}`);
    },
    vault: {
      hasPrimary: (p) => !!db.data.keys?.[p],
      knownKeyIds: (p) => new Set(ProviderRouter.keyPool(p).map((k) => keyId(k))),
      savePrimary: (p, key) => { db.data.keys[p] = db.encrypt(key); db.save(); },
      addToPool: (p, key) => {
        const pool = ((db.data as any).keyPool ??= {});
        (pool[p] ??= []).push(db.encrypt(key));
        db.save();
      },
    },
  };
}

function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("quota") || m.includes("rate limit");
}

async function validateCandidate(c: Candidate, deps: DoctorDeps): Promise<{ ok: boolean; unverified?: boolean; err?: string }> {
  try {
    if (c.provider === "tavily") await deps.tavilyValidate(c.key);
    else if (c.provider === "voyage" || c.provider === "jina") await deps.embedValidate(c.provider, c.key);
    else await deps.chatValidate(c.provider, c.key);
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (isQuotaError(msg)) return { ok: true, unverified: true }; // key is real; quota wall
    return { ok: false, err: msg.slice(0, 160) };
  }
}

/** Discover → validate → (unless dryRun) connect → report. Every provider in the scan
 *  surface gets a verdict; absent ones carry their signup URL (the one manual step left). */
export async function runDoctor(
  opts: { sources?: CandidateSource[]; dryRun?: boolean },
  deps: DoctorDeps,
  readers?: SourceReaders,
): Promise<DoctorReport> {
  const sources = opts.sources?.length ? opts.sources : (["env", "keychain", "gh"] as CandidateSource[]);
  const dryRun = opts.dryRun !== false; // SAFE default: true
  const candidates = discoverCandidates(readers ?? defaultReaders(sources));

  const providers: Record<string, ProviderVerdict> = {};
  const connectedProviders: string[] = [];

  for (const c of candidates) {
    const known = deps.vault.knownKeyIds(c.provider);
    if (known.has(keyId(c.key))) {
      providers[c.provider] ??= { status: "already", source: c.source, keyMasked: c.keyMasked, capabilitiesActivated: capabilitiesFor(c.provider) };
      if (!connectedProviders.includes(c.provider)) connectedProviders.push(c.provider);
      continue;
    }
    const v = await validateCandidate(c, deps);
    if (!v.ok) {
      // Don't downgrade a provider already connected by an earlier candidate.
      if (!providers[c.provider] || providers[c.provider].status === "invalid") {
        providers[c.provider] = {
          status: "invalid", source: c.source, keyMasked: c.keyMasked, capabilitiesActivated: [],
          nextManualUrl: keySignupUrl(c.provider) || undefined,
          note: c.source === "gh" ? `token lacks models access — run: ${GH_REFRESH_CMD}` : v.err,
        };
      }
      continue;
    }
    if (!dryRun) {
      if (deps.vault.hasPrimary(c.provider)) deps.vault.addToPool(c.provider, c.key);
      else deps.vault.savePrimary(c.provider, c.key);
    }
    providers[c.provider] = {
      status: v.unverified ? "connected-unverified" : "connected",
      source: c.source, keyMasked: c.keyMasked,
      capabilitiesActivated: capabilitiesFor(c.provider),
      note: dryRun ? "dry-run: not saved" : undefined,
    };
    if (!connectedProviders.includes(c.provider)) connectedProviders.push(c.provider);
  }

  // No candidate discovered, but the VAULT already holds a key (e.g. connected via the
  // KeyVault UI or a prior doctor run) → the provider is live, report "already", never
  // "absent". Truly absent providers surface the single manual step left (signup URL).
  // Universe = every provider the scan surface knows (chat + embed/search modalities).
  const universe = [...new Set(discoveryTargets().map((t) => t.provider))];
  for (const p of universe) {
    if (!providers[p]) {
      if (deps.vault.hasPrimary(p)) {
        providers[p] = { status: "already", source: "vault", capabilitiesActivated: capabilitiesFor(p) };
        if (!connectedProviders.includes(p)) connectedProviders.push(p);
      } else {
        providers[p] = {
          status: "absent", capabilitiesActivated: [],
          nextManualUrl: keySignupUrl(p) || undefined,
          note: catalogEntry(p) ? undefined : "legacy provider",
        };
      }
    }
  }

  return {
    providers,
    capabilityReport: capabilityReport(connectedProviders),
    roleSuggestions: suggestRoles(connectedProviders),
    dryRun,
  };
}
