// L51 — the grounding grader's own accuracy, measured.
//
// The guardrail was producing false positives — ~2 of every 3 "weak" labels were wrong (a
// correct pwd answer and a philosophy answer both flagged) — and nothing measured it, so a
// correct answer was silently withheld from the brain. This is a labelled set drawn from the
// real live cases; the grader must clear a precision/recall bar on it, and the bar is asserted
// so the guardrail can never regress into silent wrongness again.
import { describe, test, expect } from "vitest";
import { gradeGrounding } from "../server/orchestra-grounding";
import type { SynthesisSource } from "../server/orchestra-synthesis";

const src = (id: string, content: string): SynthesisSource =>
  ({ id, tier: "working", content, distance: 0, score: 1, createdAt: 0 });

// Common evidence blocks, from the real command outputs.
const DF = src("step:command", "[command] df -h\n/dev/disk3s5 926Gi 608Gi 262Gi 70% /System/Volumes/Data");
const PWD = src("step:command", "[command] pwd\n/Users/emrecnyngmail.com/Desktop/ollamas");
const HOST = src("step:command", "[command] hostname\nMacBook-Pro.local");
const PS = src("step:command", "[command] ps\n80515 184.7 node\n4675 98.1 next-server");
// Vault/recall noise: a sprint board full of dates and counts that must NOT drive grounding.
const VAULT_NOISE = src("step:vault", "[vault] sprint.md · 2026-07-22 · 4 görev · 11 satır · 305 entity");
const RECALL = src("step:recall", "[recall] geçmiş görev sonucu");

interface Case { name: string; answer: string; sources: SynthesisSource[]; expected: "grounded" | "weak" }

// Each case is a real shape the system produces. `expected` is the human judgement of whether
// the answer actually used the evidence — the ground truth the grader is scored against.
const CASES: Case[] = [
  // — true grounded: the answer uses the command's own figures/names —
  { name: "disk %70 grounded", answer: "Disk 926Gi, 608Gi kullanılmış, %70 dolu [mem:step:command]", sources: [DF, VAULT_NOISE], expected: "grounded" },
  { name: "pwd path grounded (was false-positive)", answer: "Dizin /Users/emrecnyngmail.com/Desktop/ollamas [mem:step:command]", sources: [PWD, VAULT_NOISE], expected: "grounded" },
  { name: "hostname grounded (name, no number)", answer: "Makine adı MacBook-Pro.local [mem:step:command]", sources: [HOST, VAULT_NOISE], expected: "grounded" },
  { name: "ps used grounded", answer: "En yüksek CPU node %184.7, next-server %98.1 [mem:step:command]", sources: [PS], expected: "grounded" },
  { name: "citation task grounded (was type-problem)", answer: "Özgür irade felsefede tartışmalı bir konudur [mem:step:recall]", sources: [VAULT_NOISE, RECALL], expected: "grounded" },
  { name: "recall task grounded", answer: "Orkestra üç üyeyle çalışır [mem:step:recall]", sources: [RECALL], expected: "grounded" },

  // — true weak: the answer hedges or ignores the command output —
  { name: "hedged (varsayılabilir)", answer: "Sorumlu süreç genellikle CPU yoğunluğu yapan işlemlerdir, varsayılabilir", sources: [PS], expected: "weak" },
  { name: "ps ignored, generic", answer: "Sistem yükü işlemcinin durumunu gösterir, muhtemelen yüksektir", sources: [PS], expected: "weak" },
  { name: "citation task, no citation", answer: "Özgür irade tartışmalı bir konudur.", sources: [VAULT_NOISE, RECALL], expected: "weak" },
  { name: "citation task, hedged", answer: "Genellikle özgür irade vardır [mem:step:recall]", sources: [VAULT_NOISE, RECALL], expected: "weak" },
  { name: "disk task, wrong numbers", answer: "Disk genellikle doludur, tipik olarak yüksek kullanım vardır", sources: [DF], expected: "weak" },
  { name: "empty-ish", answer: "Bilgi net değil.", sources: [PS], expected: "weak" },
];

describe("grounding accuracy on the labelled set", () => {
  test.each(CASES)("$name", ({ answer, sources, expected }) => {
    const g = gradeGrounding(answer, sources);
    expect(g.weak ? "weak" : "grounded").toBe(expected);
  });

  test("precision and recall both clear 0.9 — a false-positive guardrail is itself a bug", () => {
    // Positive class = "weak" (the thing the guardrail acts on: withholds from the brain).
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const c of CASES) {
      const predWeak = gradeGrounding(c.answer, c.sources).weak;
      const trueWeak = c.expected === "weak";
      if (predWeak && trueWeak) tp++;
      else if (predWeak && !trueWeak) fp++;   // false positive: a correct answer flagged weak
      else if (!predWeak && trueWeak) fn++;    // false negative: a bad answer let through
      else tn++;
    }
    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);
    // The regression that started this: false positives. precision guards against exactly that.
    expect(precision, `precision (fp=${fp})`).toBeGreaterThanOrEqual(0.9);
    expect(recall, `recall (fn=${fn})`).toBeGreaterThanOrEqual(0.9);
  });

  test("the two historical false positives are fixed", () => {
    // pwd answered correctly, philosophy answered with a citation — neither is weak now.
    expect(gradeGrounding("Dizin /Users/emrecnyngmail.com/Desktop/ollamas [mem:step:command]", [PWD, VAULT_NOISE]).weak).toBe(false);
    expect(gradeGrounding("Özgür irade tartışmalı [mem:step:recall]", [VAULT_NOISE, RECALL]).weak).toBe(false);
  });

  test("the one true weak is preserved — this is targeting, not loosening", () => {
    // The ps output is right there and the answer ignores it. Still weak.
    expect(gradeGrounding("Sorumlu süreç genellikle CPU yoğun işlemlerdir", [PS]).weak).toBe(true);
  });

  test("mode reflects task shape", () => {
    expect(gradeGrounding("x [mem:step:command]", [DF]).mode).toBe("numeric");
    expect(gradeGrounding("x [mem:step:recall]", [RECALL]).mode).toBe("citation");
  });
});
