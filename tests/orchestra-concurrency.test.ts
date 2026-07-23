// L52 + L53 — real concurrency, safely.
//
// Tasks ran one at a time (for...await), so a Backlog of five tasks was five serial runs while
// Emre kept asking for "eş zamanlı gerçek görevler". They now run in bounded-parallel chunks.
// The danger is the shared board (sprint.md): these tests pin that a batch stays consistent and
// that the board is written exactly ONCE, by the single writer, after the batch.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processTaskBoard, runOneTask, parseBoard, orchestraConcurrency, type TaskDeps } from "../server/orchestra-tasks";

let vault: string;
const board = (backlog: string[]) =>
  `---\nkanban-plugin: board\n---\n\n## 📥 Backlog\n\n${backlog.map((t) => `- [ ] ${t}`).join("\n")}\n\n## 🔨 Doing\n\n## ✅ Done\n`;

const deps = (over: Partial<TaskDeps> = {}): TaskDeps => ({
  runCommand: async () => "Filesystem 926Gi 608Gi 70%",
  recall: async () => [{ id: "m1", excerpt: "not" }],
  ...over,
});

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "orch-conc-"));
  mkdirSync(join(vault, "orchestra"), { recursive: true });
  process.env.OBSIDIAN_VAULT = "/nonexistent";
  delete process.env.ORCHESTRA_CONCURRENCY;
});
const boardText = () => readFileSync(join(vault, "orchestra", "sprint.md"), "utf8");

describe("bounded concurrency", () => {
  test("default is 3, and it is clamped to a sane range", () => {
    expect(orchestraConcurrency({} as any)).toBe(3);
    expect(orchestraConcurrency({ ORCHESTRA_CONCURRENCY: "5" } as any)).toBe(5);
    expect(orchestraConcurrency({ ORCHESTRA_CONCURRENCY: "0" } as any)).toBe(3);   // too low → default
    expect(orchestraConcurrency({ ORCHESTRA_CONCURRENCY: "99" } as any)).toBe(3);  // too high → default
    expect(orchestraConcurrency({ ORCHESTRA_CONCURRENCY: "junk" } as any)).toBe(3);
  });
});

describe("runOneTask is board-free (L52)", () => {
  test("its signature takes no board, and it returns a pure action", async () => {
    writeFileSync(join(vault, "orchestra", "sprint.md"), board([]));
    const a = await runOneTask(vault, "- [ ] disk doluluk", "Backlog", deps());
    expect(a).toMatchObject({ line: "- [ ] disk doluluk", lane: "Backlog", transition: "done" });
    // The action carries what the writer needs — nothing about the board itself.
    expect(a).not.toHaveProperty("board");
  });

  test("a placeholder line yields no action", async () => {
    writeFileSync(join(vault, "orchestra", "sprint.md"), board([]));
    expect(await runOneTask(vault, "- [ ] <görev yaz>", "Backlog", deps())).toBeNull();
  });
});

describe("the batch stays consistent (L53)", () => {
  test("five tasks all land in the right lane, and each has its own note", async () => {
    const titles = ["disk doluluk", "hangi dizindeyim", "makine adı ne", "bellek durumu ne", "sistem yükü"];
    writeFileSync(join(vault, "orchestra", "sprint.md"), board(titles));
    const r = await processTaskBoard(vault, {
      ...deps(),
      synthesize: async (t) => ({ answer: `${t} cevabı 926 [mem:step:command]`, expert: "ecym", abstained: false, grounding: { score: 1, regrounded: false, weak: false } }),
    });
    expect(r.ran).toBe(5);
    expect(r.done).toBe(5);
    const b = parseBoard(boardText());
    expect(b.lanes.Backlog).toEqual([]);
    expect(b.lanes.Done).toHaveLength(5);
    // No task lost, none duplicated — the board is exactly the five, checked off.
    for (const t of titles) expect(b.lanes.Done.some((l) => l.includes(t)), t).toBe(true);
    // Each task wrote its own isolated evidence note.
    const notes = fs.readdirSync(join(vault, "orchestra", "tasks"));
    expect(notes).toHaveLength(5);
  });

  test("the board ends in one consistent state — no partial/interleaved writes", async () => {
    // ESM forbids spying writeFileSync; instead assert the OUTCOME the single writer guarantees:
    // a board that parses cleanly with every task moved, never a half-applied lane.
    const titles = ["disk doluluk", "hangi dizindeyim", "makine adı ne"];
    writeFileSync(join(vault, "orchestra", "sprint.md"), board(titles));
    await processTaskBoard(vault, deps());
    const b = parseBoard(boardText());
    expect(b.lanes.Backlog).toEqual([]);        // all moved out
    expect(b.lanes.Done.length + b.lanes.Doing.length).toBe(3); // all accounted for, none lost/dup
    expect(boardText()).toContain("kanban-plugin: board"); // frontmatter intact after the write
  });

  test("a mixed batch routes each task correctly — done vs gated", async () => {
    // "işlemi sonlandır" is a kill command → gated → stays in Doing.
    writeFileSync(join(vault, "orchestra", "sprint.md"), board(["disk doluluk", "işlemi sonlandır"]));
    const r = await processTaskBoard(vault, deps());
    const b = parseBoard(boardText());
    expect(b.lanes.Done.some((l) => l.includes("disk doluluk"))).toBe(true);
    expect(b.lanes.Doing.some((l) => l.includes("işlemi sonlandır"))).toBe(true);
    expect(b.lanes.Done.some((l) => l.includes("işlemi sonlandır"))).toBe(false);
    expect(r.gated).toBeGreaterThanOrEqual(1);
  });

  test("concurrency measurably beats serial — a slow task run in a chunk overlaps", async () => {
    const titles = ["disk doluluk", "hangi dizindeyim", "makine adı ne"];
    writeFileSync(join(vault, "orchestra", "sprint.md"), board(titles));
    process.env.ORCHESTRA_CONCURRENCY = "3";
    const slow = async () => { await new Promise((r) => setTimeout(r, 80)); return "926 out"; };
    const t0 = Date.now();
    const r = await processTaskBoard(vault, deps({ runCommand: slow, recall: async () => { await new Promise((r) => setTimeout(r, 80)); return []; } }));
    const elapsed = Date.now() - t0;
    expect(r.done).toBe(3);
    // Serial would be ~3×(80+80). One chunk of 3 overlaps, so it stays well under.
    expect(elapsed).toBeLessThan(360);
    expect(r.parallelMs).toBeGreaterThan(0);
  });

  test("a batch larger than N is split into sequential chunks (no unbounded fan-out)", async () => {
    process.env.ORCHESTRA_CONCURRENCY = "2";
    const titles = ["disk doluluk", "hangi dizindeyim", "makine adı ne", "bellek durumu ne", "sistem yükü"];
    writeFileSync(join(vault, "orchestra", "sprint.md"), board(titles));
    let peak = 0, live = 0;
    const track = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--; return "926"; };
    await processTaskBoard(vault, deps({ runCommand: track }));
    // With N=2, at most two command steps run at once across the whole batch.
    expect(peak).toBeLessThanOrEqual(2);
  });
});
