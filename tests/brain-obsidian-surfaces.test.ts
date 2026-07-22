// The vault surfaces ollamas and eCym actually USE.
//
// Measured 2026-07-22 before writing any of this: the vault held 221 eCym command notes with
// rich, consistent frontmatter (level / safe / id / system) and NOT ONE database view over
// them — `_index/brain.base` is deliberately scoped to tier-tagged memories, so the eCym
// catalog, the 305 entity notes and the journal rollups were all invisible to Bases.
//
// These writers close that. They are code-generated for a reason that was also measured:
// a base hand-placed in the vault gets swept into _index/attic by sweepEmptyShells() unless
// it declares real structure, and the five "Başlıksız" files sitting in attic are exactly
// that mistake already made once.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEcymBase, writeEcymHub, writeEcymNotes, ecymSplit } from "../server/brain-obsidian-ecym";
import {
  writeEntitiesBase, writeJournalBase, mergeBookmarks, isAbandonedShell,
} from "../server/brain-obsidian";

let dir: string, vault: string, ecymFixture: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "surf-"));
  vault = join(dir, "vault");
  mkdirSync(join(vault, "_index"), { recursive: true });
  ecymFixture = join(dir, "ecym-dataset.json");
  writeFileSync(ecymFixture, JSON.stringify({
    _meta: { v: 1 },
    commands: [
      { id: "disk-temizle", level: "orta", triggers: ["disk temizle"], cmd: "ncdu", arg: "~", desc: "Disk analizi", safe: true },
      { id: "kill-port", level: "ileri", triggers: ["portu kapat"], cmd: "lsof", arg: "-ti:3000 | xargs kill", desc: "Port öldür", safe: false },
      { id: "acik", level: "baslangic", triggers: ["aç"], cmd: "open", arg: "-a X", desc: "Uygulama aç", safe: true },
    ],
  }));
});

// A base is only useful if Obsidian keeps it. sweepEmptyShells() moves any .base without
// real structure into _index/attic, so every generated base must declare it.
const survivesSweep = (yaml: string): boolean => !isAbandonedShell("x.base", yaml);

describe("ecym.base — the catalog finally gets a database", () => {
  test("is written where Home can embed it and is not an empty shell", () => {
    writeEcymBase(vault);
    const p = join(vault, "_index", "ecym.base");
    expect(existsSync(p)).toBe(true);
    const yaml = readFileSync(p, "utf8");
    expect(yaml).toContain("filters:");
    expect(survivesSweep(yaml)).toBe(true);   // would otherwise end up in attic
  });

  test("is scoped to eCym notes only — memories must not leak into the catalog", () => {
    writeEcymBase(vault);
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    expect(yaml).toContain('file.hasTag("system/ecym")');
    expect(yaml).not.toContain("tier/");
  });

  test("carries the views the catalog is actually browsed by", () => {
    writeEcymBase(vault);
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    for (const view of ["Tümü", "Seviye", "Gated", "Güvenli", "Kartlar"]) {
      expect(yaml).toContain(view);
    }
    expect(yaml).toContain("property: note.level");
  });

  test("the gated view selects the dangerous half, the safe view the other", () => {
    writeEcymBase(vault);
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    // safe is normalized to a real boolean by writeEcymNotes, so the filter must compare to one.
    expect(yaml).toContain("note.safe == false");
    expect(yaml).toContain("note.safe == true");
  });

  test("the properties it renames are the ones the notes actually have", () => {
    writeEcymNotes(vault, ecymFixture);
    writeEcymBase(vault);
    const note = readFileSync(join(vault, "ecym", "ecym-kill-port.md"), "utf8");
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    for (const prop of ["level", "safe", "id"]) {
      expect(note).toContain(`${prop}:`);          // the note really carries it
      expect(yaml).toContain(`note.${prop}:`);     // the base really renames it
    }
  });
});

describe("eCym hub — the human entry point", () => {
  test("counts come from the notes on disk, not from a hardcoded number", () => {
    const n = writeEcymNotes(vault, ecymFixture);
    writeEcymHub(vault, n);
    const hub = readFileSync(join(vault, "ecym", "eCym.md"), "utf8");
    expect(hub).toContain("3");
    expect(hub).toContain("![[ecym.base]]");
  });

  test("splits gated from safe so the risky half is visible at a glance", () => {
    writeEcymNotes(vault, ecymFixture);
    writeEcymHub(vault, 3, { gated: 1, safe: 2 });
    const hub = readFileSync(join(vault, "ecym", "eCym.md"), "utf8");
    expect(hub).toMatch(/gated/i);
    expect(hub).toContain("1");
  });

  test("embeds a Tasks query so the learning queue is a board, not a flat list", () => {
    writeEcymHub(vault, 0);
    const hub = readFileSync(join(vault, "ecym", "eCym.md"), "utf8");
    expect(hub).toContain("```tasks");
    expect(hub).toContain("not done");
    expect(hub).toContain("path includes ecym");
  });

  test("links back to Home so the vault graph stays connected", () => {
    writeEcymHub(vault, 0);
    expect(readFileSync(join(vault, "ecym", "eCym.md"), "utf8")).toContain("[[Home]]");
  });

  test("an empty catalog still produces a valid hub rather than throwing", () => {
    writeEcymHub(vault, 0);
    expect(existsSync(join(vault, "ecym", "eCym.md"))).toBe(true);
  });
});

describe("ecymSplit — the gated/safe counts the hub prints", () => {
  test("counts from the dataset, honouring the Python-repr strings it contains", () => {
    // The dataset stores `safe` inconsistently; a naive truthy check calls "False" safe.
    const cmds = [
      { id: "a", level: "orta", triggers: [], cmd: "x", arg: "", desc: "", safe: true },
      { id: "b", level: "orta", triggers: [], cmd: "x", arg: "", desc: "", safe: false },
      { id: "c", level: "orta", triggers: [], cmd: "x", arg: "", desc: "", safe: "False" as any },
    ];
    expect(ecymSplit(cmds as any)).toEqual({ gated: 2, safe: 1 });
  });

  test("an empty catalog is zero/zero, not a crash", () => {
    expect(ecymSplit([])).toEqual({ gated: 0, safe: 0 });
  });
});

describe("entities.base — 305 notes brain.base deliberately excludes", () => {
  test("selects entity notes and ranks them by graph degree", () => {
    writeEntitiesBase(vault);
    const yaml = readFileSync(join(vault, "_index", "entities.base"), "utf8");
    expect(yaml).toContain('file.hasTag("entity")');
    expect(yaml).toContain("note.degree");
    expect(survivesSweep(yaml)).toBe(true);
  });

  test("has a hub view — the whole point is finding the connected few", () => {
    writeEntitiesBase(vault);
    const yaml = readFileSync(join(vault, "_index", "entities.base"), "utf8");
    expect(yaml).toMatch(/Hub/i);
    expect(yaml).toMatch(/note\.degree\s*>/);
  });
});

describe("journal.base — daily, weekly and monthly are different questions", () => {
  test("separates the three rollup levels by their own tags", () => {
    writeJournalBase(vault);
    const yaml = readFileSync(join(vault, "_index", "journal.base"), "utf8");
    expect(yaml).toContain('file.hasTag("journal")');
    expect(yaml).toContain("journal/weekly");
    expect(yaml).toContain("journal/monthly");
    expect(survivesSweep(yaml)).toBe(true);
  });
});

describe("groupBy schema — every generated base must be queryable", () => {
  // Obsidian's own parser (extracted from obsidian.asar) requires:
  //   if ("object" != typeof u || !Object.hasOwn(u,"property") || !Object.hasOwn(u,"direction")) throw
  // The shipped brain.base used the bare `groupBy: note.tier` form, so `obsidian base:query
  // file=brain.base` threw on EVERY run and two of its six views never rendered. Measured,
  // then fixed. This test is the reason it cannot come back.
  const bareGroupBy = /groupBy:[ \t]*\S/;   // a scalar on the same line = the broken form

  test("ecym.base groups by an object with property AND direction", () => {
    writeEcymBase(vault);
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    expect(yaml).not.toMatch(bareGroupBy);
    expect(yaml).toContain("property: note.level");
    expect(yaml).toMatch(/direction: (ASC|DESC)/);
  });

  test("brain.base — the pre-existing break — is fixed at the source", () => {
    const src = readFileSync(new URL("../server/brain-obsidian.ts", import.meta.url), "utf8");
    // Both grouped views (Katman bazlı, Sistem bazlı) must emit the object form.
    const emitted = src.match(/groupBy:\\n\s*property:/g) ?? [];
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/groupBy: note\.\w+/);
  });

  test("every direction value is one Obsidian accepts", () => {
    writeEcymBase(vault);
    const yaml = readFileSync(join(vault, "_index", "ecym.base"), "utf8");
    for (const m of yaml.matchAll(/direction:\s*(\S+)/g)) {
      expect(["ASC", "DESC"]).toContain(m[1]);
    }
  });
});

describe("the sync flow wires the surfaces together", () => {
  test("Home links to the eCym hub — an unlinked hub is an orphan in the graph", async () => {
    // Guards the one-character difference between "🟢 eCym 221 komut" (dead text, what it
    // was) and "🟢 [[eCym]] 221 komut" (a real edge Obsidian can follow).
    const src = readFileSync(new URL("../server/brain-obsidian.ts", import.meta.url), "utf8");
    expect(src).toContain("[[eCym]]");
  });

  test("every generated surface is bookmarked by the push flow", () => {
    const src = readFileSync(new URL("../server/brain-obsidian.ts", import.meta.url), "utf8");
    for (const p of ["ecym/eCym.md", "_index/ecym.base", "_index/entities.base", "_index/journal.base"]) {
      expect(src).toContain(p);
    }
  });

  test("the merge carries the ORIGINAL pins too — order must not be able to drop Home", () => {
    // bookmarks.json is also seeded by a write-once during config init. If this merge runs
    // first it creates the file, the write-once then skips, and anything only the write-once
    // knew about disappears. Caught by the existing L21 test the moment it happened.
    const src = readFileSync(new URL("../server/brain-obsidian.ts", import.meta.url), "utf8");
    const call = src.slice(src.indexOf("mergeBookmarks(vault, ["));
    const block = call.slice(0, call.indexOf("]);"));
    for (const p of ["Home.md", "orchestra/Orchestra.md", "_index/brain.base"]) {
      expect(block).toContain(p);
    }
  });
});

describe("mergeBookmarks — the operator's own bookmarks must survive", () => {
  const bmPath = (v: string) => join(v, ".obsidian", "bookmarks.json");
  const seed = (v: string, items: unknown) => {
    mkdirSync(join(v, ".obsidian"), { recursive: true });
    writeFileSync(bmPath(v), typeof items === "string" ? items : JSON.stringify({ items }));
  };

  test("adds the generated surfaces without dropping a hand-made bookmark", () => {
    seed(vault, [{ type: "file", path: "MyNote.md", title: "benim" }]);
    mergeBookmarks(vault, [{ type: "file", path: "_index/ecym.base", title: "eCym DB" }]);
    const items = JSON.parse(readFileSync(bmPath(vault), "utf8")).items;
    expect(items.map((i: any) => i.path)).toContain("MyNote.md");
    expect(items.map((i: any) => i.path)).toContain("_index/ecym.base");
  });

  test("is idempotent — running the sync twice does not duplicate an entry", () => {
    seed(vault, []);
    const add = [{ type: "file", path: "_index/ecym.base", title: "eCym DB" }];
    mergeBookmarks(vault, add);
    mergeBookmarks(vault, add);
    const items = JSON.parse(readFileSync(bmPath(vault), "utf8")).items;
    expect(items.filter((i: any) => i.path === "_index/ecym.base")).toHaveLength(1);
  });

  test("a user-retitled bookmark keeps the user's title", () => {
    seed(vault, [{ type: "file", path: "_index/ecym.base", title: "kendi başlığım" }]);
    mergeBookmarks(vault, [{ type: "file", path: "_index/ecym.base", title: "eCym DB" }]);
    const items = JSON.parse(readFileSync(bmPath(vault), "utf8")).items;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("kendi başlığım");
  });

  test("a corrupt bookmarks file is left untouched rather than overwritten", () => {
    seed(vault, "{ not json");
    mergeBookmarks(vault, [{ type: "file", path: "_index/ecym.base", title: "eCym DB" }]);
    expect(readFileSync(bmPath(vault), "utf8")).toBe("{ not json");
  });

  test("a vault with no bookmarks file yet gets one", () => {
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mergeBookmarks(vault, [{ type: "file", path: "_index/ecym.base", title: "eCym DB" }]);
    expect(JSON.parse(readFileSync(bmPath(vault), "utf8")).items).toHaveLength(1);
  });
});
