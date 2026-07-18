/**
 * server/buddy-provision.ts — v15 buddy-system layer 3 (OPT-IN key minting).
 *
 * When a provider goes dark and machine-key discovery found nothing, try to grow the pool
 * from tooling the operator is ALREADY authenticated with — NOT by creating accounts.
 *   - gh auth token → github-models (reuses the existing GitHub OAuth session)
 *   - gcloud → a Gemini API key on the operator's CURRENT default project
 *
 * 🔴 SECURITY: this NEVER creates an account, NEVER creates a new GCP project, NEVER solves a
 * CAPTCHA, and NEVER logs a key value. It only mints a key from credentials a human already
 * established. Disabled unless ECY_AUTO_PROVISION=1. All steps are fail-soft.
 */

export interface ProvisionDeps {
  /** Whether a provider already has a usable key (skip if so). */
  hasKey: (provider: string) => boolean;
  /** Read the existing `gh` OAuth token (or null if gh absent / not logged in). */
  ghToken?: () => Promise<string | null>;
  /** Mint ONE Gemini key from the already-authed gcloud default project (or null). */
  mintGeminiKey?: () => Promise<string | null>;
  /** Add a discovered key to the provider's vault pool (→ /api/keys/add sink). */
  addKey: (provider: string, key: string) => Promise<void>;
}

export interface ProvisionResult { provisioned: string[]; note: string }

/** True only when the operator has explicitly opted into key minting. */
export function provisionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ECY_AUTO_PROVISION === "1";
}

/**
 * Try to grow the pool for a downed provider from already-authed local tooling. Opt-in,
 * fail-soft, account-free. Returns which providers gained a key. `provider` is a hint (the
 * one that went dark); we still attempt every tooling source that's currently keyless.
 */
export async function attemptProvision(_provider: string, deps: ProvisionDeps, env: NodeJS.ProcessEnv = process.env): Promise<ProvisionResult> {
  if (!provisionEnabled(env)) return { provisioned: [], note: "disabled (set ECY_AUTO_PROVISION=1)" };
  const provisioned: string[] = [];
  const notes: string[] = [];

  // github-models: reuse the existing gh OAuth token (created by a prior `gh auth login`).
  if (deps.ghToken && !deps.hasKey("github-models")) {
    try {
      const tok = await deps.ghToken();
      if (tok) { await deps.addKey("github-models", tok); provisioned.push("github-models"); }
      else notes.push("gh: no token");
    } catch (e) { notes.push(`gh: ${short(e)}`); }
  }

  // gemini: mint ONE key from the authed gcloud default project (never creates a project).
  if (deps.mintGeminiKey && !deps.hasKey("gemini")) {
    try {
      const key = await deps.mintGeminiKey();
      if (key) { await deps.addKey("gemini", key); provisioned.push("gemini"); }
      else notes.push("gcloud: no key");
    } catch (e) { notes.push(`gcloud: ${short(e)}`); }
  }

  return { provisioned, note: provisioned.length ? `minted: ${provisioned.join(",")}` : (notes.join("; ") || "nothing to mint") };
}

function short(e: unknown): string { return String((e as Error)?.message ?? e).slice(0, 60); }
