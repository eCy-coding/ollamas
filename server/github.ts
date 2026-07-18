// Zero-dep GitHub REST client (node global fetch — no Octokit). Posts Audit-as-a-Service findings
// to a client repo as a GitHub Issue so the paid deliverable lands as a native GitHub artifact.
// PAT auth (fine-grained: issues:write) read from the AES-256-GCM vault. Choke-point-safe:
// server-side only; the CLI never imports this. The Checks API needs a GitHub App (Phase 1b).

const GH_API = "https://api.github.com";

const ghHeaders = (token: string): Record<string, string> => ({
  // Anon reads (public repos) omit Authorization — Bearer "" would 401.
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ollamas-audit-service", // GitHub rejects requests without a User-Agent
  "Content-Type": "application/json",
});

// Injectable fetch (default: node global). Lets the Actions layer and tests
// drive GitHub calls without the network (threatfeed pattern).
export type GhFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "manual" | "follow" }) =>
  Promise<{ ok: boolean; status: number; statusText?: string; text(): Promise<string>; headers: { get(name: string): string | null } }>;

export interface RateLimit { remaining: number; limit: number; reset: number }
function parseRateLimit(headers: { get(n: string): string | null }): RateLimit | undefined {
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining == null) return undefined;
  return { remaining: Number(remaining), limit: Number(headers.get("x-ratelimit-limit") ?? 0), reset: Number(headers.get("x-ratelimit-reset") ?? 0) };
}

/** Result of a live GitHub token check (v14). Never carries the token value. */
export interface GhTokenCheck {
  ok: boolean;
  login?: string;
  tokenType: "classic" | "fine-grained" | "unknown";
  scopes: string[];
  status?: number;
  error?: string;
}

/** Classify a GitHub token by prefix (Bearer works for all — this is only for UX hints). */
export function ghTokenType(token: string): GhTokenCheck["tokenType"] {
  if (token.startsWith("github_pat_")) return "fine-grained";
  if (/^gh[po]_/.test(token)) return "classic";
  return "unknown";
}

/**
 * Live-validate a GitHub token via GET /user (v14). Confirms the token is real and
 * returns the authenticated login. Classic tokens also report their `x-oauth-scopes`;
 * fine-grained tokens return none (permissions are per-endpoint) — that's honest, not
 * a failure. Injectable fetch for tests. NEVER logs or returns the token value.
 */
export async function validateGitHubToken(token: string, fetchImpl: GhFetch = fetch as unknown as GhFetch): Promise<GhTokenCheck> {
  const tokenType = ghTokenType(token);
  if (!token) return { ok: false, tokenType, scopes: [], error: "no token provided" };
  try {
    const res = await fetchImpl(`${GH_API}/user`, { method: "GET", headers: ghHeaders(token) });
    if (res.status === 401) return { ok: false, tokenType, scopes: [], status: 401, error: "token geçersiz veya süresi dolmuş" };
    if (!res.ok) return { ok: false, tokenType, scopes: [], status: res.status, error: `GitHub /user ${res.status}` };
    const body = JSON.parse(await res.text()) as { login?: string };
    const scopes = (res.headers.get("x-oauth-scopes") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return { ok: true, login: body.login, tokenType, scopes };
  } catch (err) {
    return { ok: false, tokenType, scopes: [], error: (err as Error)?.message || "network error" };
  }
}

export interface Finding {
  file?: string;
  name?: string;
  line?: number | string;
  symptom?: string;
  fix?: string;
  severity?: string;
}

// Severity ordering for a triage-friendly issue body (unknown severities sort last).
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
function sevRank(s?: string): number {
  const i = SEV_ORDER.indexOf(String(s || "").toUpperCase());
  return i === -1 ? SEV_ORDER.length : i;
}

/** Pure: render findings.json into a severity-sorted GitHub-flavored markdown issue body. */
export function buildIssueBody(findings: Finding[], opts?: { model?: string }): string {
  const list = Array.isArray(findings) ? [...findings] : [];
  list.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const out: string[] = [
    "## ollamas automated code audit",
    "",
    `**${list.length} finding(s)**${opts?.model ? ` · auditor: \`${opts.model}\`` : ""}. ` +
      "Candidate findings — verify before acting (Tier-1 reproduction available on request).",
  ];
  if (!list.length) {
    out.push("", "_No findings._");
    return out.join("\n");
  }
  let lastSev = "";
  for (const f of list) {
    const sev = String(f.severity || "UNSPECIFIED").toUpperCase();
    if (sev !== lastSev) {
      out.push("", `### ${sev}`, "");
      lastSev = sev;
    }
    const loc = [f.file, f.line].filter((x) => x != null && x !== "").join(":");
    const head = loc || f.name || "?";
    out.push(`- **${head}**${f.name && loc ? ` (\`${f.name}\`)` : ""}`);
    if (f.symptom) out.push(`  - symptom: ${f.symptom}`);
    if (f.fix) out.push(`  - fix: ${f.fix}`);
  }
  out.push("", "---", "_Generated by ollamas Audit-as-a-Service — $0 local-model engine._");
  return out.join("\n");
}

export interface RepoSlug {
  owner: string;
  repo: string;
}

/** Pure: parse "owner/name" tolerating a full github URL or a trailing .git / slashes. */
export function parseRepoSlug(input: string): RepoSlug | null {
  if (!input || typeof input !== "string") return null;
  const s = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "") // strip trailing slashes FIRST so the .git suffix is reachable
    .replace(/\.git$/i, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export interface GhResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  rateLimit?: RateLimit;
}

// Shared fetch/parse core. `token` may be "" for anon (public) reads.
async function ghCore<T>(
  method: string,
  apiPath: string,
  token: string,
  body: unknown,
  signal: AbortSignal | undefined,
  fetchImpl: GhFetch,
): Promise<GhResult<T>> {
  try {
    const res = await fetchImpl(`${GH_API}${apiPath}`, {
      method,
      headers: ghHeaders(token),
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
    const rateLimit = parseRateLimit(res.headers);
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const msg =
        (data && typeof data === "object" && (data as { message?: string }).message) ||
        text.slice(0, 200) ||
        res.statusText;
      return { ok: false, status: res.status, error: `GitHub ${res.status}: ${msg}`, rateLimit };
    }
    return { ok: true, status: res.status, data: data as T, rateLimit };
  } catch (e) {
    return { ok: false, status: 0, error: `fetch failed: ${(e as Error).message}` };
  }
}

// Strict: a token is REQUIRED (all write verbs + revenue delivery rely on this
// hard-fail as a safety property — do not relax it).
async function ghRequest<T>(
  method: string,
  apiPath: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
  fetchImpl: GhFetch = fetch as unknown as GhFetch,
): Promise<GhResult<T>> {
  if (!token) return { ok: false, status: 0, error: "no GitHub token configured" };
  return ghCore<T>(method, apiPath, token, body, signal, fetchImpl);
}

// Anon-capable: used only by public read verbs. An empty token omits the
// Authorization header (public repos are readable unauthenticated).
export async function ghRequestAnon<T>(
  method: string,
  apiPath: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
  fetchImpl: GhFetch = fetch as unknown as GhFetch,
): Promise<GhResult<T>> {
  return ghCore<T>(method, apiPath, token, body, signal, fetchImpl);
}

// ── Actions API path-segment validation (SSRF/path-injection defense) ──────────
// owner/repo/run_id are interpolated into /repos/{o}/{r}/actions/runs/{id}/… .
// parseRepoSlug does NOT validate charset, so a raw ".." or "x%2f.." could
// re-target the GitHub API path (URL normalization collapses ..). Validate every
// segment against GitHub's real charset and interpolate verbatim (no decode).
const SLUG_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function assertActionsTarget(owner: string, repo: string, runId?: string): void {
  const badPart = (s: string, max: number) => !s || s.length > max || s === "." || s === ".." || !SLUG_PART.test(s);
  if (badPart(owner, 39)) throw new Error(`invalid owner: ${owner}`);
  if (badPart(repo, 100)) throw new Error(`invalid repo: ${repo}`);
  if (runId !== undefined && !/^\d+$/.test(runId)) throw new Error(`invalid run id: ${runId}`); // string-match; Number() would accept 1e3/0x1
}

export interface WorkflowRun {
  id: number; name?: string; display_title?: string; head_branch?: string; event?: string;
  status?: string; conclusion?: string | null; run_number?: number; created_at?: string; updated_at?: string; html_url?: string;
  actor?: { login?: string }; head_commit?: { message?: string };
}
export interface WorkflowJob {
  id: number; name?: string; status?: string; conclusion?: string | null;
  steps?: { name?: string; status?: string; conclusion?: string | null; number?: number }[];
}
export interface Workflow { id: number; name?: string; path?: string; state?: string; }

// ── Additional path/param validators (distinct contracts from assertActionsTarget) ──
export function assertJobId(jobId: string): void {
  if (!/^\d+$/.test(jobId)) throw new Error(`invalid job id: ${jobId}`);
}
export function assertWorkflowId(id: string): void {
  // A workflow is addressable by numeric id OR its file name (ci.yml). Reject
  // anything with a slash / traversal so it can't re-target the API path.
  const ok = /^\d+$/.test(id) || (/^[A-Za-z0-9._-]+\.ya?ml$/.test(id) && id.length <= 120 && !id.includes(".."));
  if (!ok) throw new Error(`invalid workflow id: ${id}`);
}
export function validateRef(ref: string): void {
  // ref rides in the request BODY (not the path), but validate anyway: a real
  // git ref is alnum + . _ - / and never contains "..".
  if (!ref || typeof ref !== "string" || ref.length > 255 || ref.includes("..") || !/^[A-Za-z0-9._\-/]+$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }
}
export function normalizeInputs(inputs: unknown): Record<string, string> {
  if (inputs == null) return {};
  if (typeof inputs !== "object" || Array.isArray(inputs)) throw new Error("inputs must be an object");
  const entries = Object.entries(inputs as Record<string, unknown>);
  if (entries.length > 20) throw new Error("too many inputs (max 20)");
  const out: Record<string, string> = {};
  for (const [k, v] of entries) out[k] = String(v);
  if (JSON.stringify(out).length > 4096) throw new Error("inputs too large (max 4KB)");
  return out;
}

export function listWorkflowRuns(owner: string, repo: string, token: string, signal?: AbortSignal, perPage = 20, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo);
  const per = Math.min(100, Math.max(1, perPage));
  return ghRequestAnon<{ total_count: number; workflow_runs: WorkflowRun[] }>(
    "GET", `/repos/${owner}/${repo}/actions/runs?per_page=${per}`, token, undefined, signal, fetchImpl,
  );
}

export function listRunJobs(owner: string, repo: string, runId: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo, runId);
  return ghRequestAnon<{ total_count: number; jobs: WorkflowJob[] }>(
    "GET", `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, token, undefined, signal, fetchImpl,
  );
}

export function rerunFailedJobs(owner: string, repo: string, runId: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo, runId);
  return ghRequest<unknown>("POST", `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, token, {}, signal, fetchImpl);
}

export function cancelRun(owner: string, repo: string, runId: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo, runId);
  return ghRequest<unknown>("POST", `/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, token, {}, signal, fetchImpl);
}

export function listWorkflows(owner: string, repo: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo);
  return ghRequestAnon<{ total_count: number; workflows: Workflow[] }>(
    "GET", `/repos/${owner}/${repo}/actions/workflows?per_page=100`, token, undefined, signal, fetchImpl,
  );
}

export function dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: unknown, token: string, signal?: AbortSignal, fetchImpl?: GhFetch) {
  assertActionsTarget(owner, repo);
  assertWorkflowId(workflowId);
  validateRef(ref);
  const norm = normalizeInputs(inputs);
  const body: Record<string, unknown> = { ref };
  if (Object.keys(norm).length) body.inputs = norm;
  return ghRequest<unknown>("POST", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, token, body, signal, fetchImpl);
}

// ── Search API (GitHub Arama tab). repos/issues read anon; code REQUIRES auth. ──
export interface RepoResult { full_name?: string; description?: string | null; stargazers_count?: number; language?: string | null; html_url?: string; updated_at?: string; pushed_at?: string; archived?: boolean; fork?: boolean; license?: { spdx_id?: string | null } | null; }
export interface IssueResult { title?: string; state?: string; html_url?: string; number?: number; repository_url?: string; user?: { login?: string }; pull_request?: unknown; }
export interface CodeResult { name?: string; path?: string; html_url?: string; repository?: { full_name?: string }; }

const searchPath = (kind: string, q: string, perPage: number) =>
  `/search/${kind}?q=${encodeURIComponent(q)}&per_page=${Math.min(50, Math.max(1, perPage))}`;

export function searchRepos(q: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch, perPage = 20) {
  return ghRequestAnon<{ total_count: number; items: RepoResult[] }>("GET", searchPath("repositories", q, perPage), token, undefined, signal, fetchImpl);
}
export function searchIssues(q: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch, perPage = 20) {
  return ghRequestAnon<{ total_count: number; items: IssueResult[] }>("GET", searchPath("issues", q, perPage), token, undefined, signal, fetchImpl);
}
export function searchCode(q: string, token: string, signal?: AbortSignal, fetchImpl?: GhFetch, perPage = 20) {
  // Strict: code search 401s without auth. ghRequest hard-fails on empty token.
  return ghRequest<{ total_count: number; items: CodeResult[] }>("GET", searchPath("code", q, perPage), token, undefined, signal, fetchImpl);
}

const LOG_MAX_BYTES = 64 * 1024;
const LOG_MAX_LINES = 200;
export interface JobLogResult { ok: boolean; text?: string; truncated?: boolean; error?: string }

/** Fetch a single job's plaintext log. The GitHub endpoint 302-redirects to a
 *  short-lived blob URL; we follow it MANUALLY and fetch the blob WITHOUT the
 *  Authorization header so the PAT is never sent to the storage host. */
export async function getJobLog(owner: string, repo: string, jobId: string, token: string, signal?: AbortSignal, fetchImpl: GhFetch = fetch as unknown as GhFetch): Promise<JobLogResult> {
  assertActionsTarget(owner, repo);
  assertJobId(jobId);
  try {
    const res = await fetchImpl(`${GH_API}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {
      method: "GET", headers: ghHeaders(token), signal, redirect: "manual",
    });
    let body: string;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "log redirect had no Location" };
      // Blob fetch: no GitHub auth header (PAT-leak defense), just a User-Agent.
      const blob = await fetchImpl(loc, { method: "GET", headers: { "User-Agent": "ollamas-audit-service" }, signal });
      if (!blob.ok) return { ok: false, error: `log blob ${blob.status}` };
      body = await blob.text();
    } else if (res.ok) {
      body = await res.text(); // some clients auto-follow → body already here
    } else {
      return { ok: false, error: `GitHub ${res.status}` };
    }
    const lines = body.split("\n");
    let tail = lines.length > LOG_MAX_LINES ? lines.slice(-LOG_MAX_LINES).join("\n") : body;
    let truncated = lines.length > LOG_MAX_LINES;
    if (tail.length > LOG_MAX_BYTES) { tail = tail.slice(-LOG_MAX_BYTES); truncated = true; }
    return { ok: true, text: tail, truncated };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}

export function getRepo(owner: string, repo: string, token: string, signal?: AbortSignal) {
  return ghRequest<{ full_name: string; permissions?: Record<string, boolean> }>(
    "GET",
    `/repos/${owner}/${repo}`,
    token,
    undefined,
    signal,
  );
}

export function createIssue(args: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  token: string;
  signal?: AbortSignal;
}) {
  return ghRequest<{ number: number; html_url: string }>(
    "POST",
    `/repos/${args.owner}/${args.repo}/issues`,
    args.token,
    { title: args.title, body: args.body },
    args.signal,
  );
}

// ── PR delivery (the Fix-PR tier) — zero-clone via the Contents/Git REST API ───────────────────

/** Pure: a stable, filesystem-safe audit branch name. */
export function auditBranchName(name: string, suffix?: string): string {
  const slug = String(name || "audit").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "audit";
  return `ollamas-audit/${slug}${suffix ? `-${suffix}` : ""}`;
}

/** Pure: UTF-8 → base64 (GitHub Contents API wants base64 file content). */
export function toBase64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** The repo's default branch + the SHA its head points at (the PR base). */
export async function getDefaultBranch(owner: string, repo: string, token: string, signal?: AbortSignal): Promise<GhResult<{ branch: string; sha: string }>> {
  const r = await getRepo(owner, repo, token, signal);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const branch = (r.data as { default_branch?: string })?.default_branch || "main";
  const ref = await ghRequest<{ object: { sha: string } }>("GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`, token, undefined, signal);
  if (!ref.ok) return { ok: false, status: ref.status, error: ref.error };
  return { ok: true, status: ref.status, data: { branch, sha: ref.data!.object.sha } };
}

export function createBranch(owner: string, repo: string, token: string, branch: string, sha: string, signal?: AbortSignal) {
  return ghRequest<{ ref: string }>("POST", `/repos/${owner}/${repo}/git/refs`, token, { ref: `refs/heads/${branch}`, sha }, signal);
}

export function putFile(args: { owner: string; repo: string; token: string; path: string; branch: string; message: string; content: string; signal?: AbortSignal }) {
  return ghRequest<{ commit: { sha: string } }>("PUT", `/repos/${args.owner}/${args.repo}/contents/${args.path}`, args.token, {
    message: args.message,
    content: toBase64(args.content),
    branch: args.branch,
  }, args.signal);
}

export function createPullRequest(args: { owner: string; repo: string; token: string; title: string; head: string; base: string; body: string; signal?: AbortSignal }) {
  return ghRequest<{ number: number; html_url: string }>("POST", `/repos/${args.owner}/${args.repo}/pulls`, args.token, {
    title: args.title,
    head: args.head,
    base: args.base,
    body: args.body,
  }, args.signal);
}
