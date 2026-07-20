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
    expect(existsSync(join(vault, "_index", "MOC.md"))).toBe(true);
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
    writeFileSync(file, readFileSync(file, "utf8").replace("gate persists via W_g store", "gate persists via learned W_g weight"));

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
