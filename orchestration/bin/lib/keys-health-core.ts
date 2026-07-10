// orchestration/bin/lib/keys-health-core.ts — pure render core for keys-health.ts (IO-free → unit-tested).
//
// keys-health.ts fetches GET /api/keys/health (IO) and prints the pool health. The glyph + banner + row
// formatting is a pure transform over the snapshot shape — extracted here so the terminal view's contract
// is asserted without booting a server.

export interface ProviderHealth {
  provider: string;
  status: "live" | "cooled" | "invalid" | "absent";
  keyless: boolean;
  source?: string;
  cooledUntilMs?: number;
  signupUrl?: string;
}
export interface Snapshot {
  providers: ProviderHealth[];
  live?: number;
  absent?: string[];
  allCloudCooled?: boolean;
  converged?: boolean;
}

/** Status → single-char glyph (live ● / cooled ◐ / invalid ✗ / absent ○). */
export function glyph(s: string): string {
  return s === "live" ? "●" : s === "cooled" ? "◐" : s === "invalid" ? "✗" : "○";
}

/** Top banner line: live/total, keyless count, cloud-cooled + converged flags. Deterministic (no clock). */
export function formatBanner(snap: Snapshot): string {
  const providers = snap.providers || [];
  const keyless = providers.filter((p) => p.keyless).length;
  const live = snap.live ?? providers.filter((p) => p.status === "live").length;
  return `🔑 KEY HEALTH — ${live}/${providers.length} live · ${keyless} keyless (0-manual)`
    + (snap.allCloudCooled ? " · ⚠ ALL CLOUD COOLED → local Ollama fallback" : "")
    + (snap.converged ? " · converged" : "");
}

/** One provider row. The `cooled` branch uses a wall-clock recovery time; all others are deterministic. */
export function formatRow(p: ProviderHealth): string {
  const extra = p.status === "cooled" && p.cooledUntilMs
    ? ` · recovers ${new Date(p.cooledUntilMs).toLocaleTimeString()}`
    : p.keyless ? " · 0-manual"
    : p.status === "absent" ? ` · needs key${p.signupUrl ? ` (${p.signupUrl})` : ""}`
    : p.source ? ` · ${p.source}` : "";
  return `  ${glyph(p.status)} ${p.provider.padEnd(16)} ${p.status}${extra}`;
}
