// S27+S28: the registry is only worth having if its structure is enforced and
// every declared selftest actually proves its service. Full offline sweep runs
// here (network entries excluded — the live probes belong to `make brain-services`).
import { describe, test, expect } from "vitest";
import { BRAIN_SERVICES, validateBrainRegistry, registrySummary } from "../server/brain-services";

describe("brain service registry (S27)", () => {
  test("structure: EXACTLY 50 services, unique ids, resolvable deps", () => {
    const v = validateBrainRegistry(BRAIN_SERVICES, { expectCount: 50 });
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(BRAIN_SERVICES).toHaveLength(50);
  });

  test("expectCount contract catches a wrong total", () => {
    const v = validateBrainRegistry(BRAIN_SERVICES, { expectCount: 9999 });
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("expected 9999");
  });

  test("summary counts kinds", () => {
    const s = registrySummary(BRAIN_SERVICES);
    expect(s.total).toBe(BRAIN_SERVICES.length);
    expect(Object.values(s.byKind).reduce((a, b) => a + b, 0)).toBe(s.total);
  });
});

describe("offline selftest sweep (S28 semantics)", () => {
  const offline = BRAIN_SERVICES.filter((s) => s.kind !== "network");
  test.each(offline.map((s) => [s.id, s] as const))("%s selftest green", async (_id, spec) => {
    const r = await spec.selftest();
    expect(r.ok, r.evidence).toBe(true);
  }, 20_000);
});
