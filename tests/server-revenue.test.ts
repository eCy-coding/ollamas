import { describe, it, expect, vi, beforeEach } from "vitest";

// Hermetic: mock the vault DB + the GitHub REST client so no file/network I/O happens.
vi.mock("../server/db", () => {
  const decrypt = vi.fn((s: string) => (s ? "ghp_test_token" : ""));
  return { db: { data: { keys: {} as Record<string, string> }, save: vi.fn(), decrypt } };
});
vi.mock("../server/github", () => ({
  buildIssueBody: () => "## findings\n",
  createIssue: vi.fn(async () => ({ ok: true, data: { html_url: "https://github.com/o/r/issues/1" } })),
  parseRepoSlug: (s: string) => { const [owner, repo] = String(s).split("/"); return owner && repo ? { owner, repo } : null; },
  getDefaultBranch: vi.fn(async () => ({ ok: true, data: { sha: "abc123", branch: "main" } })),
  createBranch: vi.fn(async () => ({ ok: true })),
  putFile: vi.fn(async () => ({ ok: true })),
  createPullRequest: vi.fn(async () => ({ ok: true, data: { html_url: "https://github.com/o/r/pull/2" } })),
  auditBranchName: (n: string, suf?: string) => `ollamas-audit/${n}${suf ? `-${suf}` : ""}`,
}));

import { db } from "../server/db";
import { getRevenueConfig, setRevenueConfig, publishAuditToGitHub, publishAuditPR } from "../server/revenue";

beforeEach(() => {
  (db as any).data = { keys: {} };
  vi.clearAllMocks();
  (db as any).decrypt = vi.fn((s: string) => (s ? "ghp_test_token" : ""));
});

describe("revenue config — round-trip through the vault", () => {
  it("set then get merges + persists", () => {
    expect(getRevenueConfig()).toEqual({});
    const out = setRevenueConfig({ brand: "Acme", email: "a@b.co" });
    expect(out).toEqual({ brand: "Acme", email: "a@b.co" });
    expect(getRevenueConfig()).toEqual({ brand: "Acme", email: "a@b.co" });
    expect(db.save).toHaveBeenCalled();
    setRevenueConfig({ email: "x@y.co" }); // patch merges, keeps brand
    expect(getRevenueConfig()).toEqual({ brand: "Acme", email: "x@y.co" });
  });
});

describe("publishAuditToGitHub — honest graceful boundaries + happy path", () => {
  it("skips (no throw) when no target githubRepo", async () => {
    const r = await publishAuditToGitHub({ repo: "/tmp/x" });
    expect(r.skipped).toBe(true);
    expect(r.published).toBe(false);
  });

  it("skips when the vault has no GitHub token", async () => {
    (db as any).data.keys = {}; // no github slot → decrypt("") → ""
    const r = await publishAuditToGitHub({ repo: "/tmp/x", githubRepo: "owner/name" });
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/no GitHub token/i);
  });

  it("publishes an Issue + returns the URL when token + repo present", async () => {
    (db as any).data.keys = { github: "enc-token" };
    const r = await publishAuditToGitHub({ repo: "/tmp/somerepo", githubRepo: "owner/name" });
    expect(r.published).toBe(true);
    expect(r.issueUrl).toBe("https://github.com/o/r/issues/1");
  });
});

describe("publishAuditPR — graceful skips + happy path", () => {
  it("skips with no githubRepo / no token", async () => {
    expect((await publishAuditPR({ repo: "/tmp/x" })).skipped).toBe(true);
    (db as any).data.keys = {};
    expect((await publishAuditPR({ repo: "/tmp/x", githubRepo: "owner/name" })).skipped).toBe(true);
  });

  it("opens a PR + returns the URL when configured", async () => {
    (db as any).data.keys = { github: "enc-token" };
    const r = await publishAuditPR({ repo: "/tmp/somerepo", githubRepo: "owner/name" });
    expect(r.published).toBe(true);
    expect(r.prUrl).toBe("https://github.com/o/r/pull/2");
  });
});
