// Cockpit aggregate — pure assembly of the live "mission control" view. IO (os
// metrics, ollama probe, pool read) lives in server.ts; this stays unit-testable.

export interface FleetBackend {
  name: string;
  url: string;
  priority: number;
  active: boolean;
}

export interface CockpitFleet {
  activeUrl: string;
  poolSize: number;
  backends: FleetBackend[];
}

const normUrl = (u: string): string => u.replace(/\/+$/, "");

/**
 * Build the fleet view from the raw `~/.ollamas/backends.json` pool + the currently
 * active OLLAMA_HOST. Marks which backend is serving, sorts by priority (ascending,
 * 1 tried first), and tolerates malformed/missing pool entries.
 */
export function buildFleetView(poolRaw: unknown, activeHost: string): CockpitFleet {
  const pool = Array.isArray(poolRaw)
    ? poolRaw
        .filter((b): b is { name?: unknown; url: string; priority?: unknown } => !!b && typeof (b as any).url === "string" && !!(b as any).url)
        .map((b) => ({
          name: typeof b.name === "string" && b.name ? b.name : String(b.url),
          url: b.url,
          priority: typeof b.priority === "number" && isFinite(b.priority) ? b.priority : 50,
        }))
    : [];
  const active = normUrl(activeHost);
  return {
    activeUrl: activeHost,
    poolSize: pool.length,
    backends: pool
      .sort((a, b) => a.priority - b.priority)
      .map((b) => ({ ...b, active: normUrl(b.url) === active })),
  };
}
