import { describe, it, expect } from "vitest";
import { validateGitHubToken, ghTokenType, type GhFetch } from "../server/github";

// Minimal GhFetch stub: canned status/body + a headers map (for x-oauth-scopes).
function stub(opts: { status?: number; body?: unknown; headers?: Record<string, string>; throws?: boolean }): GhFetch {
  return (async () => {
    if (opts.throws) throw new Error("network error");
    const h = opts.headers ?? {};
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => JSON.stringify(opts.body ?? {}),
      headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
    };
  }) as unknown as GhFetch;
}

describe("github — ghTokenType", () => {
  it("classifies classic and fine-grained tokens by prefix", () => {
    expect(ghTokenType("ghp_" + "x".repeat(36))).toBe("classic");
    expect(ghTokenType("gho_" + "x".repeat(36))).toBe("classic");
    expect(ghTokenType("github_pat_11ABCDE")).toBe("fine-grained");
    expect(ghTokenType("random")).toBe("unknown");
  });
});

describe("github — validateGitHubToken (live /user)", () => {
  it("returns login + scopes for a valid classic token", async () => {
    const f = stub({ status: 200, body: { login: "emre" }, headers: { "x-oauth-scopes": "repo, workflow, read:org" } });
    const r = await validateGitHubToken("ghp_" + "a".repeat(36), f);
    expect(r).toMatchObject({ ok: true, login: "emre", tokenType: "classic" });
    expect(r.scopes).toEqual(["repo", "workflow", "read:org"]);
  });

  it("validates a fine-grained token (valid, but no oauth-scopes header — honest empty)", async () => {
    const f = stub({ status: 200, body: { login: "emre" } }); // no x-oauth-scopes
    const r = await validateGitHubToken("github_pat_11ABC", f);
    expect(r).toMatchObject({ ok: true, login: "emre", tokenType: "fine-grained" });
    expect(r.scopes).toEqual([]);
  });

  it("reports an invalid/expired token clearly on 401", async () => {
    const r = await validateGitHubToken("ghp_bad", stub({ status: 401 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/geçersiz|expired|süresi/);
  });

  it("is fail-soft on a network error (no throw)", async () => {
    const r = await validateGitHubToken("ghp_x", stub({ throws: true }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network/);
  });

  it("rejects an empty token without a request", async () => {
    const r = await validateGitHubToken("");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no token/);
  });
});
