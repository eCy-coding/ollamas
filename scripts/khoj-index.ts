// L25: index the ollamas vault's knowledge into odysseus's Khoj second-brain so odysseus can
// actually retrieve the collective brain (not just report "online, 0 entry"). Runs OUT of the
// hot 5-min sync path — batched incremental PATCH is heavier than a mirror write, so it lives
// here as an on-demand / periodic job. Best-effort: a down Khoj is a clean skip.
import { pushVaultToKhoj, khojBase } from "../server/brain-obsidian-khoj";

const vault = process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;
const base = khojBase();

// quick liveness probe so a down Khoj exits fast instead of timing out per batch.
let online = false;
try {
  const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
  online = r.ok;
} catch { /* offline */ }

if (!online) {
  console.log(JSON.stringify({ event: "khoj.index", online: false, note: `Khoj unreachable (${base}) — skipped` }));
  process.exit(0);
}

const res = await pushVaultToKhoj(vault, { base });
// trigger a reload so the freshly-indexed entries are searchable immediately.
try { await fetch(`${base}/api/update?force=false&t=markdown`, { signal: AbortSignal.timeout(30_000) }); } catch { /* best-effort */ }

console.log(JSON.stringify({ event: "khoj.index", online: true, ...res }));
