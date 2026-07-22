// L42 — bounded step chaining.
//
// `df -h` reported a volume at 70% and nobody followed up. A real orchestra asks "so what is on
// that volume?". The danger in letting a model decide what to run next is obvious, so the
// mechanism is deliberately narrow: it may name ONE id from the vetted catalog, that id goes
// through the same safety table as any other command, and the ceiling is a hard two rounds.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFollowup, stripFollowup, synthesisQuestion } from "../server/orchestra-synthesis";
import {
  followupCandidates, followupStep, processTaskBoard, MAX_ROUNDS, isRiskyCommand,
} from "../server/orchestra-tasks";
import { readEcymCommands, type EcymCommand } from "../server/brain-obsidian-ecym";

const cmd = (o: Partial<EcymCommand>): EcymCommand => ({
  id: "x", level: "baslangic", triggers: [], cmd: "true", arg: "yok", desc: "", safe: true, ...o,
});

describe("parsing the follow-up directive", () => {
  test("a valid id on its own line is accepted", () => {
    expect(parseFollowup("Disk %70 dolu.\nFOLLOWUP: du_home", ["du_home", "df"])).toBe("du_home");
  });

  test("an id outside the allowed set is dropped SILENTLY", () => {
    // A model naming something not in the catalog is exactly what this design refuses. Making
    // it an error would only tempt a caller into "handling" it.
    expect(parseFollowup("FOLLOWUP: rm_everything", ["du_home"])).toBeNull();
    expect(parseFollowup("FOLLOWUP: rm -rf /", ["du_home"])).toBeNull();
  });

  test("no directive means no follow-up", () => {
    expect(parseFollowup("Disk %70 dolu.", ["du_home"])).toBeNull();
    expect(parseFollowup("", ["du_home"])).toBeNull();
  });

  test("the directive is machinery — it never reaches the human-facing answer", () => {
    expect(stripFollowup("Disk %70 dolu.\nFOLLOWUP: du_home")).toBe("Disk %70 dolu.");
    expect(stripFollowup("Disk %70 dolu.")).toBe("Disk %70 dolu.");
  });

  test("the prompt only offers ids when a follow-up is possible", () => {
    expect(synthesisQuestion("t", [])).not.toContain("FOLLOWUP");
    const q = synthesisQuestion("t", ["du_home", "df"]);
    expect(q).toContain("FOLLOWUP");
    expect(q).toContain("du_home");
  });
});

describe("which ids may be offered", () => {
  const catalog = [
    cmd({ id: "df", cmd: "df -h", safe: true }),
    cmd({ id: "kill", cmd: "kill", arg: "-9", safe: false }),
    cmd({ id: "pgrep", cmd: "pgrep -il {{name}}", safe: true }),
    cmd({ id: "rmx", cmd: "rm -rf /tmp/x", safe: true }),
  ];

  test("only safe, fillable, denylist-clean entries are offered", () => {
    const ids = followupCandidates(catalog);
    expect(ids).toContain("df");
    expect(ids).not.toContain("kill");   // gated: a chain that stalls on approval by design
    expect(ids).not.toContain("pgrep");  // unfilled {{placeholder}}
    expect(ids).not.toContain("rmx");    // denylist beats the catalog's safe flag
  });

  test("an allowlist filter removes what the shell would refuse anyway", () => {
    expect(followupCandidates(catalog, (c) => c.startsWith("df"))).toEqual(["df"]);
    expect(followupCandidates(catalog, () => false)).toEqual([]);
  });

  test("candidates are stable — the prompt must not change shape run to run", () => {
    expect(followupCandidates(catalog)).toEqual(followupCandidates(catalog));
  });
});

describe("turning an id into a step", () => {
  const catalog = [
    cmd({ id: "df", cmd: "df -h", safe: true }),
    cmd({ id: "kill", cmd: "kill", arg: "-9", safe: false }),
  ];

  test("a safe id becomes an auto step", () => {
    expect(followupStep("df", catalog)).toMatchObject({ role: "command", invocation: "df -h", auto: true });
  });

  test("a gated id becomes a step that waits for approval, never one that runs", () => {
    const s = followupStep("kill", catalog)!;
    expect(s.auto).toBe(false);
    expect(s.gateReason).toBeTruthy();
    expect(isRiskyCommand(s.invocation)).toBe(true);
  });

  test("an unknown id yields nothing at all", () => {
    expect(followupStep("nope", catalog)).toBeNull();
  });
});

describe("the two-round loop", () => {
  let vault: string;
  const BOARD = `---\nkanban-plugin: board\n---\n\n## 📥 Backlog\n\n- [ ] disk doluluk durumu nedir\n\n## 🔨 Doing\n\n## ✅ Done\n`;
  const real = readEcymCommands();
  const hasCatalog = real.length > 0;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "orch-chain-"));
    mkdirSync(join(vault, "orchestra"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "sprint.md"), BOARD);
    process.env.OBSIDIAN_VAULT = "/nonexistent";
  });

  const noteText = () => {
    const dir = join(vault, "orchestra", "tasks");
    const f = require("node:fs").readdirSync(dir)[0];
    return readFileSync(join(dir, f), "utf8");
  };

  test.skipIf(!hasCatalog)("a follow-up runs a second round and the note says so", async () => {
    const ran: string[] = [];
    let call = 0;
    const r = await processTaskBoard(vault, {
      runCommand: async (c) => { ran.push(c); return `output of ${c}`; },
      recall: async () => [{ id: "m1", excerpt: "not" }],
      synthesize: async (_t, _res, ids) => {
        call++;
        // First pass asks for a follow-up; the second must not be offered any.
        if (call === 1) {
          expect(ids.length).toBeGreaterThan(0);
          return { answer: "ilk sonuç", expert: "ecym", abstained: false, followup: ids.includes("du") ? "du" : ids[0] };
        }
        expect(ids).toEqual([]);
        return { answer: "nihai sonuç", expert: "ecym", abstained: false };
      },
    });
    expect(call).toBe(2);
    expect(r.done).toBe(1);
    expect(ran.length).toBeGreaterThanOrEqual(2); // round-1 command + follow-up
    const note = noteText();
    expect(note).toContain("2 tur");
    expect(note).toContain("nihai sonuç");
  });

  test.skipIf(!hasCatalog)("the ceiling holds — a third round is never asked for", async () => {
    let call = 0;
    await processTaskBoard(vault, {
      runCommand: async (c) => `output of ${c}`,
      recall: async () => [],
      // An enthusiastic model that always wants to go deeper must still stop.
      synthesize: async (_t, _res, ids) => {
        call++;
        return { answer: `tur ${call}`, expert: "x", abstained: false, followup: ids[0] ?? null };
      },
    });
    expect(call).toBe(MAX_ROUNDS);
    expect(MAX_ROUNDS).toBe(2);
  });

  test("no follow-up means exactly one round (regression)", async () => {
    let call = 0;
    const r = await processTaskBoard(vault, {
      runCommand: async () => "out",
      recall: async () => [],
      synthesize: async () => { call++; return { answer: "tek tur", expert: "x", abstained: false }; },
    });
    expect(call).toBe(1);
    expect(r.done).toBe(1);
    expect(noteText()).not.toContain("2 tur");
  });

  test("an unknown follow-up id is ignored rather than run", async () => {
    const ran: string[] = [];
    let call = 0;
    await processTaskBoard(vault, {
      runCommand: async (c) => { ran.push(c); return "out"; },
      recall: async () => [],
      synthesize: async () => {
        call++;
        return { answer: "sonuç", expert: "x", abstained: false, followup: "kesinlikle-yok" };
      },
    });
    expect(call).toBe(1); // no second synthesis, because no second round happened
    expect(ran.every((c) => !c.includes("kesinlikle-yok"))).toBe(true);
  });
});
