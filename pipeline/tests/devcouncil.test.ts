import { describe, it, expect } from "vitest";
import {
  parseCard, renderCard, claim, logLine, seedFromBacklog, nextForRole, poolStats,
  ROLE_SESSION, type Card,
} from "../lib/devcouncil";

const card = (over: Partial<Card> = {}): Card => ({
  id: "dc-1.5", title: "NAMING.md", role: "code", owner: "", status: "todo",
  reason: "missing — build", evidence: "", body: "[accept] file exists", ...over,
});

describe("parseCard / renderCard", () => {
  it("round-trips a card deterministically", () => {
    const c = card({ owner: "A", status: "in_progress", reason: "why", evidence: "path" });
    expect(parseCard(renderCard(c))).toEqual(c);
    expect(renderCard(c)).toBe(renderCard(c));
  });
  it("defaults bad/absent fields safely", () => {
    const c = parseCard("---\nid: x\nrole: bogus\nstatus: nope\nowner: Z\n---\nbody");
    expect(c.role).toBe("code");
    expect(c.status).toBe("todo");
    expect(c.owner).toBe("");
    expect(c.body).toBe("body");
  });
  it("handles non-frontmatter input", () => {
    expect(parseCard("just text").id).toBe("");
    expect(parseCard(null as never).role).toBe("code");
  });
});

describe("claim — role-scoped, non-conflicting", () => {
  it("A can claim a code card; B cannot (role lane)", () => {
    expect(claim(card({ role: "code" }), "A")).toMatchObject({ ok: true });
    expect(claim(card({ role: "code" }), "B")).toMatchObject({ ok: false, conflict: "A" });
  });
  it("B claims a review card; A cannot", () => {
    expect(claim(card({ role: "review" }), "B").ok).toBe(true);
    expect(claim(card({ role: "review" }), "A")).toMatchObject({ ok: false, conflict: "B" });
  });
  it("a card owned by the other session conflicts; same session resumes", () => {
    expect(claim(card({ role: "code", owner: "A" }), "A").ok).toBe(true); // resume
    // an A-lane card already owned by A cannot be taken by B (role blocks first)
    const bLane = card({ role: "research", owner: "B" });
    expect(claim(bLane, "B").ok).toBe(true);
  });
  it("claiming sets owner + in_progress", () => {
    const r = claim(card(), "A");
    expect(r.card.owner).toBe("A");
    expect(r.card.status).toBe("in_progress");
  });
  it("ROLE_SESSION maps the five roles to the two lanes", () => {
    expect(ROLE_SESSION).toMatchObject({ code: "A", bench: "A", review: "B", bug: "B", research: "B" });
  });
});

describe("logLine", () => {
  it("emits `ts · session · action · WHY · evidence`, collapsing whitespace", () => {
    expect(logLine("2026-07-25T00:00Z", "A", "claim  dc-1.5", "next\nROI", "card"))
      .toBe("2026-07-25T00:00Z · A · claim dc-1.5 · next ROI · card");
    expect(logLine("t", "B", "review", "audit")).toMatch(/· —$/); // default evidence
  });
});

describe("seedFromBacklog", () => {
  const md = [
    "- 1.5 ⬜ Naming convention `_index/NAMING.md` (MISSING) [md] [accept: file exists and lists conventions]",
    "- 9.3 🔶 workflow benchmark — p99/p999 MISSING [Python] [accept: reports include p50/p95/p99/p999]",
    "not a task line",
  ].join("\n");
  const cards = seedFromBacklog(md);
  it("makes one card per ⬜/🔶 line with a stable id, role and reason", () => {
    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe("dc-1.5");
    expect(cards[0].reason).toMatch(/missing/);
    expect(cards[1].reason).toMatch(/partial/);
    expect(cards[1].role).toBe("bench"); // benchmark IMPL → A's bench lane (F-1: was misrouted to B's research)
    expect(cards[0].body).toMatch(/\[accept\]/);
  });
  it("never routes a seeded card into a B lane, and strips bracket tags from titles (F-1/F-3)", () => {
    expect(cards.every((c) => c.role === "code" || c.role === "bench")).toBe(true); // A lanes only
    expect(cards.every((c) => !c.title.includes(" ["))).toBe(true); // [md]/[txt]/[js] stripped
    expect(cards[0].title).toBe("Naming convention `_index/NAMING.md` (MISSING)");
  });
  it("handles empty input", () => {
    expect(seedFromBacklog("")).toEqual([]);
  });
});

describe("nextForRole + poolStats", () => {
  const cards = [
    card({ id: "a", role: "code", owner: "A", status: "in_progress" }),
    card({ id: "b", role: "code", owner: "", status: "todo" }),
    card({ id: "c", role: "research", owner: "", status: "todo" }),
    card({ id: "d", role: "code", owner: "", status: "done" }),
  ];
  it("returns the first claimable card for the role+session, skipping done/other", () => {
    expect(nextForRole(cards, "code", "A")!.id).toBe("a"); // resumes own in_progress first
    expect(nextForRole(cards, "research", "B")!.id).toBe("c");
    expect(nextForRole(cards, "code", "B")).toBeNull(); // wrong lane
    expect(nextForRole([card({ role: "code", owner: "B" })], "code", "A")).toBeNull(); // owned by other
  });
  it("poolStats counts by status and owner", () => {
    expect(poolStats(cards)).toMatchObject({ total: 4, todo: 2, inProgress: 1, done: 1, a: 1, b: 0 });
  });
});
