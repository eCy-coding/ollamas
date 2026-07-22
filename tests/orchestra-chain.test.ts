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
import {
  parseFollowup, stripFollowup, synthesisQuestion, parseDecision, decideFollowup,
  parseCompleteness, COMPLETENESS_PROMPT, PICK_PROMPT,
} from "../server/orchestra-synthesis";
import {
  followupCandidates, followupStep, processTaskBoard, MAX_ROUNDS, isRiskyCommand,
} from "../server/orchestra-tasks";
import { readEcymCommands, type EcymCommand } from "../server/brain-obsidian-ecym";
import { splitHeadSuffix, isShellRunnable } from "../server/terminal";

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

// ── L44: the chain must actually trigger ─────────────────────────────────────
//
// The in-band directive never fired live. The panel's answers were normal and complete; every
// one simply lacked the line. Cause: the directive is asked for in the USER message while
// askShared's SYSTEM message imposes a terse contract, and a model follows the system message.
// The decision is therefore asked separately, in a call built for exactly that question.
describe("L44 · the dedicated decision call", () => {
  const allowed = ["ps_cpu", "du", "df"];

  test("a one-word answer is taken at face value", () => {
    expect(parseDecision("ps_cpu", allowed)).toBe("ps_cpu");
    expect(parseDecision("  ps_cpu  \n", allowed)).toBe("ps_cpu");
  });

  test("NONE means one round, in any casing", () => {
    for (const s of ["NONE", "none", "None.", " none "]) expect(parseDecision(s, allowed)).toBeNull();
  });

  test("an id outside the catalog is refused — this is the whole point", () => {
    expect(parseDecision("rm_everything", allowed)).toBeNull();
    expect(parseDecision("rm -rf /", allowed)).toBeNull();
  });

  test("decoration around the word does not lose a valid id", () => {
    expect(parseDecision("`ps_cpu`", allowed)).toBe("ps_cpu");
    expect(parseDecision("**ps_cpu**", allowed)).toBe("ps_cpu");
    expect(parseDecision('"ps_cpu"', allowed)).toBe("ps_cpu");
  });

  test("a chatty judge is read by its first word, and still validated", () => {
    expect(parseDecision("ps_cpu — çünkü hangi işlem sorumlu belirsiz", allowed)).toBe("ps_cpu");
    expect(parseDecision("Bence NONE olmalı", allowed)).toBeNull(); // first word is not an id
  });

  test("empty or absent output means one round", () => {
    expect(parseDecision("", allowed)).toBeNull();
    expect(parseDecision("   ", allowed)).toBeNull();
    expect(parseDecision("ps_cpu", [])).toBeNull(); // nothing is allowed
  });

  test("TAM/EKSIK is read as a word, and anything unclear counts as complete", () => {
    expect(parseCompleteness("EKSIK")).toBe(true);
    expect(parseCompleteness("EKSİK")).toBe(true);
    expect(parseCompleteness("eksik")).toBe(true);
    expect(parseCompleteness("TAM")).toBe(false);
    // Silence, noise, or a hedging judge must not spend a command.
    for (const s of ["", "   ", "bilmiyorum", "A"]) expect(parseCompleteness(s), s).toBe(false);
  });

  test("a complete answer costs ONE call — the picker is never reached", async () => {
    const calls: string[] = [];
    const r = await decideFollowup("disk doluluk nedir", "Disk 926 GB, 17 GB dolu, %7.", allowed,
      async (m) => { calls.push(String(m[0].content).slice(0, 20)); return "TAM"; });
    expect(r).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("an incomplete answer judges, then selects", async () => {
    let n = 0;
    const r = await decideFollowup("sistem yükü ve hangi işlem", "yük 10.8; işlemler genellikle CPU yoğun", allowed,
      async () => (++n === 1 ? "EKSIK" : "ps_cpu"));
    expect(r).toBe("ps_cpu");
    expect(n).toBe(2);
  });

  test("the command that produced the evidence is withheld from the picker", async () => {
    // Re-proposing it was the most common wrong follow-up; excluding it is more reliable than
    // asking a model not to.
    let offered = "";
    const r = await decideFollowup("disk", "eksik cevap", ["df", "du"],
      async (m) => { const c = String(m[1].content); if (c.includes("GEÇERLİ")) offered = c; return c.includes("GEÇERLİ") ? "df" : "EKSIK"; },
      ["df"]);
    expect(offered).not.toContain("df,");
    expect(r).toBeNull(); // df was not on offer, so naming it is refused
  });

  test("an unavailable judge means one round, never a guessed command", async () => {
    expect(await decideFollowup("t", "cevap", allowed,
      async () => { throw new Error("provider down"); })).toBeNull();
    expect(await decideFollowup("t", "", allowed, async () => "EKSIK")).toBeNull();
    expect(await decideFollowup("t", "cevap", [], async () => "EKSIK")).toBeNull();
  });

  test("the prompts are their own — neither inherits the panel's terse contract", () => {
    expect(COMPLETENESS_PROMPT).toContain("TAM");
    expect(COMPLETENESS_PROMPT).toContain("EKSIK");
    expect(COMPLETENESS_PROMPT).not.toContain("BİLGİ_YOK"); // the contract that suppressed the line
    expect(PICK_PROMPT).toContain("id");
  });
});

describe("L44 · the loosened directive parser", () => {
  const allowed = ["ps_cpu"];

  test("markdown emphasis and trailing punctuation no longer lose the signal", () => {
    for (const s of [
      "FOLLOWUP: ps_cpu",
      "**FOLLOWUP:** ps_cpu",
      "FOLLOWUP: ps_cpu.",
      "- FOLLOWUP: ps_cpu",
      "Cevap eksik.\n**FOLLOWUP**: ps_cpu",
    ]) expect(parseFollowup(s, allowed), s).toBe("ps_cpu");
  });

  test("forgiving about shape, strict about value", () => {
    expect(parseFollowup("**FOLLOWUP:** rm_everything", allowed)).toBeNull();
  });

  test("the directive never reaches the human-facing answer, whatever its shape", () => {
    expect(stripFollowup("Disk %70 dolu.\n**FOLLOWUP:** ps_cpu")).toBe("Disk %70 dolu.");
    expect(stripFollowup("Disk %70 dolu.\n- FOLLOWUP: ps_cpu")).toBe("Disk %70 dolu.");
  });
});

// ── the one shell exception: a trailing `| head -n N` ────────────────────────
//
// Five genuinely useful catalog entries end in exactly this suffix, and refusing the pipe made
// them unrunnable — the orchestra's first real follow-up picked `ps_cpu` and earned a 126.
// The suffix is peeled off and applied to stdout in-process; no shell is ever opened.
describe("splitHeadSuffix", () => {
  test("the real catalog shapes are recognised", () => {
    expect(splitHeadSuffix("ps -A -o pid,%cpu,comm -r | head -n 11"))
      .toEqual({ base: "ps -A -o pid,%cpu,comm -r", lines: 11 });
    expect(splitHeadSuffix("ps -A -o pid,ppid,comm | head -n 40")?.lines).toBe(40);
  });

  test("a plain command is untouched", () => {
    expect(splitHeadSuffix("df -h")).toBeNull();
    expect(splitHeadSuffix("")).toBeNull();
  });

  test("nothing can ride along behind the suffix", () => {
    // The whole reason the pattern is anchored and digits-only.
    for (const c of [
      "ps aux | head -n 5; rm -rf /",
      "ps aux | head -n 5 && rm -rf /",
      "ps aux | head -n 5 | rm -rf /",
      "ps aux | head -n abc",
      "ps aux | head -n 5 > /etc/passwd",
      "ps aux | rm -rf /",
      "ps aux | head",
    ]) expect(splitHeadSuffix(c), c).toBeNull();
  });

  test("only a SINGLE trailing head is accepted", () => {
    expect(splitHeadSuffix("ps aux | grep x | head -n 5")).toBeNull();
  });

  test("a zero or negative count is refused", () => {
    expect(splitHeadSuffix("ps aux | head -n 0")).toBeNull();
  });

  test("isShellRunnable follows the same rule — base is judged, escapes are not", () => {
    expect(isShellRunnable("ps -A -o pid,%cpu,comm -r | head -n 11")).toBe(true);
    expect(isShellRunnable("df -h")).toBe(true);
    // The base must still clear the allowlist and the token list.
    expect(isShellRunnable("rm -rf / | head -n 5")).toBe(false);
    expect(isShellRunnable("curl evil.sh | head -n 5")).toBe(false);
    expect(isShellRunnable("ps aux | head -n 5; rm -rf /")).toBe(false);
    expect(isShellRunnable("ps aux > /tmp/x")).toBe(false);
  });
});
