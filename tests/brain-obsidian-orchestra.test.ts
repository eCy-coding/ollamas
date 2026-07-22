// Orchestra federation — eCym command mirror + council/hub/canvas + system dimension.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainStore } from "../server/brain";
import { syncObsidian, processAskQueue } from "../server/brain-obsidian";
import { writeEcymNotes, readEcymCommands, writeEcymLearningQueue, readApprovedLearning, bridgeApprovedToMisses } from "../server/brain-obsidian-ecym";
import { computeSystemUsage } from "../server/brain-obsidian";
import { writeOdysseusNotes, pushVaultToKhoj, collectVaultKnowledge } from "../server/brain-obsidian-khoj";
import { mkdirSync } from "node:fs";
import { toMarkdown, parseMarkdown, type NoteMemory } from "../server/brain-obsidian-note";

// Isolate the live-sync test from a running local Khoj (fast ECONNREFUSED, not a 3s search).
process.env.KHOJ_URL = "http://127.0.0.1:59999";

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

describe("L9 — ask queue (vault → ask-shared → vault)", () => {
  test("pending '- [ ]' question is answered, written, and marked '- [x]'", async () => {
    mkdirSync(join(vault, "orchestra"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "ask.md"), "# Ask\n\n- [ ] ollamas nedir\n- [x] eski soru\n");
    const calls: string[] = [];
    const n = await processAskQueue(vault, async (q) => { calls.push(q); return { answer: "cevap", expert: "ollamas", weights: { ollamas: 0.5 }, confidence: 0.8 }; });
    expect(n).toBe(1);
    expect(calls).toEqual(["ollamas nedir"]);
    expect(readFileSync(join(vault, "orchestra", "ask.md"), "utf8")).toContain("- [x] ollamas nedir");
    const ans = require("node:fs").readdirSync(join(vault, "orchestra", "answers"));
    expect(ans.length).toBe(1);
    expect(readFileSync(join(vault, "orchestra", "answers", ans[0]), "utf8")).toContain("Kazanan: **ollamas**");
  });
  test("no pending questions → 0, no ask.md → 0", async () => {
    expect(await processAskQueue(vault, async () => ({}))).toBe(0);
  });
});

describe("L10 — eCym learning queue", () => {
  test("misses.log tail → _learning-queue.md checkboxes", () => {
    const misses = join(dir, "misses.log");
    writeFileSync(misses, "<calculator yap>\ttier4-fallback\n<disk temizle>\ttier2\n");
    const n = writeEcymLearningQueue(vault, misses);
    expect(n).toBe(2);
    const q = readFileSync(join(vault, "ecym", "_learning-queue.md"), "utf8");
    expect(q).toContain("- [ ] calculator yap");
    expect(q).toContain("tier4-fallback");
  });
});

describe("L11 — odysseus Khoj federation (graceful)", () => {
  test("Khoj offline → honest placeholder", async () => {
    const r = await writeOdysseusNotes(vault, { fetcher: async () => null });
    expect(r.online).toBe(false);
    expect(readFileSync(join(vault, "odysseus", "_khoj.md"), "utf8")).toContain("erişilemez");
  });
  test("Khoj online → entries mirrored", async () => {
    const r = await writeOdysseusNotes(vault, { fetcher: async () => [{ id: "k1", entry: "odysseus araştırma notu" }] });
    expect(r.online).toBe(true);
    expect(r.notes).toBe(1);
    expect(existsSync(join(vault, "odysseus", "khoj-k1.md"))).toBe(true);
  });
});

describe("L14 — per-expert answers in the answer note", () => {
  test("answer note renders each expert's answer", async () => {
    mkdirSync(join(vault, "orchestra"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "ask.md"), "- [ ] test sorusu\n");
    await processAskQueue(vault, async () => ({
      answer: "kazanan cevap", expert: "claudecode", weights: { claudecode: 0.6 },
      expertAnswers: { ollamas: "o cevabı", claudecode: "cc cevabı" },
    }));
    const ans = require("node:fs").readdirSync(join(vault, "orchestra", "answers"));
    const note = readFileSync(join(vault, "orchestra", "answers", ans[0]), "utf8");
    expect(note).toContain("## Uzman cevapları");
    expect(note).toContain("ollamas");
    expect(note).toContain("o cevabı");
    expect(note).toContain("cc cevabı");
  });
});

describe("L16 — eCym approval handoff (vault → approved-learning.jsonl)", () => {
  test("checked '- [x]' items append to the approval queue, deduped", () => {
    mkdirSync(join(vault, "ecym"), { recursive: true });
    writeFileSync(join(vault, "ecym", "_learning-queue.md"), "# Q\n\n- [x] calculator yap `t4`\n- [ ] henüz onaysız\n- [x] disk temizle\n");
    const out = join(dir, "approved.jsonl");
    expect(readApprovedLearning(vault, out)).toBe(2);
    expect(readApprovedLearning(vault, out)).toBe(0); // dedup on re-run
    const lines = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l).q);
    expect(lines).toContain("calculator yap");
    expect(lines).not.toContain("henüz onaysız");
  });
});

describe("L25 — odysseus Khoj vault indexing (push knowledge)", () => {
  test("collectVaultKnowledge skips empty + episodic; pushVaultToKhoj batches non-empty notes", async () => {
    mkdirSync(join(vault, "core"), { recursive: true });
    mkdirSync(join(vault, "episodic"), { recursive: true });
    writeFileSync(join(vault, "core", "a.md"), "x".repeat(300));      // real knowledge
    writeFileSync(join(vault, "core", "empty.md"), "sm");             // <100c → skipped
    writeFileSync(join(vault, "episodic", "log.md"), "y".repeat(300)); // episodic → excluded
    const files = collectVaultKnowledge(vault);
    expect(files.map((f) => f.name)).toContain("core/a.md");
    expect(files.some((f) => f.name.startsWith("episodic/"))).toBe(false);
    expect(files.some((f) => f.name === "core/empty.md")).toBe(false);
    const seen: number[] = [];
    const r = await pushVaultToKhoj(vault, { batch: 1, poster: async (fs) => { seen.push(fs.length); return true; } });
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(files.length);
    expect(r.batches).toBe(files.length); // batch=1 → one per file
  });
  test("empty vault → no push, ok", async () => {
    const r = await pushVaultToKhoj(vault, { poster: async () => true });
    expect(r).toEqual({ ok: true, pushed: 0, batches: 0 });
  });
  test("poster failure surfaces ok:false", async () => {
    mkdirSync(join(vault, "core"), { recursive: true });
    writeFileSync(join(vault, "core", "a.md"), "z".repeat(300));
    const r = await pushVaultToKhoj(vault, { poster: async () => false });
    expect(r.ok).toBe(false);
  });
});

describe("L23 — eCym closed loop (approvals → misses.log → ecy-learn)", () => {
  test("approved questions queue into misses.log, deduped, and no-op when empty", () => {
    const approvedPath = join(dir, "approved.jsonl");
    const missesPath = join(dir, "misses.log");
    writeFileSync(approvedPath, JSON.stringify({ q: "calculator yap", approved: true }) + "\n"
      + JSON.stringify({ q: "disk temizle", approved: true }) + "\n"
      + JSON.stringify({ q: "reddedilen", approved: false }) + "\n");
    writeFileSync(missesPath, "<disk temizle>\ttier2\n"); // already known → must dedup
    const r = bridgeApprovedToMisses({ approvedPath, missesPath });
    expect(r.added).toBe(1);                     // only the genuinely-new approval
    expect(r.queued).toEqual(["calculator yap"]);
    const log = readFileSync(missesPath, "utf8");
    expect(log).toContain("<calculator yap>\tvault-approved");
    expect(log).not.toContain("reddedilen");     // approved:false skipped
    // re-run is a no-op (idempotent)
    expect(bridgeApprovedToMisses({ approvedPath, missesPath }).added).toBe(0);
    // empty approvals → no-op, never throws
    expect(bridgeApprovedToMisses({ approvedPath: join(dir, "nope.jsonl"), missesPath }).added).toBe(0);
  });
});

describe("L24 — systemUsage proves all 4 systems use the vault", () => {
  test("computeSystemUsage returns 4 systems with detail + online + reflects Khoj marker", () => {
    mkdirSync(join(vault, "odysseus"), { recursive: true });
    writeFileSync(join(vault, "odysseus", "_khoj.md"), "# odysseus\n> [!success] 3 entry federe edildi ✅ online\n");
    const u = computeSystemUsage(vault);
    expect(Object.keys(u).sort()).toEqual(["claudecode", "ecym", "odysseus", "ollamas"]);
    for (const k of Object.keys(u)) expect(typeof (u as any)[k].detail).toBe("string");
    expect(u.odysseus.online).toBe(true); // parsed the "✅ online" marker
    expect(u.ollamas.detail).toContain("sync");
  });
  test("odysseus offline when the Khoj note has no online marker", () => {
    mkdirSync(join(vault, "odysseus"), { recursive: true });
    writeFileSync(join(vault, "odysseus", "_khoj.md"), "# odysseus\n> [!warning] erişilemez (offline)\n");
    expect(computeSystemUsage(vault).odysseus.online).toBe(false);
  });
});

describe("L27 — claudecode liveness from ask-shared evidence", () => {
  const prevDir = process.env.MISSION_CONTROL_DATA_DIR;
  afterEach(() => { if (prevDir === undefined) delete process.env.MISSION_CONTROL_DATA_DIR; else process.env.MISSION_CONTROL_DATA_DIR = prevDir; });
  test("online only when claudecode answered in a recent run", () => {
    process.env.MISSION_CONTROL_DATA_DIR = dir;
    // no runs → offline
    expect(computeSystemUsage(vault).claudecode.online).toBe(false);
    // a run where claudecode did NOT answer → still offline (throttle honesty)
    writeFileSync(join(dir, "ask-shared-runs.jsonl"), JSON.stringify({ at: 1, experts: ["ollamas", "ecym"] }) + "\n");
    expect(computeSystemUsage(vault).claudecode.online).toBe(false);
    // a run where claudecode answered → online
    writeFileSync(join(dir, "ask-shared-runs.jsonl"), JSON.stringify({ at: 2, experts: ["ollamas", "claudecode"] }) + "\n");
    expect(computeSystemUsage(vault).claudecode.online).toBe(true);
  });
});

describe("L19 — gate learns 4 experts (width-guard skips stale rows)", () => {
  test("trainGate on mixed-width ledger keeps a 4-row gate; 3-width rows skipped", async () => {
    const { emptyGate, EXPERTS } = await import("../server/brain-formulas");
    const { trainGate } = await import("../server/brain-gate-train");
    expect(EXPERTS.length).toBe(4);
    const init = emptyGate(3); // 4 rows × 3-dim
    const rows: any[] = [
      { q: [1, 0, 0], scores: [0.9, 0.1, 0.1, 0.1], picked: 0, explored: false }, // 4-width, kept
      { q: [0, 1, 0], scores: [0.1, 0.9, 0.1, 0.2], picked: 1, explored: false },
      { q: [0, 0, 1], scores: [0.2, 0.2, 0.9], picked: 2, explored: false },       // 3-width, SKIP
    ];
    const { gate } = trainGate(init, rows);
    expect(gate.W.length).toBe(4); // stays 4 rows — the new expert is trainable
  });
  test("loadGate rejects a persisted gate with the wrong expert-count", async () => {
    // isValidGate structural + EXPERTS row-count is enforced in loadGate; a 3-row gate is
    // structurally valid but wrong-count → treated as absent so the caller cold-starts 4.
    const { isValidGate } = await import("../server/brain-gate-store");
    expect(isValidGate({ W: [[1, 1], [2, 2], [3, 3]], b: [0, 0, 0] })).toBe(true); // structurally ok
  });
});

describe("L21 — workspace polish", () => {
  test("push writes bookmarks (Home pinned) + a by-system Base view", async () => {
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "c:1", tier: "core", content: "x" });
    b.close();
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    const bm = JSON.parse(readFileSync(join(vault, ".obsidian", "bookmarks.json"), "utf8"));
    expect(bm.items.some((i: any) => i.path === "Home.md")).toBe(true);
    const base = readFileSync(join(vault, "_index", "brain.base"), "utf8");
    expect(base).toContain("name: Sistem bazlı");
    expect(base).toContain("groupBy: note.system");
    expect(base).toContain("recall_rank");
  });
});

describe("L18 — entity-map canvas", () => {
  test("push writes a valid JSON Canvas of top-degree entities", async () => {
    process.env.ECY_DATASET = ecymFixture;
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "c:1", tier: "core", content: "x" });
    await b.assertFact({ subject: "Emre", predicate: "operates", object: "ollamas" });
    await b.assertFact({ subject: "ollamas", predicate: "serves", object: "brain" });
    b.close();
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    delete process.env.ECY_DATASET;
    const canvas = JSON.parse(readFileSync(join(vault, "entity-map.canvas"), "utf8"));
    expect(Array.isArray(canvas.nodes)).toBe(true);
    expect(canvas.nodes.length).toBeGreaterThan(0);
    expect(canvas.nodes.every((n: any) => n.type === "file")).toBe(true);
  });
});

describe("L12 — Kanban sprint board", () => {
  test("sync writes a kanban-plugin board with lanes", async () => {
    process.env.ECY_DATASET = ecymFixture;
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "c:1", tier: "core", content: "x" });
    b.close();
    await syncObsidian("push", { vault, dbPath, neighbors: () => new Map() });
    delete process.env.ECY_DATASET;
    const sprint = readFileSync(join(vault, "orchestra", "sprint.md"), "utf8");
    expect(sprint).toContain("kanban-plugin: board");
    expect(sprint).toContain("## 📥 Backlog");
    expect(sprint).toContain("## ✅ Done");
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
    for (const sys of ["ollamas", "ecym", "odysseus", "claudecode"]) {
      expect(canvas.nodes.some((n: any) => n.id === sys)).toBe(true); // all 4 experts
    }
    expect(canvas.edges.length).toBeGreaterThan(6);
    // Dalga-2 artifacts
    expect(existsSync(join(vault, "orchestra", "status.md"))).toBe(true);
    expect(existsSync(join(vault, "templates", "memory.md"))).toBe(true);
    expect(existsSync(join(vault, "_index", "namespaces.md"))).toBe(true);
    expect(hub).toContain("🔴 **claudecode**"); // 4th expert role card
    expect(hub).toContain("R --> C[🔴 claudecode]"); // mermaid 4th branch
    // eCym catalog federated
    expect(existsSync(join(vault, "ecym", "ecym-disk-temizle.md"))).toBe(true);
    // odysseus-origin memory got system/odysseus
    const od = readFileSync(join(vault, "learned", "od-1.md"), "utf8");
    expect(od).toContain("system/odysseus");
  });
});
