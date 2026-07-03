import { describe, test, expect, beforeEach } from "vitest";
import { searchRepos, type GhFetch } from "../server/github";
import { searchGitHub, _resetCache } from "../server/github-search";

function fakeGh(opts: { status?: number; body?: unknown; remaining?: string } = {}): { fetch: GhFetch; calls: { url: string; authed: boolean }[] } {
  const calls: { url: string; authed: boolean }[] = [];
  const fetch: GhFetch = async (url, init) => {
    calls.push({ url, authed: "Authorization" in init.headers });
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => (opts.body === undefined ? "" : JSON.stringify(opts.body)),
      headers: { get: (n: string) => (n.toLowerCase() === "x-ratelimit-remaining" ? (opts.remaining ?? "9") : n.toLowerCase() === "x-ratelimit-limit" ? "10" : "0") },
    };
  };
  return { fetch, calls };
}

describe("searchGitHub — repos/issues (anon)", () => {
  beforeEach(() => _resetCache());

  test("search-repos-shape: anon read, items + total + rate limit", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 42, items: [{ full_name: "ollama/ollama", stargazers_count: 100 }] }, remaining: "8" });
    const p = await searchGitHub({ type: "repos", q: "ollama", token: "", fetchImpl: fetch });
    expect(p.ok).toBe(true);
    expect(p.authed).toBe(false);
    expect(p.total).toBe(42);
    expect((p.items[0] as any).full_name).toBe("ollama/ollama");
    expect(p.rateLimit?.remaining).toBe(8);
    expect(calls[0]!.authed).toBe(false);
    expect(calls[0]!.url).toContain("/search/repositories?q=ollama");
  });

  test("search-issues-shape", async () => {
    const { fetch } = fakeGh({ body: { total_count: 3, items: [{ title: "bug", state: "open", number: 7 }] } });
    const p = await searchGitHub({ type: "issues", q: "is:open bug", token: "", fetchImpl: fetch });
    expect(p.ok).toBe(true);
    expect((p.items[0] as any).number).toBe(7);
  });

  test("query-encoded: spaces/slashes percent-encoded, qualifiers preserved", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 0, items: [] } });
    await searchGitHub({ type: "repos", q: "a b/c language:ts", token: "", fetchImpl: fetch });
    const url = calls[0]!.url;
    expect(url).toContain("q=a%20b%2Fc%20language%3Ats");
    expect(url).not.toMatch(/q=a b/); // never a raw space
  });
});

describe("searchGitHub — code requires token", () => {
  beforeEach(() => _resetCache());
  test("code-requires-token: no token → error, NO fetch", async () => {
    let called = false;
    const fetch: GhFetch = async () => { called = true; return { ok: true, status: 200, text: async () => "{}", headers: { get: () => null } }; };
    const p = await searchGitHub({ type: "code", q: "foo", token: "", fetchImpl: fetch });
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/token/i);
    expect(called).toBe(false); // request never burned
  });
  test("code with token sends Authorization", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 1, items: [{ path: "a.ts", repository: { full_name: "x/y" } }] } });
    const p = await searchGitHub({ type: "code", q: "foo", token: "ghp_x", fetchImpl: fetch });
    expect(p.ok).toBe(true);
    expect(calls[0]!.authed).toBe(true);
    expect(calls[0]!.url).toContain("/search/code?q=foo");
  });
});

describe("searchGitHub — validation + cache", () => {
  beforeEach(() => _resetCache());
  test("bad-type-rejected: throws (route maps to 400)", async () => {
    await expect(searchGitHub({ type: "users", q: "x", token: "" })).rejects.toThrow(/invalid search type/);
  });
  test("empty query rejected", async () => {
    await expect(searchGitHub({ type: "repos", q: "   ", token: "" })).rejects.toThrow(/empty query/);
  });
  test("cache-ttl: 45s serves cache; refresh bypasses", async () => {
    let n = 0;
    const fetch: GhFetch = async () => { n++; return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, items: [] }), headers: { get: () => null } }; };
    let t = 1_000_000; const now = () => t;
    await searchGitHub({ type: "repos", q: "x", token: "", fetchImpl: fetch, now });
    await searchGitHub({ type: "repos", q: "x", token: "", fetchImpl: fetch, now }); // cached
    expect(n).toBe(1);
    t += 46_000;
    await searchGitHub({ type: "repos", q: "x", token: "", fetchImpl: fetch, now });
    expect(n).toBe(2);
    await searchGitHub({ type: "repos", q: "x", token: "", fetchImpl: fetch, now, refresh: true });
    expect(n).toBe(3);
  });
  test("rate-limit-surfaced on error path too", async () => {
    const { fetch } = fakeGh({ status: 403, body: { message: "rate limit" }, remaining: "0" });
    const p = await searchGitHub({ type: "repos", q: "x", token: "", fetchImpl: fetch });
    expect(p.ok).toBe(false);
    expect(p.rateLimit?.remaining).toBe(0);
  });
});

// searchRepos is exercised directly to prove the anon path omits Authorization.
describe("searchRepos verb", () => {
  test("anon call omits Authorization header", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 0, items: [] } });
    await searchRepos("ollama", "", undefined, fetch);
    expect(calls[0]!.authed).toBe(false);
  });
});
