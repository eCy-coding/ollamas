#!/usr/bin/env -S npx tsx
// `ollamas keys` — terminal view of the API-key pool ("Donanım Kasası" / key havuzu) health. Reads the
// SAME GET /api/keys/health snapshot the web cockpit KeyHealthPanel renders, so terminal ↔ web show
// identical live data from one source (no divergent computation). Read-only; metadata only, never a key.

interface ProviderHealth { provider: string; status: "live" | "cooled" | "invalid" | "absent"; keyless: boolean; source?: string; cooledUntilMs?: number; signupUrl?: string; }
interface Snapshot { providers: ProviderHealth[]; live: number; absent: string[]; allCloudCooled?: boolean; converged?: boolean; }

const PORT = process.env.OLLAMAS_PORT || "3000";
const url = `http://localhost:${PORT}/api/keys/health`;

const glyph = (s: string) => (s === "live" ? "●" : s === "cooled" ? "◐" : s === "invalid" ? "✗" : "○");

async function main(): Promise<void> {
  let snap: Snapshot;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { console.error(`keys: server responded ${res.status} — is ollamas up? (ollamas up)`); process.exit(1); }
    snap = (await res.json()) as Snapshot;
  } catch (e) {
    console.error(`keys: cannot reach ${url} — ${(e as Error)?.message || e}. Is ollamas up? (ollamas up)`);
    process.exit(1);
  }
  const providers = snap.providers || [];
  const keyless = providers.filter((p) => p.keyless).length;
  const banner = `🔑 KEY HEALTH — ${snap.live ?? providers.filter((p) => p.status === "live").length}/${providers.length} live · ${keyless} keyless (0-manual)`
    + (snap.allCloudCooled ? " · ⚠ ALL CLOUD COOLED → local Ollama fallback" : "")
    + (snap.converged ? " · converged" : "");
  console.log(banner);
  for (const p of providers) {
    const extra = p.status === "cooled" && p.cooledUntilMs
      ? ` · recovers ${new Date(p.cooledUntilMs).toLocaleTimeString()}`
      : p.keyless ? " · 0-manual" : p.status === "absent" ? ` · needs key${p.signupUrl ? ` (${p.signupUrl})` : ""}` : p.source ? ` · ${p.source}` : "";
    console.log(`  ${glyph(p.status)} ${p.provider.padEnd(16)} ${p.status}${extra}`);
  }
}

void main();
