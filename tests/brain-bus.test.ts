// S26+S46: the bus is the integration choke-point — its three contracts are
// exactly what every bridge leans on: emit can never hurt the emitter, budgets
// bound each source's daily writes, and ids are deterministic (idempotent
// re-emits). All in-memory, fully deterministic.
import { describe, test, expect, beforeEach } from "vitest";
import {
  subscribe, emit, budgetAllow, budgetCap, deterministicId, getBusStats, resetBusForTests,
  type BrainEvent,
} from "../server/brain-bus";

const ev = (over: Partial<BrainEvent> = {}): BrainEvent => ({
  type: "tool.outcome", source: "tool-registry", at: 1_784_000_000_000, payload: { ok: true }, ...over,
});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => resetBusForTests());

describe("brain-bus (S26)", () => {
  test("emit fans out to type + wildcard subscribers, async", async () => {
    const seen: string[] = [];
    subscribe("tool.outcome", (e) => { seen.push(`typed:${e.type}`); });
    subscribe("*", (e) => { seen.push(`star:${e.type}`); });
    emit(ev());
    expect(seen).toEqual([]); // handlers are async — the emitter never waits
    await settle();
    expect(seen.sort()).toEqual(["star:tool.outcome", "typed:tool.outcome"]);
    expect(getBusStats()).toMatchObject({ emitted: { "tool.outcome": 1 }, handled: 2, failed: 0 });
  });

  test("a throwing/rejecting subscriber cannot break the emitter or its peers", async () => {
    const seen: string[] = [];
    subscribe("tool.outcome", () => { throw new Error("sync boom"); });
    subscribe("tool.outcome", async () => { throw new Error("async boom"); });
    subscribe("tool.outcome", () => { seen.push("survivor"); });
    expect(() => emit(ev())).not.toThrow();
    await settle();
    await settle(); // let the rejected promise settle too
    expect(seen).toEqual(["survivor"]);
    expect(getBusStats().failed).toBe(2);
  });

  test("unsubscribe stops delivery", async () => {
    const seen: number[] = [];
    const off = subscribe("council.score", () => { seen.push(1); });
    emit(ev({ type: "council.score" }));
    await settle();
    off();
    emit(ev({ type: "council.score" }));
    await settle();
    expect(seen).toEqual([1]);
  });
});

describe("ingest budget (S46)", () => {
  test("caps per source per day; denial counted, other sources unaffected", () => {
    const t0 = Date.parse("2026-07-18T10:00:00Z");
    process.env.BRAIN_INGEST_BUDGET = "3";
    try {
      expect(budgetCap()).toBe(3);
      expect(budgetAllow("seyir", t0)).toBe(true);
      expect(budgetAllow("seyir", t0)).toBe(true);
      expect(budgetAllow("seyir", t0)).toBe(true);
      expect(budgetAllow("seyir", t0)).toBe(false); // 4th denied
      expect(budgetAllow("kev", t0)).toBe(true); // independent source
      expect(getBusStats().denied).toEqual({ seyir: 1 });
    } finally {
      delete process.env.BRAIN_INGEST_BUDGET;
    }
  });

  test("budget resets at the UTC day boundary", () => {
    process.env.BRAIN_INGEST_BUDGET = "1";
    try {
      const t0 = Date.parse("2026-07-18T23:59:00Z");
      expect(budgetAllow("seyir", t0)).toBe(true);
      expect(budgetAllow("seyir", t0)).toBe(false);
      expect(budgetAllow("seyir", t0 + 2 * 60_000)).toBe(true); // next day
    } finally {
      delete process.env.BRAIN_INGEST_BUDGET;
    }
  });

  test("bad env falls back to the 200 default", () => {
    process.env.BRAIN_INGEST_BUDGET = "junk";
    try {
      expect(budgetCap()).toBe(200);
    } finally {
      delete process.env.BRAIN_INGEST_BUDGET;
    }
  });
});

describe("deterministicId", () => {
  test("stable, source-prefixed, collision-separated by source", () => {
    const a = deterministicId("seyir", "line-42");
    expect(a).toBe(deterministicId("seyir", "line-42"));
    expect(a).toMatch(/^seyir:[0-9a-f]{40}$/);
    expect(deterministicId("kev", "line-42")).not.toBe(a);
  });
});
