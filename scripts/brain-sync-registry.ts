// Brain ↔ PROBLEM_REGISTRY bridge (H5) — one-way READ: the orchestration THINK loop's
// proven-solution knowledge base flows into the brain as `learned` memories so semantic
// recall can surface them. The registry file is NEVER written (orchestration lane owns it).
// Idempotent: ids are `preg:<category>` — re-running upserts, never duplicates.
//   npx tsx scripts/brain-sync-registry.ts    (or: make brain-sync-registry)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrainStore } from "../server/brain";
import { resolveEmbedder } from "../server/rag";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface RegistryEntry {
  category: string;
  pattern: string;
  provenSolution: string;
  sources?: string[];
}

/** Pure: registry entry → brain memory row (learned tier, stable id). */
export function entryToMemory(e: RegistryEntry) {
  return {
    id: `preg:${e.category}`,
    tier: "learned" as const,
    content: `[${e.category}] ${e.provenSolution}${e.sources?.length ? ` (kaynak: ${e.sources[0]})` : ""}`,
    source: "problem-registry",
  };
}

async function main() {
  const raw = JSON.parse(readFileSync(join(ROOT, "orchestration/PROBLEM_REGISTRY.json"), "utf8"));
  const entries: RegistryEntry[] = Array.isArray(raw?.entries) ? raw.entries : [];
  if (entries.length === 0) throw new Error("registry has no entries[] — format changed?");
  const r = resolveEmbedder();
  const b = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  try {
    let n = 0;
    for (const e of entries) {
      if (!e?.category || !e?.provenSolution) continue;
      await b.remember(entryToMemory(e));
      n++;
    }
    console.log(`[brain] registry sync: ${n}/${entries.length} proven lessons upserted as learned memories`);
  } finally {
    b.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("brain-sync-registry.ts")) {
  main().catch((e) => {
    console.error(`brain-sync-registry failed: ${e?.message ?? e}`);
    process.exit(1);
  });
}
