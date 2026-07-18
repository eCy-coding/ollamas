// Restore drill (S47) — a backup you never restored is a hope, not a backup.
// Proves the WHOLE DR chain on every run: export the source brain (S22 dump) →
// import into a THROWAWAY store → recall a just-imported memory semantically.
// The drill embedder is the deterministic fake (De-load: a nightly drill must
// not re-embed a 200-row store through ollama; the real-embed import path is
// exercised by the S22 selftest and real imports). Live db is never touched.
//   make brain-drill                    # drill against the live db's dump
//   scripts: runRestoreDrill(dbPath)    # callable from maintain (weekly)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportBrain, importBrain, makeExistenceProbes } from "../server/brain-portable";
import { createBrainStore } from "../server/brain";

export interface DrillReport {
  exportedMemories: number;
  exportedFacts: number;
  imported: number;
  recallHit: boolean;
  ok: boolean;
}

const drillEmbed = async (t: string) => {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, ((h * 29) % 997) / 997];
};

/** Full dump→restore→recall proof against a throwaway target. */
export async function runRestoreDrill(sourceDbPath: string): Promise<DrillReport> {
  const dump = exportBrain(sourceDbPath);
  const dir = mkdtempSync(join(tmpdir(), "brain-drill-"));
  const b = createBrainStore({ dbPath: join(dir, "drill.db"), embed: drillEmbed, embedProvider: "drill-fake" });
  const probeDb = new DatabaseSync(join(dir, "drill.db"));
  try {
    const probes = makeExistenceProbes(probeDb);
    const rep = await importBrain(b, probes.hasMemory, probes.hasFact, dump);
    const imported = rep.memories.inserted;
    // Recall smoke: the newest imported memory must be findable by its own content.
    const target = dump.memories.at(-1);
    let recallHit = false;
    if (target) {
      const hits = await b.recall(target.content.slice(0, 200), { k: 3, ns: target.ns });
      recallHit = hits.some((h) => h.id === target.id);
    }
    const ok = rep.memories.failed === 0 && rep.facts.failed === 0 && (dump.memories.length === 0 || recallHit);
    return { exportedMemories: dump.memories.length, exportedFacts: dump.facts.length, imported, recallHit, ok };
  } finally {
    probeDb.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const r = await runRestoreDrill(dbPath);
  console.log(JSON.stringify({ event: "brain.restore.drill", dbPath, ...r }));
  if (!r.ok) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("brain-restore-drill.ts")) {
  main().catch((e) => {
    console.error(`[brain] restore drill FAILED (${e?.message ?? e})`);
    process.exit(1);
  });
}
