#!/usr/bin/env -S npx tsx
// `ollamas keys` — terminal view of the API-key pool ("Donanım Kasası" / key havuzu) health. Reads the
// SAME GET /api/keys/health snapshot the web cockpit KeyHealthPanel renders, so terminal ↔ web show
// identical live data from one source (no divergent computation). Read-only; metadata only, never a key.
//
// Pure glyph/banner/row formatting → ./lib/keys-health-core (IO-free, unit-tested); this file is the fetch shell.

import { formatBanner, formatRow, type Snapshot } from "./lib/keys-health-core";

const PORT = process.env.OLLAMAS_PORT || "3000";
const url = `http://localhost:${PORT}/api/keys/health`;

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
  console.log(formatBanner(snap));
  for (const p of snap.providers || []) console.log(formatRow(p));
}

void main();
