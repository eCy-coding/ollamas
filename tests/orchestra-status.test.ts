// L47 — the live orchestra panel, and freezing tasks that wait too long.
//
// status.md was a sync-time snapshot that could not say whether the orchestra was useful; a
// gated task ("işlemi sonlandır") had sat in Doing for days with nothing marking it stuck. The
// panel derives usefulness from the outcome ledger, and stale-freeze makes the stall visible.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOutcomes, orchestraPanel, renderPanel } from "../server/orchestra-status";
import { processTaskBoard, parseBoard, taskId, taskNotePath, staleDays, type TaskOutcome, type Board } from "../server/orchestra-tasks";

const outcome = (o: Partial<TaskOutcome>): TaskOutcome => ({
  at: 0, task: "t", id: "x", rounds: 1, members: ["command"], ms: 10,
  answered: true, gated: 0, failed: 0, remembered: true, reported: true, ...o,
});
const board = (over: Partial<Board["lanes"]> = {}): Board =>
  ({ frontmatter: "", lanes: { Backlog: [], Doing: [], Done: [], ...over }, trailer: "" });

describe("readOutcomes", () => {
  test("parses JSONL and skips a malformed line rather than throwing", () => {
    const text = `${JSON.stringify(outcome({ task: "a" }))}\nnot json\n${JSON.stringify(outcome({ task: "b" }))}`;
    const rows = readOutcomes(text);
    expect(rows.map((r) => r.task)).toEqual(["a", "b"]);
  });

  test("keeps only the most recent `limit`", () => {
    const text = Array.from({ length: 60 }, (_, i) => JSON.stringify(outcome({ task: `t${i}` }))).join("\n");
    expect(readOutcomes(text, 10)).toHaveLength(10);
    expect(readOutcomes(text, 10)[0].task).toBe("t50");
  });
});

describe("orchestraPanel", () => {
  test("answer rate, avg rounds and vetoes come straight from the ledger", () => {
    const p = orchestraPanel([
      outcome({ answered: true, rounds: 1, vetoed: false }),
      outcome({ answered: false, rounds: 2, vetoed: true }),
      outcome({ answered: true, rounds: 2, vetoed: false }),
    ], board());
    expect(p.total).toBe(3);
    expect(p.answered).toBe(2);
    expect(p.answerRate).toBeCloseTo(0.67, 2);
    expect(p.avgRounds).toBeCloseTo(1.67, 2);
    expect(p.vetoes).toBe(1);
  });

  test("members are counted by contribution — an offline member shows a low number, not absence", () => {
    const p = orchestraPanel([
      outcome({ members: ["command", "recall"] }),
      outcome({ members: ["command"] }),
    ], board());
    const by = Object.fromEntries(p.members.map((m) => [m.name, m.contributed]));
    expect(by.eCym).toBe(2);
    expect(by.ollamas).toBe(1);
    expect(by.obsidian).toBe(0); // offline, but present in the panel
  });

  test("winners are tallied per expert, only for answered tasks", () => {
    const p = orchestraPanel([
      outcome({ answered: true, expert: "ecym" }),
      outcome({ answered: true, expert: "ecym" }),
      outcome({ answered: false, expert: "ollamas" }),
    ], board());
    expect(p.winners.ecym).toBe(2);
    expect(p.winners.ollamas).toBeUndefined();
  });

  test("pending and frozen approvals are read from the Doing lane", () => {
    const p = orchestraPanel([], board({
      Doing: ["- [ ] işlemi sonlandır", "- [ ] ❄️ eski gated iş", "- [x] tamamlanmış"],
    }));
    expect(p.pendingApprovals).toEqual(["işlemi sonlandır", "eski gated iş"]);
    expect(p.frozen).toEqual(["eski gated iş"]);
  });

  test("an empty ledger yields a zero panel, not a crash", () => {
    const p = orchestraPanel([], board());
    expect(p).toMatchObject({ total: 0, answered: 0, answerRate: 0, vetoes: 0 });
  });

  test("renderPanel surfaces the numbers a human scans for", () => {
    const md = renderPanel(orchestraPanel([outcome({ answered: true, vetoed: true })],
      board({ Doing: ["- [ ] işlemi sonlandır"] })));
    expect(md).toContain("cevap oranı **%100**");
    expect(md).toContain("veto 1");
    expect(md).toContain("Bekleyen onay");
    expect(md).toContain("işlemi sonlandır");
  });
});

describe("stale-freeze", () => {
  let vault: string;
  const gatedBoard = `---\nkanban-plugin: board\n---\n\n## 📥 Backlog\n\n## 🔨 Doing\n\n- [ ] işlemi sonlandır\n\n## ✅ Done\n`;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "orch-freeze-"));
    mkdirSync(join(vault, "orchestra", "tasks"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "sprint.md"), gatedBoard);
    // A task in Doing needs an evidence note (at the canonical path) for freeze to measure age.
    writeFileSync(notePath(), "# işlemi sonlandır\n\n- [ ] ONAY: `kill`\n");
    process.env.OBSIDIAN_VAULT = "/nonexistent";
  });

  const deps = { runCommand: async () => "out", recall: async () => [] };
  const notePath = () => taskNotePath(vault, taskId("işlemi sonlandır"), "işlemi sonlandır");

  test("a fresh gated task is NOT frozen", async () => {
    const r = await processTaskBoard(vault, deps);
    expect(r.froze ?? 0).toBe(0);
    expect(parseBoard(readFileSync(join(vault, "orchestra", "sprint.md"), "utf8")).lanes.Doing.join())
      .not.toContain("❄️");
  });

  test("a gated task older than the threshold is frozen — marked, not deleted", async () => {
    // Age the evidence note past the default 7 days.
    const old = Date.now() / 1000 - staleDays() * 86400 - 3600;
    utimesSync(notePath(), old, old);
    const r = await processTaskBoard(vault, deps);
    expect(r.froze).toBe(1);
    const doing = parseBoard(readFileSync(join(vault, "orchestra", "sprint.md"), "utf8")).lanes.Doing.join("\n");
    expect(doing).toContain("❄️");
    expect(doing).toContain("işlemi sonlandır"); // still there, just marked
    expect(readFileSync(notePath(), "utf8")).toContain("Donduruldu");
  });

  test("freezing is idempotent — a second run does not double-mark", async () => {
    const old = Date.now() / 1000 - staleDays() * 86400 - 3600;
    utimesSync(notePath(), old, old);
    await processTaskBoard(vault, deps);
    const r2 = await processTaskBoard(vault, deps);
    expect(r2.froze ?? 0).toBe(0);
    const doing = parseBoard(readFileSync(join(vault, "orchestra", "sprint.md"), "utf8")).lanes.Doing.join("\n");
    expect((doing.match(/❄️/g) ?? []).length).toBe(1);
  });

  test("the threshold is configurable", () => {
    expect(staleDays({ ORCHESTRA_STALE_DAYS: "3" } as any)).toBe(3);
    expect(staleDays({} as any)).toBe(7);
    expect(staleDays({ ORCHESTRA_STALE_DAYS: "junk" } as any)).toBe(7);
  });
});
