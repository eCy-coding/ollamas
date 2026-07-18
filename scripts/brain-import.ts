// Brain portable restore (S22) — idempotent merge of a JSON dump into the target
// brain (BRAIN_DB_PATH). Vectors are rebuilt through the normal embed path (needs
// the local embedder up unless BRAIN_EMBED_FAKE=1 — the module singleton resolves
// both, which is why this script goes through brainRemember/brainAssertFact and
// not a hand-built store). Existing rows are skipped, so re-runs after a partial
// failure complete exactly the missing remainder.
// Usage: npx tsx scripts/brain-import.ts <dump.json> [--dry]
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { importBrain, makeExistenceProbes, type BrainDump } from "../server/brain-portable";
import { brainRemember, brainAssertFact, brainStats } from "../server/brain";

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/brain-import.ts <dump.json> [--dry]");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry");
  const dump = JSON.parse(readFileSync(file, "utf8")) as BrainDump;
  const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;

  brainStats(); // opens the singleton store → schema exists before the probes attach
  const probeDb = new DatabaseSync(dbPath);
  try {
    const { hasMemory, hasFact } = makeExistenceProbes(probeDb);
    const report = await importBrain(
      { remember: brainRemember, assertFact: brainAssertFact },
      hasMemory,
      hasFact,
      dump,
      { dryRun, onError: (what, err) => console.error(`import fail ${what}: ${err.message}`) },
    );
    console.log(JSON.stringify({ event: "brain.import", file, dbPath, ...report }));
    if (report.memories.failed + report.facts.failed > 0) process.exitCode = 1;
  } finally {
    probeDb.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
