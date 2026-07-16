// server/hierarchy-bridge.ts — B7: adapts the dormant, pure Wilson-gate tier router
// (orchestration/bin/lib/hierarchy.ts, v1.25.3µ1) onto the live request path.
//
// KNOWN RISK (project history): a past bench-correctness dataset was invalid, making
// HIERARCHY_POLICY degenerate (every route resolving to the same tier — no real signal).
// So this bridge is ADVISORY-ONLY by default and enforce is structurally unreachable
// whenever the policy is missing or degenerate — see checkPolicyUsable() below.
//
// Modes (env HIERARCHY_ROUTING):
//   unset / "advisory" (default) — compute a recommendation, attach it to trace spans +
//     the /api/hierarchy snapshot, but NEVER touch the provider chain server/providers.ts
//     actually walks.
//   "enforce" — additionally lets the recommendation bias ProviderRouter.effectiveChain's
//     output via reorderChainForTier() (reorder only, never drops a provider) — but ONLY
//     when the on-disk policy is present, structurally valid (parsePolicy), fresh, AND
//     statistically usable (checkPolicyUsable). Any failure of that chain silently forces
//     mode back to "advisory" with a console.warn — "enforce" can never run on bad data.
//   "0" — fully off: no disk read, no span attrs, no ring-buffer entry.
//
// Pure decision core (checkPolicyUsable / computeRecommendation / reorderChainForTier /
// parseModeFromEnv) takes all inputs as arguments — fully unit-testable with zero IO.
// The thin IO layer (loadPolicy / getHierarchyRecommendation / getHierarchySnapshot) reads
// env + an on-disk policy file, mirroring server/jobs.ts's pure-core + thin-IO split.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePolicy, resolveTierForClass, type HierarchyPolicy, type Tier } from "../orchestration/bin/lib/hierarchy";
import { RingBuffer } from "./telemetry";

export type HierarchyMode = "off" | "advisory" | "enforce";

export interface PolicyUsability {
  usable: boolean;
  reason: string;
}

export interface HierarchyRecommendation {
  taskClass: string;
  tier: Tier;
  reason: string;
  /** The mode actually applied to this recommendation (may be forced down from `requestedMode`). */
  mode: HierarchyMode;
  /** The raw HIERARCHY_ROUTING env-derived mode, before any degenerate-data downgrade. */
  requestedMode: HierarchyMode;
  policyUsable: boolean;
  policyReason: string;
}

export interface HierarchySnapshot {
  mode: HierarchyMode;
  policyValid: boolean;
  policyReason: string;
  recentRecommendations: (HierarchyRecommendation & { ts: number })[];
  updatedAt: number;
}

const LOCAL_TIER_PROVIDERS = new Set(["fleet", "ollama-local"]);

// ── Pure: env → mode (fail-safe: anything unrecognized is "advisory", never "enforce") ──
export function parseModeFromEnv(raw: string | undefined): HierarchyMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "0") return "off";
  if (v === "enforce") return "enforce";
  return "advisory"; // unset, "", "advisory", or anything unrecognized
}

// ── Pure: is this policy safe to ENFORCE on? ────────────────────────────────────────
// Degenerate = the exact S0 GOTCHA: measurement-free or self-contradictory data that
// cannot distinguish one tier from another. Two conditions reject it:
//   (a) empty routes ("empty stats" — parsePolicy already forbids this at the JSON layer,
//       but a caller may hand us a hand-built policy object, so re-check defensively).
//   (b) every route resolves to the SAME chosenTier ("all tiers equal" — no signal to act on).
export function checkPolicyUsable(policy: HierarchyPolicy | null): PolicyUsability {
  if (!policy) return { usable: false, reason: "no-policy: missing or unparseable" };
  if (!policy.routes || policy.routes.length === 0) {
    return { usable: false, reason: "empty-stats: policy has zero routes" };
  }
  const distinctTiers = new Set(policy.routes.map((r) => r.chosenTier));
  if (distinctTiers.size <= 1) {
    return { usable: false, reason: `degenerate: all ${policy.routes.length} route(s) resolve to the same tier "${policy.routes[0].chosenTier}" (no distinguishable signal)` };
  }
  return { usable: true, reason: "usable" };
}

// ── Pure: the decision core. All inputs injected → deterministic, unit-testable. ───
export function computeRecommendation(
  policy: HierarchyPolicy | null,
  taskClass: string,
  requestedMode: HierarchyMode,
  opts?: { wilsonLow?: number; now?: Date },
): HierarchyRecommendation {
  if (requestedMode === "off") {
    return {
      taskClass, tier: "local", reason: "hierarchy-off",
      mode: "off", requestedMode: "off", policyUsable: false, policyReason: "disabled",
    };
  }

  const usability = checkPolicyUsable(policy);
  // enforce is IMPOSSIBLE on unusable data — force advisory regardless of what was requested.
  const mode: HierarchyMode = requestedMode === "enforce" && usability.usable ? "enforce" : "advisory";

  if (!policy) {
    return {
      taskClass, tier: "local", reason: "no-policy-default",
      mode, requestedMode, policyUsable: false, policyReason: usability.reason,
    };
  }

  const resolved = resolveTierForClass(policy, taskClass, opts);
  return {
    taskClass, tier: resolved.tier, reason: resolved.reason,
    mode, requestedMode, policyUsable: usability.usable, policyReason: usability.reason,
  };
}

// ── Pure: reorder (never drop) providers to bias toward the recommended tier. ──────
// "local" tier = the default chain already runs fleet/ollama-local first, so nothing
// to do. For "sonnet"/"opus" (the policy wants more capability than local can prove),
// push the local-tier entries to just before "demo" (or the end) so a cloud provider
// gets first shot — local NEVER leaves the chain, it just stops being first-tried, so
// an all-cloud-down situation still safely falls through to it. Set-equality with the
// input is an invariant: this function only ever permutes, never adds/removes.
export function reorderChainForTier(chain: string[], tier: Tier): string[] {
  if (tier === "local") return chain;
  const rest = chain.filter((p) => !LOCAL_TIER_PROVIDERS.has(p));
  const localItems = chain.filter((p) => LOCAL_TIER_PROVIDERS.has(p));
  if (rest.length === 0 || localItems.length === 0) return chain; // nothing safe to reorder around
  const demoIdx = rest.indexOf("demo");
  if (demoIdx === -1) return [...rest, ...localItems];
  return [...rest.slice(0, demoIdx), ...localItems, ...rest.slice(demoIdx)];
}

// ── Thin IO: load + cache the on-disk policy (µ2 — HIERARCHY_POLICY.json lands post
// calibration-T0; until then this simply returns null → forced advisory, by design). ──
let cachedPolicy: HierarchyPolicy | null | undefined; // undefined = not loaded yet this process

function policyPath(): string {
  return process.env.HIERARCHY_POLICY_PATH || path.join(process.cwd(), "orchestration", "HIERARCHY_POLICY.json");
}

function loadPolicy(): HierarchyPolicy | null {
  if (cachedPolicy !== undefined) return cachedPolicy;
  try {
    const raw = JSON.parse(readFileSync(policyPath(), "utf8"));
    cachedPolicy = parsePolicy(raw);
  } catch {
    cachedPolicy = null; // missing file, bad JSON, or parsePolicy's own degenerate-data rejection
  }
  return cachedPolicy;
}

/** Test-only: force a re-read of the policy file (and env) on the next call. */
export function _resetPolicyCacheForTest(): void {
  cachedPolicy = undefined;
}

// ── Thin IO: last-N recommendations ring buffer, feeds GET /api/hierarchy. ─────────
const RECOMMENDATION_RING_MAX = 100;
let recommendationRing = new RingBuffer<HierarchyRecommendation & { ts: number }>(RECOMMENDATION_RING_MAX);

/** Test-only: clear the recommendation ring between test files. */
export function _resetRecommendationRingForTest(): void {
  recommendationRing = new RingBuffer<HierarchyRecommendation & { ts: number }>(RECOMMENDATION_RING_MAX);
}

/**
 * Compute (and record) a tier recommendation for one request's task class. Cheap and safe
 * to call unconditionally from the request path: "off" short-circuits before any disk read
 * or ring-buffer write.
 */
export function getHierarchyRecommendation(taskClass: string, opts?: { wilsonLow?: number; now?: Date }): HierarchyRecommendation {
  const requestedMode = parseModeFromEnv(process.env.HIERARCHY_ROUTING);
  if (requestedMode === "off") {
    return computeRecommendation(null, taskClass, "off", opts);
  }
  const policy = loadPolicy();
  const rec = computeRecommendation(policy, taskClass, requestedMode, opts);
  if (requestedMode === "enforce" && rec.mode === "advisory") {
    console.warn(`[HierarchyBridge] enforce requested but forced to advisory (${rec.policyReason}) for taskClass="${taskClass}"`);
  }
  recommendationRing.push({ ...rec, ts: Date.now() });
  return rec;
}

/** Cheap snapshot for GET /api/hierarchy. */
export function getHierarchySnapshot(): HierarchySnapshot {
  const requestedMode = parseModeFromEnv(process.env.HIERARCHY_ROUTING);
  const policy = requestedMode === "off" ? null : loadPolicy();
  const usability = checkPolicyUsable(policy);
  return {
    mode: requestedMode,
    policyValid: usability.usable,
    policyReason: usability.reason,
    recentRecommendations: recommendationRing.toArray(),
    updatedAt: Date.now(),
  };
}
