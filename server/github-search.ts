// GitHub Search backend (GitHub Arama tab). First-party replacement for the old
// crash-looping external ecysearch iframe: a thin cached layer over github.ts.
// repos/issues read unauthenticated (public); code search requires the vault
// token. Search rate limits are tight (10/min unauth) so results are cached and
// the panel only searches on submit.
import {
  searchRepos, searchIssues, searchCode,
  type RepoResult, type IssueResult, type CodeResult, type RateLimit, type GhFetch,
} from "./github";

export type SearchType = "repos" | "issues" | "code";
export const SEARCH_TYPES: SearchType[] = ["repos", "issues", "code"];

export interface SearchPayload {
  ok: boolean;
  authed: boolean;
  type: SearchType;
  items: (RepoResult | IssueResult | CodeResult)[];
  total: number;
  rateLimit?: RateLimit;
  error?: string;
}

const TTL_MS = 45_000; // search quota is tight; cache aggressively
interface CacheEntry { at: number; payload: SearchPayload }
const cache = new Map<string, CacheEntry>();
export function _resetCache(): void { cache.clear(); }

export async function searchGitHub(opts: {
  type: string; q: string; token: string; refresh?: boolean; signal?: AbortSignal; fetchImpl?: GhFetch; now?: () => number;
}): Promise<SearchPayload> {
  const type = opts.type as SearchType;
  if (!SEARCH_TYPES.includes(type)) throw new Error(`invalid search type: ${opts.type}`);
  const q = (opts.q || "").trim();
  if (!q) throw new Error("empty query");
  const authed = !!opts.token;

  // Code search needs auth — reject before spending a request when no token.
  if (type === "code" && !authed) {
    return { ok: false, authed, type, items: [], total: 0, error: "kod araması için GitHub token gerekli (Gelir/Kişisel Ops → provider=github)" };
  }

  const now = opts.now ?? Date.now;
  const key = `${type}:${q}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && now() - hit.at < TTL_MS) return hit.payload;

  const verb = type === "repos" ? searchRepos : type === "issues" ? searchIssues : searchCode;
  const r = await verb(q, opts.token, opts.signal, opts.fetchImpl);
  const payload: SearchPayload = r.ok
    ? { ok: true, authed, type, items: r.data?.items ?? [], total: r.data?.total_count ?? 0, rateLimit: r.rateLimit }
    : { ok: false, authed, type, items: [], total: 0, rateLimit: r.rateLimit, error: r.error };
  if (r.ok) cache.set(key, { at: now(), payload });
  return payload;
}
