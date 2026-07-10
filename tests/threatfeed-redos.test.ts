// M-009 (V4) — ReDoS audit for the dynamic RegExp in server/threatfeed.ts:71-73
// (`tagContent`). FINDING: the `name` interpolated into the pattern is NOT
// user-controlled — every caller passes a fixed literal tag name ("title",
// "link", "pubDate", "date", "description", "published", "updated", "summary",
// "content"). The user-controlled value is the `block` STRING being matched, not
// the pattern. The pattern itself is linear-time (lazy `[\s\S]*?`, non-overlapping
// `[^>]*` before a required `>`), so no catastrophic backtracking exists — RE2 is
// unnecessary; the sink is annotated `nosemgrep` with this justification.
//
// This test proves it empirically: pathological feed XML (huge unterminated tags,
// many false tag-starts, giant valid bodies) parses in well under 100ms.
import { describe, test, expect } from "vitest";
import { parseRss, parseAtom } from "../server/threatfeed";

const timed = (fn: () => unknown): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("threatfeed ReDoS resistance (M-009)", () => {
  test("unterminated <title …> with a huge attribute run → fast, no match", () => {
    const evil = `<item><title ${"x".repeat(300_000)}`; // never closes '>' nor '</title>'
    let items: unknown[] = [];
    const dt = timed(() => { items = parseRss(evil, "src"); });
    expect(dt).toBeLessThan(100);
    expect(items).toEqual([]);
  });

  test("many false '<title' starts do not blow up (linear)", () => {
    const evil = `<item>${"<title".repeat(50_000)}</item>`;
    const dt = timed(() => parseRss(evil, "src"));
    expect(dt).toBeLessThan(100);
  });

  test("giant VALID body parses in linear time", () => {
    const big = `<item><title>${"a".repeat(500_000)}</title><link>http://x</link></item>`;
    let items: any[] = [];
    const dt = timed(() => { items = parseRss(big, "src"); });
    expect(dt).toBeLessThan(100);
    expect(items[0].title.length).toBeGreaterThan(100_000);
  });

  test("atom path is equally resistant", () => {
    const evil = `<entry><summary ${"y".repeat(300_000)}`;
    const dt = timed(() => parseAtom(evil, "src"));
    expect(dt).toBeLessThan(100);
  });
});
