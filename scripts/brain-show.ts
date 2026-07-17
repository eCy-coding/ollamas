// Brain viewer (Tur 6) — the admin's window into the brain.
//   npx tsx scripts/brain-show.ts                 → stats + latest memories + live facts
//   npx tsx scripts/brain-show.ts "query"         → semantic recall + semantic fact search
// Read path only (recall does bump access counts — that is the design: looking at a
// memory keeps it warm). Uses the real ~/.llm-mission-control/brain.db (BRAIN_DB_PATH).
import { DatabaseSync } from "node:sqlite";
import { createBrainStore } from "../server/brain";
import { resolveEmbedder } from "../server/rag";

const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
const query = process.argv[2];

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return console.log("  (boş)");
  console.table(rows);
}

async function main() {
  const r = resolveEmbedder();
  const b = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  try {
    const s = b.stats();
    const h = await b.health();
    console.log(`\n🧠 BRAIN — ${dbPath} (${(s.dbBytes / 1024).toFixed(0)} KB, ${s.namespaces} ns)`);
    console.log(`   tiers: ${Object.entries(s.memories).map(([t, n]) => `${t}=${n}`).join("  ")} | canlı fact: ${s.facts}`);
    console.log(`   health: self-hit ${(h.selfHitRate * 100).toFixed(0)}% / ${h.probes} probe → ${h.drift ? "⚠️ DRIFT" : "✓ sağlıklı"}\n`);

    if (query) {
      console.log(`── recall("${query}") ──`);
      table((await b.recall(query, { k: 5 })).map((h) => ({
        id: h.id, tier: h.tier, score: h.score.toFixed(3), content: h.content.slice(0, 80),
      })));
      console.log(`── searchFacts("${query}") ──`);
      table((await b.searchFacts(query, { k: 5 })).map((f) => ({
        fact: `${f.subject} ${f.predicate} ${f.object}`.slice(0, 70), distance: f.distance.toFixed(3),
      })));
      return;
    }

    // Raw read-only peeks (no access bump) for the overview lists.
    const db = new DatabaseSync(dbPath, { readOnly: true });
    console.log("── son 10 hafıza ──");
    table(db.prepare(
      "SELECT mem_id AS id, tier, substr(content,1,70) AS content, access_count AS hits FROM brain_memories ORDER BY created_at DESC LIMIT 10",
    ).all() as Record<string, unknown>[]);
    console.log("── canlı fact'ler (son 10) ──");
    table(db.prepare(
      "SELECT subject||' '||predicate||' '||object AS fact, episode_id AS episode FROM brain_facts WHERE invalidated_at IS NULL ORDER BY valid_from DESC LIMIT 10",
    ).all() as Record<string, unknown>[]);
    console.log("── fact tarihi (süperseed edilmiş son 5) ──");
    table(db.prepare(
      "SELECT subject||' '||predicate||' '||object AS was, datetime(invalidated_at/1000,'unixepoch') AS until FROM brain_facts WHERE invalidated_at IS NOT NULL ORDER BY invalidated_at DESC LIMIT 5",
    ).all() as Record<string, unknown>[]);
    db.close();
  } finally {
    b.close();
  }
}

main().catch((e) => {
  console.error(`brain-show failed: ${e?.message ?? e}`);
  process.exit(1);
});
