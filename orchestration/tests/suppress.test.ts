/**
 * suppress.test.ts — vO14 detector precision: applySuppress (gerçek-koru, gürültü-ele, silent-değil).
 */
import { describe, it, expect } from "vitest";
import { applySuppress, suppressedBlock, type SuppressRule } from "../bin/lib/suppress";

const f = (kind: string) => ({ kind });
const RULES: SuppressRule[] = [
  { detector: "critic", kindPattern: "coverage-gap:lib/signal.ts", reason: "IO-wrapper" },
  { detector: "critic", kindPattern: "duplication:model-hook.ts↔role-hook.ts", reason: "false-pos" },
  { detector: "dod", kindPattern: "code-without-test:lib/x.ts", reason: "data-only" },
];

describe("applySuppress — gürültü-ele, gerçek-koru", () => {
  it("eşleşen kind suppressed; eşleşmeyen kept (detector-scoped)", () => {
    const findings = [
      f("crit:coverage-gap:lib/signal.ts"),       // suppress
      f("crit:coverage-gap:lib/shared.ts"),        // KEEP (gerçek gap)
      f("crit:duplication:model-hook.ts↔role-hook.ts"), // suppress
    ];
    const { kept, suppressed } = applySuppress(findings, RULES, "critic");
    expect(kept.map((x) => x.kind)).toEqual(["crit:coverage-gap:lib/shared.ts"]);
    expect(suppressed).toHaveLength(2);
    expect(suppressed[0].reason).toBe("IO-wrapper"); // silent-değil: reason taşınır
  });
  it("detector izolasyonu: critic kuralı dod bulgusunu elemez", () => {
    const { kept, suppressed } = applySuppress([f("dod:code-without-test:lib/signal.ts")], RULES, "dod");
    expect(kept).toHaveLength(1); // critic-kuralı 'signal' dod'a uygulanmaz
    expect(suppressed).toHaveLength(0);
  });
  it("dod kuralı eşleşir", () => {
    const { suppressed } = applySuppress([f("dod:code-without-test:lib/x.ts")], RULES, "dod");
    expect(suppressed).toHaveLength(1);
  });
  it("boş kural → hepsi kept (passthrough)", () => {
    const all = [f("a"), f("b")];
    expect(applySuppress(all, [], "critic").kept).toHaveLength(2);
  });
});

describe("suppressedBlock — şeffaflık (gizleme-değil)", () => {
  it("elenen bulguları gerekçesiyle listeler", () => {
    const b = suppressedBlock([{ kind: "crit:x", reason: "IO-wrapper" }]);
    expect(b).toMatch(/suppressed: 1/);
    expect(b).toContain("IO-wrapper");
    expect(b).toMatch(/gizlenmedi/i);
  });
  it("boş → boş string", () => {
    expect(suppressedBlock([])).toBe("");
  });
});
