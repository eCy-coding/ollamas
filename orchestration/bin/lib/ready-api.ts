// ready-api — key-live free-tier API providers from the server's /api/keys/pool.
// Used by fleet-launch/mission to resolve `provider::model` prefer entries. Best-effort:
// any failure returns [] so API-routed seats simply stay absent (same as a missing
// ollama tag) and the plan degrades to the legacy local/ollama-cloud shape.

export async function readyApiProviders(ollamasUrl: string, timeoutMs = 4000): Promise<string[]> {
  try {
    const r = await fetch(`${ollamasUrl}/api/keys/pool`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return [];
    const j: any = await r.json();
    return Object.entries(j?.pool ?? {})
      .filter(([, v]: [string, any]) => (v?.live ?? 0) > 0)
      .map(([p]) => p);
  } catch { return []; }
}
