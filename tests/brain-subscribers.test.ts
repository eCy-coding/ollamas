// S30-S44 subscribers: events must fold into DAILY rollups (not per-event rows),
// snapshot pollers must assert only CHANGES, and everything lands in ops ns with
// deterministic day-bucketed ids (same-day re-flush upserts, never duplicates).
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { emit, resetBusForTests } from "../server/brain-bus";
import { registerBrainSubscribers, OPS_NS, type BrainSubscribers } from "../server/brain-subscribers";
import type { BrainMemoryInput, BrainFactInput } from "../server/brain";

let mems: BrainMemoryInput[];
let facts: BrainFactInput[];
let subs: BrainSubscribers | null = null;
const writer = {
  remember: async (m: BrainMemoryInput) => { mems.push(m); return {}; },
  assertFact: async (f: BrainFactInput) => { facts.push(f); return {}; },
};
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const AT = Date.parse("2026-07-18T12:00:00Z");

beforeEach(() => {
  resetBusForTests();
  mems = [];
  facts = [];
});
afterEach(() => { subs?.stop(); subs = null; });

describe("brain-subscribers (S30/S31/S33/S34/S44)", () => {
  test("hundred tool outcomes fold into ONE procedural line per tool per day", async () => {
    subs = registerBrainSubscribers(writer, {}, { intervalMs: 1e9, now: () => AT });
    for (let i = 0; i < 100; i++) {
      emit({ type: "tool.outcome", source: "tool-registry", at: AT, payload: { tool: "web_search", ok: i % 4 !== 0 } });
    }
    emit({ type: "tool.outcome", source: "tool-registry", at: AT, payload: { tool: "write_file", ok: true } });
    await settle();
    const r = await subs.flushNow();
    expect(r.tools).toBe(2);
    const ws = mems.find((m) => m.content.includes("web_search"))!;
    expect(ws.tier).toBe("procedural");
    expect(ws.ns).toBe(OPS_NS);
    expect(ws.content).toContain("75 ok / 25 fail");
    expect(ws.id).toBe(mems.find((m) => m.content.includes("web_search"))!.id); // deterministic
    // second flush with no new events writes nothing
    expect((await subs.flushNow()).tools).toBe(0);
  });

  test("errors/jobs/council/align each fold into their tier with day-bucket ids", async () => {
    subs = registerBrainSubscribers(writer, {}, { intervalMs: 1e9, now: () => AT });
    emit({ type: "error.recorded", source: "error-tracking", at: AT, payload: { signature: "route:boom" } });
    emit({ type: "error.recorded", source: "error-tracking", at: AT, payload: { signature: "route:boom" } });
    emit({ type: "job.outcome", source: "jobs", at: AT, payload: { name: "webhook-retry", outcome: "failed" } });
    emit({ type: "council.score", source: "council", at: AT, payload: { model: "qwen3:8b", score: 1 } });
    emit({ type: "council.score", source: "council", at: AT, payload: { model: "qwen3:8b", score: 0 } });
    emit({ type: "align.verdict", source: "verifier", at: AT, payload: { ok: true } });
    await settle();
    const r = await subs.flushNow();
    expect(r).toMatchObject({ errors: 1, jobs: 1, council: 1, align: 1 });
    expect(mems.find((m) => m.content.includes("×2"))?.tier).toBe("learned");
    expect(mems.find((m) => m.content.includes("webhook-retry"))?.content).toContain("0 done / 1 failed");
    expect(mems.find((m) => m.content.includes("qwen3:8b"))?.content).toContain("avg score 0.500 over 2");
  });

  test("pollers assert only CHANGES (steady state stays silent)", async () => {
    let verdict = "ok";
    subs = registerBrainSubscribers(writer, {
      providerVerdicts: () => ({ pollinations: verdict }),
      upstreamStatus: () => ({ odysseus: "ready" }),
      champion: () => "qwen3:8b",
    }, { intervalMs: 1e9, now: () => AT });
    const r1 = await subs.flushNow();
    expect(r1.polledFacts).toBe(3); // first sight of all three
    const r2 = await subs.flushNow();
    expect(r2.polledFacts).toBe(0); // nothing changed
    verdict = "cooled";
    const r3 = await subs.flushNow();
    expect(r3.polledFacts).toBe(1); // only the provider transition
    expect(facts.at(-1)).toMatchObject({ subject: "provider:pollinations", object: "cooled", ns: OPS_NS });
  });

  test("singleton guard + stop() releases it", () => {
    subs = registerBrainSubscribers(writer, {}, { intervalMs: 1e9 });
    expect(() => registerBrainSubscribers(writer)).toThrow(/already installed/);
    subs.stop();
    subs = registerBrainSubscribers(writer, {}, { intervalMs: 1e9 }); // re-install allowed after stop
  });
});
