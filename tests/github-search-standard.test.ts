import { describe, test, expect, beforeEach } from "vitest";
import {
  SEARCH_STANDARD, classifyAdoptFit, scoreRepo, runStandard, _resetCache, type Category,
} from "../server/github-search-standard";
import { _resetCache as _resetSearchCache } from "../server/github-search";
import type { GhFetch } from "../server/github";

const VALID_CATS: Category[] = ["adopt-mcp", "adopt-gateway", "competitor", "security-pattern", "local-model", "dependency-cve", "zero-dep"];

describe("SEARCH_STANDARD — shape invariants", () => {
  test("unique ids, valid category, non-empty rationale, ≤8 intents", () => {
    const ids = SEARCH_STANDARD.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEARCH_STANDARD.length).toBeLessThanOrEqual(8);
    for (const i of SEARCH_STANDARD) {
      expect(VALID_CATS).toContain(i.category);
      expect(i.rationale.length).toBeGreaterThan(10);
      expect(["repos", "issues"]).toContain(i.type);
      expect(i.query.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyAdoptFit — SPDX rule (mirrors licenses.ts)", () => {
  test("permissive → adopt", () => {
    for (const l of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"]) expect(classifyAdoptFit(l), l).toBe("adopt");
  });
  test("copyleft → idea-only", () => {
    for (const l of ["GPL-3.0", "AGPL-3.0", "LGPL-2.1"]) expect(classifyAdoptFit(l), l).toBe("idea-only");
  });
  test("null / NOASSERTION → unknown", () => {
    expect(classifyAdoptFit(null)).toBe("unknown");
    expect(classifyAdoptFit(undefined)).toBe("unknown");
    expect(classifyAdoptFit("NOASSERTION")).toBe("unknown");
  });
});

describe("scoreRepo — ranking", () => {
  const NOW = Date.parse("2026-07-03T00:00:00Z");
  test("fresh repo beats a same-magnitude stale one (recency breaks ties)", () => {
    // recency separates repos of similar star magnitude — not a 400-vs-100k giant
    // (log2 keeps a genuine giant high, which is correct).
    const stale = { full_name: "old/lib", stargazers_count: 3000, pushed_at: "2021-01-01T00:00:00Z", license: { spdx_id: "MIT" } };
    const fresh = { full_name: "new/lib", stargazers_count: 2000, pushed_at: "2026-06-25T00:00:00Z", license: { spdx_id: "MIT" } };
    expect(scoreRepo(fresh, NOW)).toBeGreaterThan(scoreRepo(stale, NOW));
  });
  test("adopt-fit bonus lifts permissive over copyleft at equal stars/recency", () => {
    const mit = { full_name: "a/mit", stargazers_count: 500, pushed_at: "2026-06-01T00:00:00Z", license: { spdx_id: "MIT" } };
    const gpl = { full_name: "a/gpl", stargazers_count: 500, pushed_at: "2026-06-01T00:00:00Z", license: { spdx_id: "GPL-3.0" } };
    expect(scoreRepo(mit, NOW)).toBeGreaterThan(scoreRepo(gpl, NOW));
  });
});

// Fake search backend keyed on the query's type; drives runStandard offline.
function standardFetch(perType: { repos?: any[]; issues?: any[] }, remainingSeq?: number[]): GhFetch {
  let call = 0;
  return async (url) => {
    const isCode = url.includes("/search/code");
    const isIssues = url.includes("/search/issues");
    const items = isIssues ? (perType.issues ?? []) : (perType.repos ?? []);
    const rem = remainingSeq ? String(remainingSeq[Math.min(call, remainingSeq.length - 1)]) : "20";
    call++;
    return { ok: !isCode, status: isCode ? 401 : 200, text: async () => JSON.stringify({ total_count: items.length, items }), headers: { get: (n: string) => (n.toLowerCase() === "x-ratelimit-remaining" ? rem : n.toLowerCase() === "x-ratelimit-limit" ? "30" : "0") } };
  };
}

describe("runStandard — engine", () => {
  beforeEach(() => { _resetCache(); _resetSearchCache(); });
  const NOW = () => Date.parse("2026-07-03T00:00:00Z");

  test("archived excluded, deduped by full_name, ranked, capped at 6", async () => {
    const repos = [
      { full_name: "x/a", stargazers_count: 900, pushed_at: "2026-06-01T00:00:00Z", license: { spdx_id: "MIT" } },
      { full_name: "x/a", stargazers_count: 900, pushed_at: "2026-06-01T00:00:00Z", license: { spdx_id: "MIT" } }, // dup
      { full_name: "x/archived", stargazers_count: 5000, archived: true, license: { spdx_id: "MIT" } },
      ...Array.from({ length: 10 }, (_, i) => ({ full_name: `x/r${i}`, stargazers_count: 100 + i, pushed_at: "2026-05-01T00:00:00Z", license: { spdx_id: "MIT" } })),
    ];
    const d = await runStandard({ token: "t", categories: ["adopt-mcp"], fetchImpl: standardFetch({ repos }), now: NOW });
    const cat = d.byCategory.find((c) => c.category === "adopt-mcp")!;
    const names = (cat.items as any[]).map((i) => i.full_name);
    expect(names).not.toContain("x/archived");           // archived filtered
    expect(names.filter((n) => n === "x/a").length).toBe(1); // deduped
    expect(cat.items.length).toBeLessThanOrEqual(6);      // capped
    expect((cat.items[0] as any).adoptFit).toBe("adopt"); // classified
  });

  test("category filter runs only the requested category", async () => {
    const d = await runStandard({ token: "t", categories: ["competitor"], fetchImpl: standardFetch({ repos: [{ full_name: "c/x", stargazers_count: 600, license: { spdx_id: "Apache-2.0" } }] }), now: NOW });
    expect(d.byCategory.every((c) => c.category === "competitor")).toBe(true);
    expect(d.intentsTotal).toBe(1);
  });

  test("auto-degrade: stops before a 403 when remaining < 3, emits partial note", async () => {
    // remaining drops: 5 → 2 after first call → engine stops before 2nd intent.
    const d = await runStandard({ token: "", fetchImpl: standardFetch({ repos: [{ full_name: "x/a", stargazers_count: 100, license: { spdx_id: "MIT" } }] }, [5, 2, 2, 2, 2, 2, 2, 2]), now: NOW });
    expect(d.intentsRun).toBeLessThan(d.intentsTotal);
    expect(d.note).toMatch(/kısmi|kota/);
  });

  test("rate limit surfaced on the digest", async () => {
    const d = await runStandard({ token: "t", categories: ["adopt-mcp"], fetchImpl: standardFetch({ repos: [] }, [25]), now: NOW });
    expect(d.rateLimit?.remaining).toBe(25);
  });
});
