// L27 human capture — the on-ramp that was missing. Before this, a note typed straight into
// Obsidian was invisible to the brain forever (pull only read TIER folders, and only notes
// that already carried a brain id). These tests pin the adoption rules and, above all, the
// ordering that makes reaping the loose original safe.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainStore } from "../server/brain";
import { syncObsidian } from "../server/brain-obsidian";
import { adoptHumanNote, noteFilename, toMarkdown, ROOT_RESERVED, type NoteMemory } from "../server/brain-obsidian-note";

// Keep a live local Khoj out of the sync path (fast ECONNREFUSED, not a 3s search).
process.env.KHOJ_URL = "http://127.0.0.1:59999";

const fakeEmbed = async (t: string) => { const v = [0, 0, 0]; v[t.length % 3] = 1; return v; };
let dir: string, vault: string, dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "obs-capture-"));
  vault = join(dir, "vault");
  dbPath = join(dir, "brain.db");
  mkdirSync(vault, { recursive: true });
});

describe("adoptHumanNote (pure)", () => {
  test("a plain hand-typed note becomes an episodic memory attributed to the human", () => {
    const m = adoptHumanNote("Toplantı notu.md", "iPhone tüneli için sertifika pinlemesi gerek")!;
    expect(m.tier).toBe("episodic");
    expect(m.source).toBe("human/obsidian");
    expect(m.actor).toBe("emre");
    expect(m.content).toBe("iPhone tüneli için sertifika pinlemesi gerek");
  });

  test("id derives from the FILE, so editing updates one memory instead of spawning many", () => {
    const a = adoptHumanNote("Toplantı notu.md", "ilk hâli")!;
    const b = adoptHumanNote("Toplantı notu.md", "düzeltilmiş hâli")!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe("obsidian-toplant-notu");
    // A different file is a different thought.
    expect(adoptHumanNote("başka.md", "ilk hâli")!.id).not.toBe(a.id);
  });

  test("an empty or whitespace-only note is not a thought", () => {
    expect(adoptHumanNote("202607221109.md", "")).toBeNull();
    expect(adoptHumanNote("boş.md", "   \n\n  ")).toBeNull();
    expect(adoptHumanNote("sadece-fm.md", "---\ntags: [x]\n---\n\n")).toBeNull();
  });

  test("human-declared frontmatter wins over the defaults", () => {
    const m = adoptHumanNote("karar.md", "---\ntier: learned\nns: proje\nsource: toplantı\n---\n\nKarar verildi")!;
    expect(m.tier).toBe("learned");
    expect(m.ns).toBe("proje");
    expect(m.source).toBe("toplantı");
    expect(m.content).toBe("Karar verildi");
  });

  test("an invalid tier falls back rather than corrupting the store", () => {
    expect(adoptHumanNote("x.md", "---\ntier: nonsense\n---\n\ngövde")!.tier).toBe("episodic");
  });

  test("a note that is already a brain mirror is left to the normal pull path", () => {
    const mem: NoteMemory = {
      id: "core:emre", ns: "default", tier: "core", content: "kimlik",
      source: "seed", createdAt: 1700000000000, hits: 3,
    };
    expect(adoptHumanNote(noteFilename(mem.id), toMarkdown(mem, []))).toBeNull();
  });
});

describe("capture round-trip through the real sync", () => {
  const sync = async (direction: "both" | "pull" | "push" = "both") => {
    const store = createBrainStore({ dbPath, embed: fakeEmbed });
    try {
      return await syncObsidian(direction, {
        vault, dbPath,
        remember: async (m) => store.remember(m as any),
        neighbors: () => new Map(),
      });
    } finally { store.close?.(); }
  };

  test("a note dropped in the vault root reaches the brain and is filed under its tier", async () => {
    writeFileSync(join(vault, "fikir.md"), "tünel için sertifika pinle");
    const r = await sync();
    expect(r.pull.ingested).toBe(1);

    const filed = join(vault, "episodic", noteFilename("obsidian-fikir"));
    expect(existsSync(filed), "capture should be materialised under its tier").toBe(true);
    expect(readFileSync(filed, "utf8")).toContain("tünel için sertifika pinle");
    // The loose original is reaped ONLY because the tier note now exists.
    expect(existsSync(join(vault, "fikir.md"))).toBe(false);
    expect(r.push.adopted).toBe(1);
  });

  test("inbox/ works the same as the root", async () => {
    mkdirSync(join(vault, "inbox"), { recursive: true });
    writeFileSync(join(vault, "inbox", "sesli.md"), "sesli not transkripti");
    const r = await sync();
    expect(r.pull.ingested).toBe(1);
    expect(existsSync(join(vault, "episodic", noteFilename("obsidian-sesli")))).toBe(true);
    expect(existsSync(join(vault, "inbox", "sesli.md"))).toBe(false);
  });

  test("re-syncing does not re-ingest — one capture stays one memory", async () => {
    writeFileSync(join(vault, "fikir.md"), "tek bir düşünce");
    const first = await sync();
    expect(first.pull.ingested).toBe(1);
    const second = await sync();
    expect(second.pull.ingested).toBe(0);
    expect(second.memories).toBe(first.memories);
  });

  test("a pull-only sync never reaps: nothing was mirrored, so the original must survive", async () => {
    writeFileSync(join(vault, "fikir.md"), "yalnız pull");
    const r = await sync("pull");
    expect(r.pull.ingested).toBe(1);
    expect(existsSync(join(vault, "fikir.md")), "no push happened — do not delete the human's file").toBe(true);
  });

  test("blank notes left behind by a mis-click are skipped, not ingested", async () => {
    for (const f of ["202607221109.md", "202607221110.md"]) writeFileSync(join(vault, f), "");
    const r = await sync();
    expect(r.pull.ingested).toBe(0);
    expect(r.pull.skipped).toBeGreaterThanOrEqual(2);
  });

  test("generated furniture in the root is never mistaken for human input", async () => {
    await sync(); // materialises Home.md / README.md
    for (const f of ROOT_RESERVED) {
      if (!existsSync(join(vault, f))) continue;
      const r = await sync();
      expect(r.pull.ingested, `${f} must not be adopted`).toBe(0);
    }
  });

  test("existing brain notes keep flowing through the original pull path (no regression)", async () => {
    const store = createBrainStore({ dbPath, embed: fakeEmbed });
    await store.remember({ id: "learned:x", tier: "learned", content: "orijinal içerik" } as any);
    store.close?.();
    await sync(); // mirror it out

    const note = join(vault, "learned", noteFilename("learned:x"));
    writeFileSync(note, readFileSync(note, "utf8").replaceAll("orijinal içerik", "elle düzeltildi"));
    const r = await sync();
    expect(r.pull.ingested).toBe(1);
    expect(readFileSync(note, "utf8")).toContain("elle düzeltildi");
  });
});
