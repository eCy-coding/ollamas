import { describe, it, expect } from "vitest";
import { terms, groundQuery, renderGrounding, type Note } from "../lib/vaultground";

const notes: Note[] = [
  { path: "a.md", text: "The Obsidian graph connects notes with wikilinks and the base view." },
  { path: "b.md", text: "ollamas router serves chat completions on port 3000 for free providers." },
  { path: "c.md", text: "eCym maps natural language to a terminal command via the dataset." },
];

describe("terms", () => {
  it("keeps content words ≥3 chars, drops stopwords, dedups", () => {
    const t = terms("the ollamas router AND the router");
    expect(t).toContain("ollamas");
    expect(t).toContain("router");
    expect(t).not.toContain("the");
    expect(t.filter((x) => x === "router")).toHaveLength(1);
  });
  it("handles empty/nullish", () => {
    expect(terms("")).toEqual([]);
    expect(terms(null as never)).toEqual([]);
  });
});

describe("groundQuery", () => {
  it("returns the most relevant note first with a snippet", () => {
    const g = groundQuery("ollamas router port", notes);
    expect(g.grounded).toBe(true);
    expect(g.citations[0].path).toBe("b.md");
    expect(g.citations[0].score).toBeGreaterThan(0);
    expect(g.citations[0].snippet).toMatch(/router/);
  });
  it("MISS ≠ PASS: no overlap → grounded:false, no invented citation", () => {
    const g = groundQuery("kubernetes helm chart", notes);
    expect(g.grounded).toBe(false);
    expect(g.citations).toEqual([]);
  });
  it("respects topK and is deterministic", () => {
    const g = groundQuery("notes command graph dataset", notes, 2);
    expect(g.citations.length).toBeLessThanOrEqual(2);
    expect(groundQuery("notes command graph dataset", notes, 2)).toEqual(g);
  });
  it("empty query or empty corpus → not grounded", () => {
    expect(groundQuery("", notes).grounded).toBe(false);
    expect(groundQuery("ollamas", []).grounded).toBe(false);
  });
});

describe("renderGrounding", () => {
  it("reports citations, or an honest no-grounding line", () => {
    expect(renderGrounding(groundQuery("ollamas router", notes))).toMatch(/kaynak:/);
    expect(renderGrounding(groundQuery("zzz nomatch", notes))).toMatch(/GROUNDING YOK/);
  });
});
