// K2 — Emre's project universe → brain. The densest source of "everything about
// this MacBook and ollamas" already exists: the operator memory INDEX (one line
// per project) plus the repo's own knowledge surface. Idempotent: stable ids
// upsert, re-runs refresh instead of piling up. Read-only inputs; secrets never
// touched. Usage: make brain-sync-universe
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { brainRemember, brainAssertFact } from "../server/brain";

const MEM_INDEX = join(homedir(), ".claude", "projects", "-Users-emrecnyngmail-com", "memory", "MEMORY.md");

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

async function main() {
  let mem = 0;
  let facts = 0;
  if (existsSync(MEM_INDEX)) {
    const lines = readFileSync(MEM_INDEX, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- ["))
      .slice(0, 80);
    for (const line of lines) {
      const title = line.match(/\[([^\]]+)\]/)?.[1] || "";
      if (!title) continue;
      await brainRemember({
        id: `universe:${slug(title)}`,
        tier: "learned",
        content: line.replace(/^- /, "").slice(0, 1200),
        source: "universe-index",
        ns: "universe",
        actor: "emre",
      });
      mem++;
      try {
        const r = await brainAssertFact({ subject: "emre", predicate: "has_project", object: title.slice(0, 80), ns: "default" });
        if (r.changed) facts++;
      } catch { /* fact arm needs the embedder — memories (write-behind) already landed */ }
    }
  }
  // ollamas repo surface: scripts + docs headlines (titles only — bodies stay in git).
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const scripts = Object.keys(pkg.scripts || {}).slice(0, 40).join(", ");
    await brainRemember({
      id: "universe:ollamas-scripts",
      tier: "learned",
      content: `ollamas repo npm script'leri: ${scripts}`,
      source: "universe-repo",
      ns: "universe",
      actor: "ollamas",
    });
    mem++;
  } catch { /* package.json shape drift → skip */ }
  console.log(JSON.stringify({ event: "brain.universe.sync", memories: mem, facts }));
}

void main();
