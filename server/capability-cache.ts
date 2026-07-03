// server/capability-cache.ts — passive tool-calling capability cache. Free tiers don't
// guarantee function-calling, and an ACTIVE probe would spend scarce free-tier requests;
// instead the router learns from real traffic (4xx on a tools request → false, success
// with tools → true) and the chain filter routes tool work away from proven-incapable
// providers. In-memory + snapshot/hydrate (router persists it in the config vault).

const cache = new Map<string, boolean>();
const ck = (provider: string, model: string) => `${provider}::${model || "*"}`;

/** true/false when learned; undefined = unknown (chain filter keeps the provider, optimistic). */
export function getToolSupport(provider: string, model = ""): boolean | undefined {
  return cache.get(ck(provider, model));
}

export function setToolSupport(provider: string, model: string, ok: boolean): void {
  cache.set(ck(provider, model), ok);
}

export function toolSupportSnapshot(): Record<string, boolean> {
  return Object.fromEntries(cache);
}

export function hydrateToolSupport(saved: unknown): void {
  if (!saved || typeof saved !== "object") return;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof v === "boolean" && !cache.has(k)) cache.set(k, v);
  }
}

/** Test/maintenance helper. */
export function resetToolSupport(): void { cache.clear(); }
