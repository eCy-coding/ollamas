// Registry→brain bridge units (H5). One-way read; ids stable per category (idempotent upsert).
import { describe, it, expect } from "vitest";
import { entryToMemory } from "../brain-sync-registry";

describe("entryToMemory", () => {
  it("maps a proven entry to a stable learned memory", () => {
    const m = entryToMemory({
      category: "starvation",
      pattern: "starv|unfair",
      provenSolution: "FIFO ticket-lock (Lamport bakery).",
      sources: ["Lamport bakery algorithm"],
    });
    expect(m.id).toBe("preg:starvation");
    expect(m.tier).toBe("learned");
    expect(m.content).toContain("[starvation] FIFO ticket-lock");
    expect(m.content).toContain("kaynak: Lamport bakery");
    expect(m.source).toBe("problem-registry");
  });

  it("tolerates missing sources", () => {
    const m = entryToMemory({ category: "x", pattern: "p", provenSolution: "s" });
    expect(m.content).toBe("[x] s");
  });
});
