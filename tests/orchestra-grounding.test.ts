// L45 — a synthesis that ignores its own evidence is not an answer.
//
// Measured live: a follow-up returned `node 184.7% · next-server 98.1%` and the synthesis still
// said the responsible process "could be assumed" (varsayılabilir), mislabelling the load
// averages. The grader below is deterministic — it catches hedging and answers that fail to
// reuse the evidence's concrete tokens, so a weak answer can be re-asked and, if still weak,
// flagged honestly and kept out of the brain.
import { describe, test, expect } from "vitest";
import { gradeGrounding, evidenceTokens, fold, regroundMessages, REGROUND_PROMPT } from "../server/orchestra-grounding";
import { synthesizeTask, type SynthesisSource } from "../server/orchestra-synthesis";
import type { StepResult } from "../server/orchestra-tasks";

const PS = "[command] ps -A -o pid,%cpu,comm -r | head -n 11\n  PID  %CPU COMM\n80515 184.7 /usr/local/bin/node\n 4675  98.1 next-server (v15.5.12)";
const sources = (content = PS): SynthesisSource[] =>
  [{ id: "step:command", tier: "working", content, distance: 0, score: 1, createdAt: 0 }];

// The two answers measured live, verbatim shape.
const HEDGED = "Bu yüklere neden olan işlem, genellikle CPU yoğunluğu yapan süreçlerin sorumlu olduğu varsayılabilir. [mem:step:command]";
const GROUNDED = "En yüksek CPU'yu node (%184.7) ve next-server (%98.1) kullanıyor. [mem:step:command]";

describe("evidenceTokens", () => {
  test("pulls the meaningful numbers out of command output", () => {
    const { numbers } = evidenceTokens(sources());
    expect(numbers).toContain("184.7");
    expect(numbers).toContain("98.1");
  });

  test("distinctive names survive but table scaffolding is dropped", () => {
    const { names } = evidenceTokens(sources());
    expect(names.some((n) => n.includes("node"))).toBe(true);
    expect(names).toContain("next-server");
    // Column headers and shell words prove nothing about the answer.
    for (const noise of ["comm", "head", "pid", "cpu"]) expect(names).not.toContain(noise);
  });

  test("fold makes matching diacritic-insensitive", () => {
    expect(fold("İşlem")).toBe("islem");
    expect(fold("YÜK")).toBe("yuk");
  });
});

describe("gradeGrounding — the live before/after", () => {
  test("the hedged answer is weak: it hedges AND cites no evidence number", () => {
    const g = gradeGrounding(HEDGED, sources());
    expect(g.hedged).toBe(true);
    expect(g.citesEvidence).toBe(false);
    expect(g.weak).toBe(true);
  });

  test("the grounded answer passes: no hedge, real numbers reused", () => {
    const g = gradeGrounding(GROUNDED, sources());
    expect(g.hedged).toBe(false);
    expect(g.citesEvidence).toBe(true);
    expect(g.weak).toBe(false);
    expect(g.score).toBeGreaterThan(0);
  });

  test("Turkish hedging is caught across inflected forms", () => {
    for (const h of ["varsayılabilir", "varsayabiliriz", "muhtemelen öyle", "tipik olarak", "çeşitli süreçler"]) {
      expect(gradeGrounding(`Cevap ${h} [x]`, sources()).hedged, h).toBe(true);
    }
    expect(gradeGrounding(GROUNDED, sources()).hedged).toBe(false);
  });

  test("evidence with no numbers grades on names instead", () => {
    const src = sources("[command] hostname\nMacBook-Pro");
    expect(gradeGrounding("Makine adı MacBook-Pro. [mem:step:command]", src).weak).toBe(false);
    expect(gradeGrounding("Makine adı genellikle bir isimdir. [x]", src).weak).toBe(true);
  });

  test("the re-ask prompt is its own — no terse contract, demands citations", () => {
    expect(REGROUND_PROMPT).toContain("KAÇAMAK YASAK");
    expect(REGROUND_PROMPT).not.toContain("kısa ve net");
    const msgs = regroundMessages("sistem yükü", sources());
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("184.7"); // the evidence is handed back in full
  });
});

describe("synthesizeTask · re-ask flow", () => {
  const step = (output: string): StepResult =>
    ({ role: "command", invocation: "ps ...", ok: true, ms: 4, output });

  test("a weak first answer is re-asked once, and the better one wins", async () => {
    let call = 0;
    const r = await synthesizeTask("sistem yükü ve hangi işlem", [step(PS)], {
      generate: async () => HEDGED,
      experts: { ollamas: async () => HEDGED },
      reground: async () => { call++; return GROUNDED; },
    } as any);
    expect(call).toBe(1);
    expect(r!.answer).toContain("184.7");
    expect(r!.grounding).toMatchObject({ weak: false, regrounded: true });
  });

  test("no reground path → graded but not re-asked (old behaviour preserved)", async () => {
    const r = await synthesizeTask("sistem yükü", [step(PS)], {
      generate: async () => HEDGED,
      experts: { ollamas: async () => HEDGED },
    } as any);
    expect(r!.grounding).toMatchObject({ weak: true, regrounded: false });
    expect(r!.answer).toContain("varsayılabilir");
  });

  test("a re-ask that is no better is discarded — the score must not go backwards", async () => {
    const r = await synthesizeTask("sistem yükü", [step(PS)], {
      generate: async () => HEDGED,
      experts: { ollamas: async () => HEDGED },
      reground: async () => "Yine belirsiz, muhtemelen bir şeyler. [x]",
    } as any);
    expect(r!.answer).toBe(HEDGED); // original kept
    expect(r!.grounding!.weak).toBe(true);
  });

  test("an already-grounded answer is never re-asked", async () => {
    let call = 0;
    const r = await synthesizeTask("sistem yükü", [step(PS)], {
      generate: async () => GROUNDED,
      experts: { ollamas: async () => GROUNDED },
      reground: async () => { call++; return "x"; },
    } as any);
    expect(call).toBe(0);
    expect(r!.grounding).toMatchObject({ weak: false });
  });

  test("an abstention has no grounding — there is nothing to ground", async () => {
    const r = await synthesizeTask("boş", [step(PS)], {
      generate: async () => "BİLGİ_YOK",
      experts: { ollamas: async () => "BİLGİ_YOK" },
      reground: async () => GROUNDED,
    } as any);
    expect(r!.abstained).toBe(true);
    expect(r!.grounding).toBeUndefined();
  });
});
