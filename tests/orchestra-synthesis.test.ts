// L39 + L40 — a task produces an ANSWER, and the answer comes back as memory.
//
// Before this the evidence note held three raw outputs and stopped. The task was "disk doluluk
// durumu nedir"; the number was sitting in the third block and nobody wrote the sentence. And
// nothing was ever remembered, so asking the same question again recalled a commit ABOUT disk
// surveying rather than the disk figure produced minutes earlier.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepsAsSources, synthesizeTask, synthesisQuestion } from "../server/orchestra-synthesis";
import { evidenceNote, processTaskBoard, type StepResult } from "../server/orchestra-tasks";

const DF_OUTPUT = "Filesystem  Size  Used Avail Capacity  Mounted on\n/dev/disk3s5  926Gi 608Gi 262Gi 70%  /System/Volumes/Data";

const step = (o: Partial<StepResult>): StepResult =>
  ({ role: "command", invocation: "df -h", ok: true, ms: 4, output: DF_OUTPUT, ...o });

describe("L39 · steps become citable sources", () => {
  test("only steps that actually produced evidence are included", () => {
    const src = stepsAsSources([
      step({}),
      step({ role: "recall", invocation: "disk", output: "[mem:m1] eski not" }),
      // A gated step ran nothing; a failed one has an error, not evidence. Feeding either in
      // would invite the panel to "conclude" from an approval prompt.
      step({ role: "vault", ok: false, gated: true, output: "" }),
      step({ role: "vault", ok: false, output: "vault erişilemedi" }),
      step({ role: "vault", ok: true, output: "   " }),
    ]);
    expect(src.map((s) => s.id)).toEqual(["step:command", "step:recall"]);
  });

  test("the raw output is carried verbatim — the panel must see the real numbers", () => {
    const [s] = stepsAsSources([step({})]);
    expect(s.content).toContain("608Gi");
    expect(s.content).toContain("df -h");
    expect(s.tier).toBe("working");
  });

  test("the machine's output outranks recall and vault context", () => {
    const src = stepsAsSources([
      step({ role: "vault", output: "vault notu" }),
      step({ role: "recall", output: "hatırlanan" }),
      step({ role: "command", output: DF_OUTPUT }),
    ]);
    const by = Object.fromEntries(src.map((s) => [s.id, s.score]));
    expect(by["step:command"]).toBeGreaterThan(by["step:recall"]);
    expect(by["step:recall"]).toBeGreaterThan(by["step:vault"]);
  });

  test("the question restates the task and pins the evidence contract", () => {
    const q = synthesisQuestion("disk doluluk durumu nedir");
    expect(q).toContain("disk doluluk durumu nedir");
    expect(q).toContain("BİLGİ_YOK");
  });
});

describe("L39 · synthesis over the evidence", () => {
  const deps = (answer: string) => ({
    generate: async () => answer,
    experts: { ollamas: async () => answer },
  }) as any;

  test("the panel answers from what the task observed", async () => {
    const r = await synthesizeTask("disk doluluk durumu nedir", [step({})],
      deps("Disk 926Gi, 608Gi dolu — Data birimi %70 [mem:step:command]"));
    expect(r).not.toBeNull();
    expect(r!.answer).toContain("608Gi");
    expect(r!.abstained).toBe(false);
    expect(r!.expert).toBe("ollamas");
  });

  test("no evidence at all means no synthesis — a conclusion from nothing is worse than none", async () => {
    expect(await synthesizeTask("t", [], deps("cevap"))).toBeNull();
    expect(await synthesizeTask("t", [step({ ok: false, gated: true, output: "" })], deps("cevap"))).toBeNull();
  });

  test("an honest abstention is reported as one, not dressed up as an answer", async () => {
    const r = await synthesizeTask("t", [step({})], deps("BİLGİ_YOK"));
    expect(r!.abstained).toBe(true);
  });

  test("a broken expert cannot poison the conclusion (L33 applies here too)", async () => {
    const r = await synthesizeTask("t", [step({})], {
      generate: async () => "",
      experts: {
        ollamas: async () => "Disk %70 dolu [mem:step:command]",
        odysseus: async () => '{"ok":false,"output":{"error":"fetch failed"}}',
      },
    } as any);
    expect(r!.expert).toBe("ollamas");
    expect(r!.degradedReasons?.odysseus).toContain("fetch failed");
    expect(r!.answer).not.toContain("fetch failed");
  });

  test("a thrown panel loses the summary, never the raw evidence", async () => {
    const r = await synthesizeTask("t", [step({})], {
      generate: async () => { throw new Error("panel down"); },
      experts: { ollamas: async () => { throw new Error("panel down"); } },
    } as any);
    // Either null or an abstention — but no exception escapes into the tick.
    expect(r === null || r.abstained).toBe(true);
  });
});

describe("L39 · the evidence note", () => {
  test("the conclusion goes ABOVE the raw blocks, and the blocks survive", () => {
    const note = evidenceNote("disk doluluk", "abc", [step({})], 10, "2026-07-22T12:00:00Z", {
      answer: "Disk %70 dolu [mem:step:command]", expert: "ecym", abstained: false,
    });
    expect(note).toContain("## ✅ Sonuç");
    expect(note).toContain("Disk %70 dolu");
    // A summary that REPLACED the evidence would be the same failure in the other direction.
    expect(note).toContain("608Gi");
    expect(note.indexOf("## ✅ Sonuç")).toBeLessThan(note.indexOf("608Gi"));
  });

  test("an abstention is labelled as one", () => {
    const note = evidenceNote("t", "abc", [step({})], 10, "2026-07-22T12:00:00Z",
      { answer: "", expert: "", abstained: true });
    expect(note).toContain("## ⚠️ Sonuç");
    expect(note).toContain("kanıttan cevap çıkaramadı");
  });

  test("a veto during synthesis is stated, not applied silently", () => {
    const note = evidenceNote("t", "abc", [step({})], 10, "2026-07-22T12:00:00Z", {
      answer: "cevap", expert: "ecym", abstained: false,
      veto: { from: "ollamas", to: "ecym", delta: 0.19, fromScore: 0.69, toScore: 0.88 },
    });
    expect(note).toContain("Kalite vetosu");
    expect(note).toContain("ollamas");
  });

  test("without synthesis the note is exactly what it was before (regression)", () => {
    const note = evidenceNote("t", "abc", [step({})], 10, "2026-07-22T12:00:00Z");
    expect(note).not.toContain("Sonuç");
    expect(note).toContain("608Gi");
  });
});

describe("L40 · the loop closes", () => {
  let vault: string;
  const BOARD = `---\nkanban-plugin: board\n---\n\n## 📥 Backlog\n\n- [ ] disk doluluk durumu nedir\n\n## 🔨 Doing\n\n## ✅ Done\n`;

  const baseDeps = {
    runCommand: async () => DF_OUTPUT,
    recall: async () => [{ id: "m1", excerpt: "eski not" }],
  };

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "orch-syn-"));
    mkdirSync(join(vault, "orchestra"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "sprint.md"), BOARD);
    process.env.OBSIDIAN_VAULT = "/nonexistent"; // vault member offline, honestly
  });

  test("a finished, conclusive task becomes a memory through the choke-point", async () => {
    const written: any[] = [];
    const r = await processTaskBoard(vault, {
      ...baseDeps,
      synthesize: async () => ({ answer: "Disk %70 dolu", expert: "ecym", abstained: false }),
      remember: async (m) => { written.push(m); return m; },
    });
    expect(r.done).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ tier: "episodic", source: "orchestra/task" });
    // The memory must carry BOTH the question and the answer, or recall cannot use it.
    expect(written[0].content).toContain("disk doluluk durumu nedir");
    expect(written[0].content).toContain("Disk %70 dolu");
  });

  test("an abstention is not knowledge — nothing is written", async () => {
    const written: any[] = [];
    await processTaskBoard(vault, {
      ...baseDeps,
      synthesize: async () => ({ answer: "", expert: "", abstained: true }),
      remember: async (m) => { written.push(m); return m; },
    });
    expect(written).toEqual([]);
  });

  test("no synthesis at all writes nothing (a raw dump is not a conclusion)", async () => {
    const written: any[] = [];
    await processTaskBoard(vault, { ...baseDeps, remember: async (m) => { written.push(m); return m; } });
    expect(written).toEqual([]);
  });

  test("a failed task has not finished, so it is not remembered", async () => {
    const written: any[] = [];
    const r = await processTaskBoard(vault, {
      ...baseDeps,
      runCommand: async () => { throw new Error("exit 1"); },
      synthesize: async () => ({ answer: "bir şey", expert: "x", abstained: false }),
      remember: async (m) => { written.push(m); return m; },
    });
    expect(r.done).toBe(0);
    expect(written).toEqual([]);
  });

  test("the id is derived from the task — re-running upserts, it does not breed", async () => {
    const ids: string[] = [];
    const deps = {
      ...baseDeps,
      synthesize: async () => ({ answer: "Disk %70 dolu", expert: "ecym", abstained: false }),
      remember: async (m: any) => { ids.push(m.id); return m; },
    };
    await processTaskBoard(vault, deps);
    // Re-queue the same task and run again.
    writeFileSync(join(vault, "orchestra", "sprint.md"), BOARD);
    await processTaskBoard(vault, deps);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^task-[0-9a-f]{8}$/);
  });

  test("a brain that is busy must not fail a finished task", async () => {
    const r = await processTaskBoard(vault, {
      ...baseDeps,
      synthesize: async () => ({ answer: "cevap", expert: "x", abstained: false }),
      remember: async () => { throw new Error("db locked"); },
    });
    expect(r.done).toBe(1); // the work still finished
  });
});
