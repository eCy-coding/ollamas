// Obsidian mirror sync — periodic launchd tick (com.ollamas.brain-obsidian-sync.plist,
// StartInterval 300). Like brain-loop.ts, this is a THIN HTTP CLIENT of :3000 and never
// opens brain.db directly (the server owns the store + embedder singleton; a second
// writer process would race the WAL). It just asks the server to reconcile brain ⇄ vault.
// "both" = pull hand-edits into the brain, then mirror the brain back out. Idempotent and
// cheap (a no-change tick writes 0), so a tight interval is safe. Disable per-shell with
// OBSIDIAN_SYNC=0. Best-effort: server unreachable → log + exit 0 (launchd retries next tick).
const API = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const DIRECTION = (process.env.OBSIDIAN_SYNC_DIRECTION || "both") as "both" | "push" | "pull";

const api = async (path: string, body?: unknown, ms = 60_000): Promise<any> => {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

async function main() {
  if (process.env.OBSIDIAN_SYNC === "0") { console.log(JSON.stringify({ event: "obsidian.skip", reason: "OBSIDIAN_SYNC=0" })); return; }
  const at = Date.now();
  try {
    const r = await api("/api/brain/obsidian/sync", { direction: DIRECTION });
    console.log(JSON.stringify({
      event: "obsidian.sync", at, ms: Date.now() - at, direction: r.direction,
      written: r.push?.written, skipped: r.push?.skipped, pruned: r.push?.pruned, entities: r.push?.entities,
      ingested: r.pull?.ingested, conflicts: r.pull?.conflicts, memories: r.memories, vault: r.vault,
    }));
    if (r.pull?.conflicts > 0) console.error(JSON.stringify({ event: "obsidian.conflicts", n: r.pull.conflicts, vault: r.vault }));

    // L9: process the Obsidian ask queue — human `- [ ]` questions in orchestra/ask.md get
    // answered via ask-shared, written to answers/, and marked done. Best-effort.
    try {
      const { processAskQueue } = await import("../server/brain-obsidian");
      const answered = await processAskQueue(r.vault, (q) => api("/api/brain/ask-shared", { question: q }, 90_000));
      if (answered > 0) console.log(JSON.stringify({ event: "obsidian.ask", answered }));
    } catch (e: any) { console.error(JSON.stringify({ event: "obsidian.ask.error", msg: String(e?.message || e) })); }
  } catch (e: any) {
    // Non-fatal: the server may be mid-restart. launchd fires again next interval.
    console.error(JSON.stringify({ event: "obsidian.sync.error", at, msg: String(e?.message || e) }));
  }
}

main();
