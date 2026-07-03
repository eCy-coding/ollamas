import { describe, test, expect, beforeEach } from "vitest";
import {
  assertActionsTarget, assertJobId, assertWorkflowId, validateRef, normalizeInputs,
  rerunFailedJobs, cancelRun, dispatchWorkflow, getJobLog, type GhFetch,
} from "../server/github";
import { getRuns, getJobs, getWorkflows, detectRepoSlug, _resetCache } from "../server/github-actions";

// Fake GitHub fetch: records the URL + whether Authorization was sent, returns a
// canned body + rate-limit headers. Mirrors threatfeed's injectable-fetch style.
function fakeGh(opts: { status?: number; body?: unknown; remaining?: string } = {}): { fetch: GhFetch; calls: { url: string; authed: boolean }[] } {
  const calls: { url: string; authed: boolean }[] = [];
  const fetch: GhFetch = async (url, init) => {
    calls.push({ url, authed: "Authorization" in init.headers });
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      statusText: "OK",
      text: async () => (opts.body === undefined ? "" : JSON.stringify(opts.body)),
      headers: { get: (n: string) => (n.toLowerCase() === "x-ratelimit-remaining" ? (opts.remaining ?? "58") : n.toLowerCase() === "x-ratelimit-limit" ? "60" : "0") },
    };
  };
  return { fetch, calls };
}

describe("assertActionsTarget — API path-injection defense", () => {
  test("rejects traversal / encoded / empty / overlong / unicode owner-repo", () => {
    expect(() => assertActionsTarget("..", "repo")).toThrow();
    expect(() => assertActionsTarget("owner", "..")).toThrow();
    expect(() => assertActionsTarget(".", "repo")).toThrow();
    expect(() => assertActionsTarget("a%2fb", "repo")).toThrow();   // encoded slash
    expect(() => assertActionsTarget("a/b", "repo")).toThrow();     // literal slash
    expect(() => assertActionsTarget("", "repo")).toThrow();
    expect(() => assertActionsTarget("a".repeat(40), "repo")).toThrow(); // overlong owner
    expect(() => assertActionsTarget("öwner", "repo")).toThrow();   // unicode
    expect(() => assertActionsTarget("a\\b", "repo")).toThrow();    // backslash
    expect(() => assertActionsTarget("-lead", "repo")).toThrow();   // must start alnum
  });

  test("accepts valid slugs; run_id must be pure digits", () => {
    expect(() => assertActionsTarget("eCy-coding", "ollamas")).not.toThrow();
    expect(() => assertActionsTarget("a.b_c-d", "Repo.Name_1")).not.toThrow();
    expect(() => assertActionsTarget("o", "r", "123")).not.toThrow();
    for (const bad of ["1e3", "0x1", "1/rerun", "1 ", "", "-1", "1.0"]) {
      expect(() => assertActionsTarget("o", "r", bad), `run_id ${bad}`).toThrow();
    }
  });
});

describe("listWorkflowRuns / getRuns", () => {
  beforeEach(() => _resetCache());

  test("anon read omits Authorization; shapes runs + rate limit; authed=false", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 1, workflow_runs: [{ id: 42, name: "CI", status: "completed", conclusion: "success" }] }, remaining: "57" });
    const p = await getRuns({ owner: "eCy-coding", repo: "ollamas", token: "", fetchImpl: fetch });
    expect(p.ok).toBe(true);
    expect(p.authed).toBe(false);
    expect(p.runs[0]!.id).toBe(42);
    expect(p.rateLimit?.remaining).toBe(57);
    expect(calls[0]!.authed).toBe(false);            // no token → no auth header
    expect(calls[0]!.url).toContain("/repos/eCy-coding/ollamas/actions/runs?per_page=20");
  });

  test("with token: Authorization sent, authed=true", async () => {
    const { fetch, calls } = fakeGh({ body: { total_count: 0, workflow_runs: [] } });
    const p = await getRuns({ owner: "o", repo: "r", token: "ghp_x", fetchImpl: fetch });
    expect(p.authed).toBe(true);
    expect(calls[0]!.authed).toBe(true);
  });

  test("30s TTL serves cache; refresh bypasses", async () => {
    let n = 0;
    const fetch: GhFetch = async () => { n++; return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: [] }), headers: { get: () => null } }; };
    let t = 1_000_000;
    const now = () => t;
    await getRuns({ owner: "o", repo: "r", token: "", fetchImpl: fetch, now });
    await getRuns({ owner: "o", repo: "r", token: "", fetchImpl: fetch, now }); // cached
    expect(n).toBe(1);
    t += 31_000; // past TTL
    await getRuns({ owner: "o", repo: "r", token: "", fetchImpl: fetch, now });
    expect(n).toBe(2);
    await getRuns({ owner: "o", repo: "r", token: "", fetchImpl: fetch, now, refresh: true });
    expect(n).toBe(3);
  });

  test("getRuns throws on injection (route maps to 400)", async () => {
    await expect(getRuns({ owner: "..", repo: "r", token: "" })).rejects.toThrow();
  });
});

describe("getJobs — drill-down", () => {
  test("returns jobs with steps", async () => {
    const { fetch } = fakeGh({ body: { total_count: 1, jobs: [{ name: "build", status: "completed", conclusion: "failure", steps: [{ name: "test", conclusion: "failure", number: 3 }] }] } });
    const r = await getJobs({ owner: "o", repo: "r", runId: "42", token: "", fetchImpl: fetch });
    expect(r.ok).toBe(true);
    expect(r.jobs[0]!.steps![0]!.conclusion).toBe("failure");
  });
});

describe("write verbs require a token (hard-fail preserved)", () => {
  test("rerun/cancel with empty token → not ok, no fetch", async () => {
    const { fetch, calls } = fakeGh({ status: 201 });
    const rr = await rerunFailedJobs("o", "r", "42", "", undefined, fetch);
    const cc = await cancelRun("o", "r", "42", "", undefined, fetch);
    expect(rr.ok).toBe(false);
    expect(cc.ok).toBe(false);
    expect(calls.length).toBe(0); // strict guard short-circuits before fetch
  });

  test("rerun with token POSTs to rerun-failed-jobs and treats 201 empty as success", async () => {
    const { fetch, calls } = fakeGh({ status: 201, body: undefined });
    const rr = await rerunFailedJobs("eCy-coding", "ollamas", "42", "ghp_x", undefined, fetch);
    expect(rr.ok).toBe(true);
    expect(calls[0]!.url).toContain("/actions/runs/42/rerun-failed-jobs");
    expect(calls[0]!.authed).toBe(true);
  });
});

describe("new path/param validators (dalga-7)", () => {
  test("assertJobId: pure digits only", () => {
    expect(() => assertJobId("123")).not.toThrow();
    for (const bad of ["1e3", "0x1", "abc", "1/x", "", "-1"]) expect(() => assertJobId(bad), bad).toThrow();
  });
  test("assertWorkflowId: numeric OR safe yaml filename; traversal rejected", () => {
    expect(() => assertWorkflowId("123")).not.toThrow();
    expect(() => assertWorkflowId("ci.yml")).not.toThrow();
    expect(() => assertWorkflowId("release.yaml")).not.toThrow();
    for (const bad of ["../x.yml", "a/b.yml", "x.txt", "..", "ci.yml/../x", "ci yml"]) expect(() => assertWorkflowId(bad), bad).toThrow();
  });
  test("validateRef: git ref charset, no traversal", () => {
    expect(() => validateRef("main")).not.toThrow();
    expect(() => validateRef("feature/x-1")).not.toThrow();
    for (const bad of ["../etc", "a..b", "a b", "a;b", "", "a".repeat(300)]) expect(() => validateRef(bad), bad).toThrow();
  });
  test("normalizeInputs: object→string values, caps", () => {
    expect(normalizeInputs(undefined)).toEqual({});
    expect(normalizeInputs({ a: 1, b: true })).toEqual({ a: "1", b: "true" });
    expect(() => normalizeInputs([1, 2])).toThrow();
    expect(() => normalizeInputs("x")).toThrow();
    const many: Record<string, number> = {}; for (let i = 0; i < 21; i++) many[`k${i}`] = i;
    expect(() => normalizeInputs(many)).toThrow();
    expect(() => normalizeInputs({ big: "x".repeat(5000) })).toThrow();
  });
});

describe("getJobLog — redirect-safe, PAT never leaks to blob", () => {
  test("302→Location→blob body; blob fetch carries NO Authorization", async () => {
    const calls: { url: string; authed: boolean }[] = [];
    const fetch: GhFetch = async (url, init) => {
      calls.push({ url, authed: "Authorization" in init.headers });
      if (url.includes("/jobs/42/logs")) {
        return { ok: false, status: 302, text: async () => "", headers: { get: (n: string) => (n.toLowerCase() === "location" ? "https://blob.example/log?sig=x" : null) } };
      }
      return { ok: true, status: 200, text: async () => Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n"), headers: { get: () => null } };
    };
    const r = await getJobLog("o", "r", "42", "ghp_secret", undefined, fetch);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);              // 250 lines → tail 200
    expect(r.text!.split("\n").length).toBe(200);
    // The GitHub logs call carried auth; the BLOB call must NOT.
    expect(calls[0]!.url).toContain("/jobs/42/logs");
    expect(calls[0]!.authed).toBe(true);
    expect(calls[1]!.url).toContain("blob.example");
    expect(calls[1]!.authed).toBe(false);        // ← PAT-leak defense
  });

  test("302 without Location → error", async () => {
    const fetch: GhFetch = async () => ({ ok: false, status: 302, text: async () => "", headers: { get: () => null } });
    expect((await getJobLog("o", "r", "1", "", undefined, fetch)).ok).toBe(false);
  });

  test("rejects non-numeric job id before any fetch (route maps throw→400)", async () => {
    let called = false;
    const fetch: GhFetch = async () => { called = true; return { ok: true, status: 200, text: async () => "", headers: { get: () => null } }; };
    await expect(getJobLog("o", "r", "1e3", "", undefined, fetch)).rejects.toThrow(/job id/);
    expect(called).toBe(false); // validation throws before any network call
  });
});

describe("dispatchWorkflow + getWorkflows", () => {
  beforeEach(() => _resetCache());
  test("dispatch requires a token (no fetch when empty)", async () => {
    let called = false;
    const fetch: GhFetch = async () => { called = true; return { ok: true, status: 204, text: async () => "", headers: { get: () => null } }; };
    const r = await dispatchWorkflow("o", "r", "ci.yml", "main", { a: 1 }, "", undefined, fetch);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  test("dispatch with token POSTs ref+inputs, 204→ok", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetch: GhFetch = async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, status: 204, text: async () => "", headers: { get: () => null } }; };
    const r = await dispatchWorkflow("eCy-coding", "ollamas", "ci.yml", "main", { name: "x" }, "ghp_x", undefined, fetch);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toContain("/actions/workflows/ci.yml/dispatches");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ref: "main", inputs: { name: "x" } });
  });
  test("getWorkflows filters to active only", async () => {
    const fetch: GhFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ total_count: 2, workflows: [{ id: 1, name: "CI", state: "active" }, { id: 2, name: "Old", state: "disabled_manually" }] }), headers: { get: () => null } });
    const r = await getWorkflows({ owner: "o", repo: "r", token: "", fetchImpl: fetch });
    expect(r.workflows.map((w) => w.id)).toEqual([1]);
  });
});

describe("detectRepoSlug — injectable git exec", () => {
  test("prefers origin url", async () => {
    const exec = async (_c: string, args: string[]) => (args.join(" ") === "config --get remote.origin.url" ? "git@github.com:eCy-coding/ollamas.git" : "");
    expect(await detectRepoSlug(exec)).toBe("eCy-coding/ollamas");
  });

  test("falls back to first remote when origin is absent", async () => {
    const exec = async (_c: string, args: string[]) => {
      const s = args.join(" ");
      if (s === "config --get remote.origin.url") return "";
      if (s === "remote") return "fork\nupstream";
      if (s === "remote get-url fork") return "https://github.com/eCy-coding/ollamas";
      return "";
    };
    expect(await detectRepoSlug(exec)).toBe("eCy-coding/ollamas");
  });

  test("returns null when no remote", async () => {
    expect(await detectRepoSlug(async () => "")).toBeNull();
  });
});
