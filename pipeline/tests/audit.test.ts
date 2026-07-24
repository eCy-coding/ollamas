import { describe, it, expect } from "vitest";
import { audit, renderAudit, AUDIT_CHECKS, type AuditFacts } from "../lib/audit";

const allTrue: AuditFacts = {
  metricsObserved: true,
  cacheExercised: true,
  parallelismUsed: true,
  warmPoolUsed: true,
  ciGatePresent: true,
  securityScanRan: true,
  chaosRan: true,
  coverageMeasured: true,
  reproducibleArtifact: true,
  repeatedRuns: true,
};

describe("audit", () => {
  it("is complete when every capability was exercised", () => {
    const r = audit(allTrue);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.todo).toEqual([]);
    expect(r.score).toBe(`${AUDIT_CHECKS.length}/${AUDIT_CHECKS.length}`);
  });

  // The core rule: absent evidence is NOT evidence of absence of problems. A run that never
  // injected a fault must not be able to claim resilience.
  it("counts an ABSENT fact as missing, never as satisfied", () => {
    const r = audit({});
    expect(r.complete).toBe(false);
    expect(r.missing).toHaveLength(AUDIT_CHECKS.length);
    expect(r.satisfied).toEqual([]);
  });

  it("treats a falsy-but-present fact as missing too", () => {
    const r = audit({ ...allTrue, chaosRan: false });
    expect(r.missing).toEqual(["chaos"]);
    expect(r.complete).toBe(false);
  });

  it("files one actionable corrective task per gap, with an owner and an estimate", () => {
    const r = audit({ ...allTrue, warmPoolUsed: false, securityScanRan: false });
    expect(r.todo).toHaveLength(2);
    for (const t of r.todo) {
      expect(t.id).toMatch(/^A\d+$/);
      expect(t.owner).toBeTruthy();
      expect(t.estimate_h).toBeGreaterThan(0);
      expect(t.status).toBe("todo");
      expect(t.description).toMatch(/: /); // "label: how to fix it"
    }
    expect(r.todo.map((t) => t.description).join(" ")).toMatch(/warm sandbox pool/);
  });

  it("gives every gap a stable id so re-runs do not renumber unrelated tasks", () => {
    const a = audit({ ...allTrue, chaosRan: false });
    const b = audit({ ...allTrue, chaosRan: false, cacheExercised: false });
    const chaosId = (r: ReturnType<typeof audit>) => r.todo.find((t) => t.description.startsWith("chaos"))!.id;
    expect(chaosId(a)).toBe(chaosId(b));
  });

  it("covers exactly the checklist the prompt names", () => {
    expect(new Set(AUDIT_CHECKS.map((c) => c.label))).toEqual(new Set([
      "observability", "caching", "parallelism", "warm-pool", "CI-gate",
      "security", "chaos", "coverage", "reproducibility", "repetition",
    ]));
  });
});

describe("renderAudit", () => {
  it("ticks satisfied items and crosses gaps", () => {
    const lines = renderAudit(audit({ ...allTrue, chaosRan: false }));
    expect(lines.some((l) => l.startsWith("  ✓ observability"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  ✗ chaos"))).toBe(true);
    expect(lines.at(-1)).toMatch(/corrective task\(s\) filed/);
  });

  it("says so plainly when there are no blind spots", () => {
    expect(renderAudit(audit(allTrue)).at(-1)).toMatch(/no blind spots/);
  });
});
