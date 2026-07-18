import { describe, it, expect } from "vitest";
import { channelStats, orderChannels, channelOutcomes, questionKey, renderScoreboard, CHANNEL_TASK_PREFIX } from "../bin/lib/answer-learn";
import type { LedgerEntry } from "../bin/lib/organization";

const TS = "2026-07-18T14:00:00Z";
const entry = (actorId: string, ok: boolean, task = "answer-fact:q1"): LedgerEntry =>
  ({ type: "outcome", tier: ok ? "episodic" : "learned", ts: TS, taskId: task, actorId, ok, summary: "s" });

describe("channelStats", () => {
  it("folds only answer-fact outcomes, computes wilson", () => {
    const m = channelStats([
      entry("cloud:groq", false), entry("cloud:groq", true), entry("cloud:groq", true),
      entry("cloud:gemini", true, "other-task"),           // wrong prefix → ignored
      { type: "dispatch", tier: "episodic", ts: TS, taskId: "answer-fact:q1", actorId: "x", summary: "d" },
    ]);
    expect(m.get("cloud:groq")).toMatchObject({ n: 3, ok: 2 });
    expect(m.has("cloud:gemini")).toBe(false);
  });
});

describe("orderChannels (the loop gets better with evidence)", () => {
  const baseline = ["odysseus-research", "cloud:groq", "cloud:gemini"];
  it("evidence re-ranks: an accurate later channel jumps ahead of an inaccurate earlier one", () => {
    const stats = channelStats([
      entry("cloud:groq", false), entry("cloud:groq", false), entry("cloud:groq", true),
      entry("cloud:gemini", true), entry("cloud:gemini", true), entry("cloud:gemini", true),
    ]);
    const order = orderChannels(baseline, stats);
    expect(order.indexOf("cloud:gemini")).toBeLessThan(order.indexOf("cloud:groq"));
  });
  it("thin evidence (n<3) bids neutral — baseline order preserved", () => {
    const stats = channelStats([entry("cloud:gemini", true), entry("cloud:gemini", true)]);
    expect(orderChannels(baseline, stats)).toEqual(baseline);
  });
  it("deterministic on ties", () => {
    expect(orderChannels(baseline, new Map())).toEqual(baseline);
  });
});

describe("channelOutcomes (evidence only WITH ground truth)", () => {
  const attempts = [
    { channel: "odysseus-research", ok: true, fact: "2012" },
    { channel: "cloud:groq", ok: true, fact: "2014" },   // outvoted
    { channel: "cloud:gemini", ok: true, fact: "2012" },
    { channel: "cloud:cerebras", ok: false, fact: null }, // silent
  ];
  it("backers=hit, outvoted=miss, silent=miss; taskId carries the prefix", () => {
    const es = channelOutcomes("q1", attempts, "2012", TS);
    const byId = Object.fromEntries(es.map((e) => [e.actorId, e]));
    expect(byId["odysseus-research"].ok).toBe(true);
    expect(byId["cloud:groq"].ok).toBe(false);
    expect(byId["cloud:groq"].summary).toContain("OUTVOTED");
    expect(byId["cloud:cerebras"].ok).toBe(false);
    expect(es.every((e) => e.taskId === `${CHANNEL_TASK_PREFIX}q1`)).toBe(true);
  });
  it("NO agreement → NO records (recording without ground truth would be guessing)", () => {
    expect(channelOutcomes("q1", attempts, null, TS)).toEqual([]);
  });
});

describe("questionKey + scoreboard", () => {
  it("key is stable and short", () => {
    expect(questionKey("abc")).toBe(questionKey("abc"));
    expect(questionKey("abc")).not.toBe(questionKey("abd"));
  });
  it("scoreboard sorts best-first", () => {
    const m = channelStats([
      entry("a", true), entry("a", true), entry("a", true), entry("a", true),
      entry("b", false), entry("b", false), entry("b", false),
    ]);
    const board = renderScoreboard(m);
    expect(board[0]).toContain("a");
    expect(board[1]).toContain("b");
  });
});
