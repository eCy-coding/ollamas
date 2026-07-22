// Gate trainer (L19) — a standalone entry to the same trainGate the loop runs, so a fresh
// gate can be persisted on demand (e.g. right after a new expert is added). Reuses the
// existing pieces: readOutcomes (ledger) + trainGate (cross-entropy) + saveGate (atomic).
// Init is a correctly-sized empty gate (EXPERTS.length rows); trainGate's width-guard skips
// any stale rows whose scores vector predates the current expert set. Prints the outcome.
import { EXPERTS, emptyGate } from "../server/brain-formulas";
import { trainGate } from "../server/brain-gate-train";
import { readOutcomes } from "../server/brain-outcome-ledger";
import { loadGate, saveGate } from "../server/brain-gate-store";

const DIM = Number(process.env.BRAIN_EMBED_DIM) || 768;
const rows = readOutcomes(2000);
const fresh = rows.filter((r) => Array.isArray(r.scores) && r.scores.length === EXPERTS.length);
// Init: keep a same-width learned gate if one exists, else cold-start at the right size.
const loaded = loadGate();
const init = loaded && loaded.W.length === EXPERTS.length ? loaded : emptyGate(DIM);
const { gate, losses } = trainGate(init, rows);
const ok = saveGate(gate);
console.log(JSON.stringify({
  event: "gate.train", experts: EXPERTS.length, rowsTotal: rows.length,
  rowsUsable: fresh.length, gateRows: gate.W.length, saved: ok,
  lossFirst: losses[0] ?? null, lossLast: losses[losses.length - 1] ?? null,
}));
