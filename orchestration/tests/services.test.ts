import { describe, it, expect } from "vitest";
import { SERVICES, NETWORK_SERVICES, validateRegistry, healthRunEvents } from "../bin/lib/services";

describe("service registry integrity", () => {
  it("exactly 50 services, unique ids, resolvable deps, valid kinds", () => {
    expect(validateRegistry()).toEqual([]);
    expect(SERVICES).toHaveLength(50);
  });
  it("network services are registered separately (4 real daemons)", () => {
    expect(NETWORK_SERVICES.map((n) => n.id)).toEqual(["net:ollamas", "net:odysseus", "net:pulse", "net:ollama"]);
  });
  it("validateRegistry catches duplicates and dangling deps", () => {
    const dup = [...SERVICES, SERVICES[0]];
    expect(validateRegistry(dup).some((p) => p.includes("duplicate"))).toBe(true);
    const dangling = SERVICES.map((s, i) => (i === 0 ? { ...s, deps: ["ghost-service"] } : s));
    expect(validateRegistry(dangling).some((p) => p.includes("unknown service"))).toBe(true);
  });
  it("health run start event is a 50-item checklist", () => {
    const ev = healthRunEvents("r", "2026-07-18T12:00:00Z");
    expect(ev.type).toBe("start");
    expect(ev.type === "start" && ev.items).toHaveLength(50);
  });
});

describe("every in-process selftest passes (50/50, one by one)", () => {
  for (const s of SERVICES) {
    it(`${s.id} (${s.kind}) — ${s.role}`, async () => {
      const r = await s.selftest();
      expect(r.ok, `${s.id}: ${r.evidence}`).toBe(true);
      expect(r.evidence.length).toBeGreaterThan(0);
    });
  }
});
