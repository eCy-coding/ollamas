// Orchestra federation — eCym command mirror + council/hub/canvas + system dimension.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainStore } from "../server/brain";
import { syncObsidian } from "../server/brain-obsidian";
import { writeEcymNotes, readEcymCommands } from "../server/brain-obsidian-ecym";
import { toMarkdown, parseMarkdown, type NoteMemory } from "../server/brain-obsidian-note";

const fakeEmbed = async (t: string) => { const v = [0, 0, 0]; v[t.length % 3] = 1; return v; };
let dir: string, vault: string, dbPath: string, ecymFixture: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orch-"));
  vault = join(dir, "vault");
  dbPath = join(dir, "brain.db");
  ecymFixture = join(dir, "ecym-dataset.json");
  writeFileSync(ecymFixture, JSON.stringify({
    _meta: { v: 1 },
    commands: [
      { id: "disk-temizle", level: "orta", triggers: ["disk temizle", "yer aç"], cmd: "ncdu", arg: "~", desc: "İnteraktif disk kullanım analizi ve temizlik", safe: true },
      { id: "kill-port", level: "ileri", triggers: ["portu kapat"], cmd: "lsof", arg: "-ti:3000 | xargs kill", desc: "3000 portundaki süreci öldür", safe: false },
      { id: "rm-tmp", level: "orta", triggers: ["temp sil"], cmd: "rm", arg: "-rf /tmp/x", desc: "Geçici sil", safe: "False" as any },
    ],
  }));
});

describe("eCym federation — command catalog → notes", () => {
  test("string 'False' safe normalizes to gated (not a truthy mislabel)", () => {
    writeEcymNotes(vault, ecymFixture);
    const note = readFileSync(join(vault, "ecym", "ecym-rm-tmp.md"), "utf8");
    expect(note).toContain("safe: false");     // normalized boolean
    expect(note).toContain("ecym/gated");
    expect(note).toContain("[!warning]");
  });
  test("reads the dataset and writes one note per command with system/ecym tag", () => {
    const n = writeEcymNotes(vault, ecymFixture);
    expect(n).toBe(3);
    expect(existsSync(join(vault, "ecym", "ecym-disk-temizle.md"))).toBe(true);
    const note = readFileSync(join(vault, "ecym", "ecym-disk-temizle.md"), "utf8");
    expect(note).toContain("system: ecym");
    expect(note).toContain("tags: [system/ecym");
    expect(note).toContain("```bash\nncdu ~\n```");   // command as code block
    expect(note).toContain("[!todo]");                 // safe → todo callout
  });
  test("gated (unsafe) command uses a warning callout", () => {
    writeEcymNotes(vault, ecymFixture);
    const note = readFileSync(join(vault, "ecym", "ecym-kill-port.md"), "utf8");
    expect(note).toContain("[!warning]");
  });
  test("readEcymCommands returns [] when the dataset is absent", () => {
    expect(readEcymCommands(join(dir, "nope.json"))).toEqual([]);
  });
});

describe("system dimension on ollamas memories", () => {
  const mem = (over: Partial<NoteMemory> = {}): NoteMemory => ({
    id: "loop:x", ns: "loop", tier: "learned", content: "gate persists", source: "brain-loop",
    createdAt: 1784000000000, hits: 1, ...over,
  });
  test("default system is ollamas; frontmatter + tag + cssclass carry it", () => {
    const p = parseMarkdown(toMarkdown(mem({ system: "ollamas" })));
    expect(p.frontmatter.system).toBe("ollamas");
    expect(p.frontmatter.tags).toContain("system/ollamas");
    expect(p.frontmatter.cssclasses).toContain("system-ollamas");
  });
  test("odysseus-origin memory tagged system/odysseus", () => {
    const md = toMarkdown(mem({ system: "odysseus" }));
    expect(md).toContain("system: odysseus");
    expect(md).toContain("system/odysseus");
  });
});

describe("orchestra artifacts via live sync (council + hub + canvas)", () => {
  async function seed() {
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "core:emre", tier: "core", content: "Emre operates ollamas" });
    await b.remember({ id: "od:1", tier: "learned", content: "odysseus research", source: "brain-loop", actor: "odysseus" });
    b.close();
  }
  test("push writes Orchestra hub, council mirror, and a valid JSON Canvas", async () => {
    await seed();
    process.env.ECY_DATASET = ecymFixture;
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    delete process.env.ECY_DATASET;
    expect(existsSync(join(vault, "orchestra", "Orchestra.md"))).toBe(true);
    expect(existsSync(join(vault, "orchestra", "council.md"))).toBe(true);
    const hub = readFileSync(join(vault, "orchestra", "Orchestra.md"), "utf8");
    expect(hub).toContain("```mermaid");           // ask-shared flow diagram
    expect(hub).toContain("![[orchestra.canvas]]");
    // Canvas must be valid JSON Canvas with nodes + edges
    const canvas = JSON.parse(readFileSync(join(vault, "orchestra.canvas"), "utf8"));
    expect(Array.isArray(canvas.nodes)).toBe(true);
    expect(canvas.nodes.some((n: any) => n.id === "ollamas")).toBe(true);
    expect(canvas.nodes.some((n: any) => n.id === "ecym")).toBe(true);
    expect(canvas.nodes.some((n: any) => n.id === "odysseus")).toBe(true);
    expect(canvas.edges.length).toBeGreaterThan(4);
    // eCym catalog federated
    expect(existsSync(join(vault, "ecym", "ecym-disk-temizle.md"))).toBe(true);
    // odysseus-origin memory got system/odysseus
    const od = readFileSync(join(vault, "learned", "od-1.md"), "utf8");
    expect(od).toContain("system/odysseus");
  });
});
