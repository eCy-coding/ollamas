// GitHub Actions cockpit backend — a thin, cached layer over the github.ts REST
// verbs. Read paths work unauthenticated for public repos; a vault token (when
// present) raises the rate limit and enables the write verbs. No auto-poll: a
// 30s TTL cache keeps the unauth 60/hr budget from being burned by refreshes.
import { execFile } from "node:child_process";
import {
  listWorkflowRuns, listRunJobs, parseRepoSlug, assertActionsTarget,
  type WorkflowRun, type WorkflowJob, type RateLimit, type GhFetch,
} from "./github";

export interface RunsPayload {
  ok: boolean;
  authed: boolean;
  runs: WorkflowRun[];
  rateLimit?: RateLimit;
  error?: string;
}

const TTL_MS = 30_000;
interface CacheEntry { at: number; payload: RunsPayload }
const cache = new Map<string, CacheEntry>();
export function _resetCache(): void { cache.clear(); }

export async function getRuns(opts: {
  owner: string; repo: string; token: string; refresh?: boolean; signal?: AbortSignal; fetchImpl?: GhFetch; now?: () => number;
}): Promise<RunsPayload> {
  assertActionsTarget(opts.owner, opts.repo); // throws on injection — caller maps to 400
  const now = opts.now ?? Date.now;
  const key = `${opts.owner}/${opts.repo}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && now() - hit.at < TTL_MS) return hit.payload;

  const r = await listWorkflowRuns(opts.owner, opts.repo, opts.token, opts.signal, 20, opts.fetchImpl);
  const payload: RunsPayload = r.ok
    ? { ok: true, authed: !!opts.token, runs: r.data?.workflow_runs ?? [], rateLimit: r.rateLimit }
    : { ok: false, authed: !!opts.token, runs: [], rateLimit: r.rateLimit, error: r.error };
  if (r.ok) cache.set(key, { at: now(), payload });
  return payload;
}

export async function getJobs(opts: {
  owner: string; repo: string; runId: string; token: string; signal?: AbortSignal; fetchImpl?: GhFetch;
}): Promise<{ ok: boolean; jobs: WorkflowJob[]; error?: string }> {
  assertActionsTarget(opts.owner, opts.repo, opts.runId);
  const r = await listRunJobs(opts.owner, opts.repo, opts.runId, opts.token, opts.signal, opts.fetchImpl);
  return r.ok ? { ok: true, jobs: r.data?.jobs ?? [] } : { ok: false, jobs: [], error: r.error };
}

// Auto-detect the repo slug from git remotes: prefer origin, else the first
// remote. execFile (no shell) — the remote name/url is never interpolated.
export type ExecLike = (cmd: string, args: string[]) => Promise<string>;
const defaultExec: ExecLike = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? "" : String(stdout).trim())));

export async function detectRepoSlug(exec: ExecLike = defaultExec): Promise<string | null> {
  let url = await exec("git", ["config", "--get", "remote.origin.url"]);
  if (!url) {
    const first = (await exec("git", ["remote"])).split(/\s+/).filter(Boolean)[0];
    if (first) url = await exec("git", ["remote", "get-url", first]);
  }
  if (!url) return null;
  // Normalize the SSH remote form (git@github.com:owner/repo.git) that
  // parseRepoSlug (built for owner/name + https) doesn't handle.
  const normalized = url.replace(/^git@[^:]+:/, "");
  const slug = parseRepoSlug(normalized);
  return slug ? `${slug.owner}/${slug.repo}` : null;
}
