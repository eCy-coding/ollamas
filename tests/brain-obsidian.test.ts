// Obsidian ⇄ brain bridge (I/O) — real temp sqlite-vec store (fake embedder) + temp vault.
// Covers: authoritative push, idempotency (0-write re-run), human-edit pull-upsert,
// new-note ingest, non-destructive delete, entity-graph notes, and status drift.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainStore } from "../server/brain";
import { syncObsidian, obsidianStatus } from "../server/brain-obsidian";
import { parseMarkdown } from "../server/brain-obsidian-note";

// Isolate from a live Khoj: syncObsidian's push federates odysseus via a real fetchKhoj.
// Point it at a closed port so it fails fast (ECONNREFUSED, instant) instead of blocking on a
// running local Khoj daemon and tripping the 5s test timeout.
process.env.KHOJ_URL = "http://127.0.0.1:59999";

const fakeEmbed = async (t: string) => { const v = [0, 0, 0]; v[t.length % 3] = 1; return v; };

async function seed(dbPath: string) {
  const b = createBrainStore({ dbPath, embed: fakeEmbed });
  await b.remember({ id: "core:emre", tier: "core", content: "Emre is the sovereign operator" });
  await b.remember({ id: "loop:a1b2", tier: "learned", content: "gate persists via W_g store" });
  await b.remember({ id: "work:tmp", tier: "working", content: "scratch note" });
  await b.assertFact({ subject: "Emre", predicate: "operates", object: "ollamas" });
  await b.assertFact({ subject: "ollamas", predicate: "serves", object: "brain" });
  b.close();
}

let dbPath: string, vault: string;
beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), "obs-"));
  dbPath = join(d, "brain.db");
  vault = join(d, "vault");
});

describe("push: brain → vault (authoritative mirror)", () => {
  test("materializes one note per memory in its tier folder", async () => {
    await seed(dbPath);
    const r = await syncObsidian("push", { vault, dbPath });
    expect(r.push.written).toBe(3);
    expect(existsSync(join(vault, "core", "core-emre.md"))).toBe(true);
    expect(existsSync(join(vault, "learned", "loop-a1b2.md"))).toBe(true);
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(true);
    const note = readFileSync(join(vault, "core", "core-emre.md"), "utf8");
    expect(parseMarkdown(note).memory!.content).toBe("Emre is the sovereign operator");
  });

  test("writes entity-graph notes + MOC (Obsidian graph = fact graph)", async () => {
    await seed(dbPath);
    const r = await syncObsidian("push", { vault, dbPath });
    expect(r.push.entities).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(vault, "Home.md"))).toBe(true);
    const emreEntity = readFileSync(join(vault, "entities", "entity-emre.md"), "utf8");
    expect(emreEntity).toContain("operates");
    expect(emreEntity).toContain("[[entity-ollamas]]"); // wikilink into the graph
  });

  test("idempotent: a second push writes 0 and skips all", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    const second = await syncObsidian("push", { vault, dbPath });
    expect(second.push.written).toBe(0);
    expect(second.push.skipped).toBe(3);
  });
});

describe("pull: vault → brain (human edits upsert, ids stable)", () => {
  test("a hand-edited note body upserts back by id (no duplicate)", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    // human edits the note body in Obsidian
    const file = join(vault, "learned", "loop-a1b2.md");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("gate persists via W_g store", "gate persists via learned W_g weight"));

    const calls: any[] = [];
    const r = await syncObsidian("pull", { vault, dbPath, remember: async (m) => { calls.push(m); } });
    expect(r.pull.ingested).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "loop:a1b2", tier: "learned", content: "gate persists via learned W_g weight" });
  });

  test("an unchanged note is skipped on pull (no spurious writes)", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    const calls: any[] = [];
    const r = await syncObsidian("pull", { vault, dbPath, remember: async (m) => { calls.push(m); } });
    expect(r.pull.ingested).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("a brand-new hand-authored note is ingested", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    writeFileSync(
      join(vault, "learned", "hand-note.md"),
      "---\nid: hand:note1\nns: manual\ntier: learned\nsource: \ncreated: 2026-07-21T00:00:00.000Z\ncreated_ms: 1784600000000\nhits: 0\ncontent_hash: sha1:0\ntags: [tier/learned, ns/manual]\n---\n\nhuman wrote this directly in Obsidian\n",
    );
    const calls: any[] = [];
    const r = await syncObsidian("pull", { vault, dbPath, remember: async (m) => { calls.push(m); } });
    expect(r.pull.ingested).toBe(1);
    expect(calls[0]).toMatchObject({ id: "hand:note1", ns: "manual", content: "human wrote this directly in Obsidian" });
  });
});

describe("non-destructive: deleted note re-materializes on push", () => {
  test("removing a note by hand does not erase the memory", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    const { rmSync } = await import("node:fs");
    rmSync(join(vault, "working", "work-tmp.md"));
    const r = await syncObsidian("push", { vault, dbPath });
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(true); // rebuilt
    expect(r.push.written).toBe(1); // only the missing one re-written
  });
});

describe("prune: memory consolidated out of brain removes its stale note (safe)", () => {
  test("a memory forgotten from the brain has its note pruned on push", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(true);
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    b.forget({ contains: "scratch note" }); // consolidated/evicted out of the brain
    b.close();
    const r = await syncObsidian("push", { vault, dbPath });
    expect(r.push.pruned).toBe(1);
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(false);
  });

  test("a human-authored note (never synced from brain) is NOT pruned", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    writeFileSync(
      join(vault, "learned", "human.md"),
      "---\nid: hand:x\nns: manual\ntier: learned\nsource: \ncreated: 2026-07-21T00:00:00.000Z\ncreated_ms: 1784600000000\nhits: 0\ncontent_hash: sha1:0\ntags: [tier/learned, ns/manual]\n---\n\nhuman note\n",
    );
    const r = await syncObsidian("push", { vault, dbPath });
    expect(existsSync(join(vault, "learned", "human.md"))).toBe(true); // preserved (no manifest entry)
    expect(r.push.pruned).toBe(0);
  });
});

describe("L26 — world-class Dalga-3: hubs + review + periodic rollups", () => {
  test("push emits hub notes (graph centrality), review queue, and weekly/monthly journal dirs", async () => {
    await seed(dbPath);
    // give core:emre two neighbors → it's the densest node → tops the hub list.
    const neighbors = () => new Map([["core:emre", ["loop:a1b2", "work:tmp"]], ["loop:a1b2", ["core:emre"]]]);
    await syncObsidian("push", { vault, dbPath, neighbors });
    const hubs = readFileSync(join(vault, "_index", "hubs.md"), "utf8");
    expect(hubs).toContain("Merkez düğümler");
    expect(hubs).toContain("[[core-emre]]");     // densest node surfaced
    expect(hubs).toContain("**2** bağ");          // its degree
    const review = readFileSync(join(vault, "_index", "review.md"), "utf8");
    expect(review).toContain("Gözden-geçirme");
    expect(existsSync(join(vault, "journal", "weekly"))).toBe(true);   // rollup dirs created
    expect(existsSync(join(vault, "journal", "monthly"))).toBe(true);
  });
});

describe("rich graph: dense linking + .obsidian config + MOC", () => {
  test("neighbor memories become [[wikilinks]] in the note (graph density)", async () => {
    await seed(dbPath);
    const neighbors = () => new Map([["core:emre", ["loop:a1b2"]]]);
    await syncObsidian("push", { vault, dbPath, neighbors });
    const note = readFileSync(join(vault, "core", "core-emre.md"), "utf8");
    expect(note).toContain("## Related");
    expect(note).toContain("[[loop-a1b2]]"); // linked to its nearest neighbor
  });

  test("entity mentioned in content becomes an [[entity-X]] link", async () => {
    await seed(dbPath); // facts: Emre operates ollamas ⇒ entities emre/ollamas/brain
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    const note = readFileSync(join(vault, "core", "core-emre.md"), "utf8");
    expect(note).toContain("[[entity-emre]]"); // "Emre is the sovereign operator" mentions emre
  });

  test("ships a .obsidian graph config with tier color groups", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    const graph = JSON.parse(readFileSync(join(vault, ".obsidian", "graph.json"), "utf8"));
    expect(graph.colorGroups.some((g: any) => g.query === "tag:#tier/core")).toBe(true);
    expect(graph.colorGroups.some((g: any) => g.query === "tag:#entity")).toBe(true);
    expect(existsSync(join(vault, ".obsidian", "core-plugins.json"))).toBe(true);
  });

  test("neighborsFromDb returns self-excluded neighbors from stored vectors", async () => {
    await seed(dbPath);
    const { neighborsFromDb } = await import("../server/brain-portable");
    const nb = neighborsFromDb(dbPath, 2);
    expect(nb.size).toBeGreaterThan(0);
    for (const [id, near] of nb) { expect(near).not.toContain(id); expect(near.length).toBeLessThanOrEqual(2); }
  });

  test("Home dashboard + Bases DB + per-tier index + CSS snippet shipped", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    const home = readFileSync(join(vault, "Home.md"), "utf8");
    expect(home).toContain("# 🧠 ollamas brain");
    expect(home).toContain("![[brain.base]]"); // embedded database
    expect(home).toContain("```dataview");
    // Obsidian Bases database file with multiple views
    const base = readFileSync(join(vault, "_index", "brain.base"), "utf8");
    expect(base).toContain("views:");
    expect(base).toContain("file.hasTag(\"tier/core\")");
    expect(base).toContain("name: Yüksek güven");
    // per-tier hub note
    expect(existsSync(join(vault, "_index", "tier-learned.md"))).toBe(true);
    // CSS snippet + it is enabled
    expect(existsSync(join(vault, ".obsidian", "snippets", "ollamas-brain.css"))).toBe(true);
    const app = JSON.parse(readFileSync(join(vault, ".obsidian", "appearance.json"), "utf8"));
    expect(app.enabledCssSnippets).toContain("ollamas-brain");
  });

  test("memory note carries readable alias + confidence, entity hub has Mentioned-in", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    const note = readFileSync(join(vault, "core", "core-emre.md"), "utf8");
    expect(note).toMatch(/aliases: \[/);
    expect(note).toContain("cssclasses: [brain, tier-core, system-ollamas]");
    const ent = readFileSync(join(vault, "entities", "entity-emre.md"), "utf8");
    expect(ent).toContain("## Mentioned in");
    expect(ent).toContain("degree:");
  });

  test("links change → note re-rendered (linksHash tracked)", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map([["core:emre", ["loop:a1b2"]]]) });
    const r = await syncObsidian("push", { vault, dbPath, neighbors: () => new Map([["core:emre", ["work:tmp"]]]) });
    expect(r.push.written).toBeGreaterThanOrEqual(1); // core-emre re-rendered for the new neighbor
    expect(readFileSync(join(vault, "core", "core-emre.md"), "utf8")).toContain("[[work-tmp]]");
  });
});

describe("tier move: one memory = exactly one note (no cross-tier duplicate)", () => {
  test("a memory that changes tier leaves no stale note in the old tier folder", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(true);
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "work:tmp", tier: "learned", content: "scratch note promoted" }); // same id, new tier
    b.close();
    await syncObsidian("push", { vault, dbPath });
    expect(existsSync(join(vault, "working", "work-tmp.md"))).toBe(false); // old-tier note removed
    expect(existsSync(join(vault, "learned", "work-tmp.md"))).toBe(true);  // new-tier note present
  });
});

describe("status", () => {
  test("reports note counts, entities, and zero drift after a full push", async () => {
    await seed(dbPath);
    await syncObsidian("push", { vault, dbPath });
    const s = obsidianStatus({ vault, dbPath });
    expect(s.exists).toBe(true);
    expect(s.brainMemories).toBe(3);
    expect(s.notes.core + s.notes.learned + s.notes.working).toBe(3);
    expect(s.drift).toBe(0);
    expect(s.entities).toBeGreaterThanOrEqual(2);
    expect(s.lastSync).toBeTypeOf("number");
  });
});
