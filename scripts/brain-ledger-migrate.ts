// One-shot org-ledger → brain migration: mirror the historical management ledger
// (~/.ollamas/brain-ledger.jsonl) into the 5-tier brain under ns "org". Uses the SAME
// toBrainInput mapping as the live dual-write mirror, so ids are deterministic and the
// script is idempotent — re-runs (and records already mirrored live) upsert in place.
// Original event timestamps are preserved (createdAt) so recency decay stays truthful.
// Writes DIRECTLY via brainRemember (no server needed; WAL + busy_timeout make the
// concurrent live server safe). Requires ollama up for nomic embeddings.
// Usage: npx tsx scripts/brain-ledger-migrate.ts [--dry]
import { readLedger, toBrainInput } from "../orchestration/bin/lib/brain-ledger";

async function main() {
  const dry = process.argv.includes("--dry");
  const records = readLedger();
  if (records.length === 0) {
    console.log(JSON.stringify({ event: "brain.ledger.migrate", records: 0, note: "empty ledger" }));
    return;
  }
  const { brainRemember } = await import("../server/brain");
  let ok = 0;
  let failed = 0;
  for (const rec of records) {
    const input = toBrainInput(rec);
    if (dry) {
      console.log(JSON.stringify({ dry: true, ...input }));
      continue;
    }
    try {
      await brainRemember(input);
      ok++;
    } catch (err) {
      failed++;
      console.error(`migrate fail ${input.id}: ${(err as Error).message}`);
    }
  }
  console.log(JSON.stringify({ event: "brain.ledger.migrate", records: records.length, ok, failed, dry }));
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
