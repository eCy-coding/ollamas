import { describe, it, expect } from "vitest";
import {
  applyFlip, planRoadmapFlips, isSafe, diffPreview, gapBaseKind, gapVersion,
  type CritGap, type FixOp,
} from "../bin/lib/autofix";

const ROADMAP = [
  "| **vO7** | ✅ DONE | Work-claim ledger |",
  "| vO9 | planned | Quality-gate roll-up |",
  "| vO10 | planned | Heartbeat notification |",
].join("\n");

describe("gapBaseKind + gapVersion", () => {
  it("crit:roadmap-drift:vO9 → kind+ver", () => {
    expect(gapBaseKind("crit:roadmap-drift:vO9")).toBe("roadmap-drift");
    expect(gapVersion({ kind: "crit:roadmap-drift:vO9", target: "vO9", detail: "", action: "" })).toBe("vO9");
  });
  it("plain roadmap-drift", () => {
    expect(gapBaseKind("roadmap-drift")).toBe("roadmap-drift");
  });
});

describe("applyFlip — line-anchored idempotent", () => {
  it("planned → ✅ DONE (yalnız hedef satır)", () => {
    const r = applyFlip(ROADMAP, "vO9");
    expect(r.changed).toBe(true);
    expect(r.md).toMatch(/\| vO9 \| ✅ DONE \| Quality-gate/);
    expect(r.md).toMatch(/\| vO10 \| planned \|/); // vO10 dokunulmadı
  });
  it("zaten DONE → değişmez (idempotent)", () => {
    const r = applyFlip(ROADMAP, "vO7");
    expect(r.changed).toBe(false);
  });
  it("yok olan versiyon → no-op", () => {
    expect(applyFlip(ROADMAP, "vO99").changed).toBe(false);
  });
  it("flip sonrası tekrar flip → no-op (idempotent zincir)", () => {
    const once = applyFlip(ROADMAP, "vO9").md;
    expect(applyFlip(once, "vO9").changed).toBe(false);
  });
});

describe("planRoadmapFlips", () => {
  const gaps: CritGap[] = [
    { kind: "crit:roadmap-drift:vO9", target: "vO9", detail: "", action: "" },
    { kind: "crit:roadmap-drift:vO10", target: "vO10", detail: "", action: "" },
    { kind: "crit:coverage-gap:lib/bench.ts", target: "lib/bench.ts", detail: "", action: "" },
  ];
  it("roadmap-drift → flip op; coverage-gap → op YOK", () => {
    const ops = planRoadmapFlips(gaps, ROADMAP);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.target).sort()).toEqual(["vO10", "vO9"]);
    expect(ops.every((o) => o.kind === "roadmap-drift")).toBe(true);
  });
  it("zaten DONE versiyon drift gap'i → op yok (idempotent)", () => {
    const ops = planRoadmapFlips([{ kind: "crit:roadmap-drift:vO7", target: "vO7", detail: "", action: "" }], ROADMAP);
    expect(ops).toHaveLength(0);
  });
});

describe("isSafe — GÜVENLİK guardrail", () => {
  const flip: FixOp = { kind: "roadmap-drift", target: "vO9", file: "ROADMAP_ORCHESTRATION.md", before: "x", after: "y", safe: true };
  it("roadmap md flip → safe", () => {
    expect(isSafe(flip)).toBe(true);
  });
  it("kod dosyası (.ts) → reddet", () => {
    expect(isSafe({ ...flip, file: "bin/conduct.ts" })).toBe(false);
  });
  it("lane path (server/) → reddet", () => {
    expect(isSafe({ ...flip, file: "server/tool-registry.ts" })).toBe(false);
  });
  it("path traversal → reddet", () => {
    expect(isSafe({ ...flip, file: "../ollamas/AGENTS.md" })).toBe(false);
  });
  it("allowlist dışı kind → reddet", () => {
    expect(isSafe({ ...flip, kind: "duplication" })).toBe(false);
  });
});

describe("diffPreview", () => {
  it("SAFE etiketi + before→after", () => {
    const ops = planRoadmapFlips([{ kind: "crit:roadmap-drift:vO9", target: "vO9", detail: "", action: "" }], ROADMAP);
    const p = diffPreview(ops);
    expect(p).toMatch(/SAFE/);
    expect(p).toMatch(/vO9.*planned.*✅ DONE/);
  });
  it("boş → açıklama", () => {
    expect(diffPreview([])).toMatch(/yok/);
  });
});
