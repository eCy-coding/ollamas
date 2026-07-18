// Brain re-embed CLI (S23) — drift remediation with a backup-first guard.
//   make brain-reembed DRY=1     # plan only (counts + current provider/dim)
//   make brain-reembed           # verified backup → full vector rebuild → meta flip
// Embedder = the resolved live one (rag.resolveEmbedder — the space you re-align
// TO is the space recall will query IN). BRAIN_REEMBED_BATCH tunes batch size.
// A mid-run crash is safe: meta stays on the old provider, health() keeps
// flagging drift, and the pre-flight backup is the restore point.
import { openBrainDb, planReembed, reembedAll } from "../server/brain-reembed";
import { resolveEmbedder } from "../server/rag";
import { backupBrain } from "./brain-backup";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const db = openBrainDb(dbPath);
  try {
    if (dryRun) {
      const plan = planReembed(db);
      console.log(JSON.stringify({ event: "brain.reembed.plan", dbPath, ...plan }));
      return;
    }
    // Backup-first guard: no verified snapshot → no destructive rebuild.
    const backup = backupBrain({ dbPath });
    console.log(JSON.stringify({ event: "brain.backup", ...backup }));
    const r = resolveEmbedder();
    const result = await reembedAll(db, r.embed, {
      provider: r.providerId,
      batchSize: Number(process.env.BRAIN_REEMBED_BATCH) || 32,
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) console.log(JSON.stringify({ event: "brain.reembed.progress", done, total }));
      },
    });
    console.log(JSON.stringify({ event: "brain.reembed", dbPath, ...result }));
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(`[brain] reembed FAILED (${e?.message ?? e}) — meta unflipped; restore from the pre-flight backup if needed`);
  process.exit(1);
});
