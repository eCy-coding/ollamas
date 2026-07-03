// GitHub Search Standard (dalga-9) — a curated, calibrated set of search intents
// ollamas runs to discover things useful for developing itself, plus the engine
// that runs them, ranks + license-classifies results, and produces an actionable
// task-list digest. Advisory only: it never auto-acts. See SEARCH_STANDARD.md.
//
// Working principle: a SMALL batch of tight-qualifier queries (search rate limit
// is 10/min unauth), each tied to a real ollamas lane; results ranked by
// stars(log) × recency × adopt-fit, archived filtered, deduped, capped per
// category; auto-degrades before a 403 rather than blind-firing.
import { searchGitHub, type SearchPayload } from "./github-search";
import type { RepoResult, IssueResult, GhFetch, RateLimit } from "./github";

export type Category = "adopt-mcp" | "adopt-gateway" | "competitor" | "security-pattern" | "local-model" | "dependency-cve" | "zero-dep";
export interface SearchIntent { id: string; title: string; type: "repos" | "issues"; query: string; rationale: string; category: Category; }

// Queries live-calibrated against GitHub (kept only where the top results are
// on-topic post archived/license filter). Tight qualifiers beat broad topics.
export const SEARCH_STANDARD: SearchIntent[] = [
  { id: "adopt-mcp-servers", title: "Adopt: MCP servers", type: "repos", category: "adopt-mcp",
    query: "mcp server language:typescript stars:>200 archived:false pushed:>2025-06-01",
    rationale: "Gateway tool-catalog'una adopt edilebilir üretim-kalite MCP server'ları (North-Star: MCP gateway)." },
  { id: "adopt-mcp-gateway", title: "Adopt: MCP gateway mimarisi", type: "repos", category: "adopt-gateway",
    query: "mcp gateway stars:>100 pushed:>2025-06-01",
    rationale: "Gateway routing/multiplex/registry desenleri — broker çekirdeği (Portkey/docker-mcp-gateway kalibre-iyi)." },
  { id: "competitor-llm-gateway", title: "Rakip: self-hosted LLM gateway", type: "repos", category: "competitor",
    query: "LLM gateway self-hosted stars:>500",
    rationale: "tools-as-SaaS broker rakip taraması — SWOD konumlama + özellik boşlukları." },
  { id: "security-injection", title: "Güvenlik: prompt-injection savunma", type: "repos", category: "security-pattern",
    query: "prompt injection detection stars:>100",
    rationale: "Tool/prompt-injection guardrail teknikleri — broker sınırı hardening lane." },
  { id: "security-mcp", title: "Güvenlik: MCP tarayıcı/tooling", type: "repos", category: "security-pattern",
    query: "mcp security stars:>30",
    rationale: "MCP-özel güvenlik tarayıcıları (upstream poison-guard'ı besler) — hardening + mission." },
  { id: "local-model-toolcall", title: "Yerel model: tool-calling", type: "repos", category: "local-model",
    query: "ollama tool calling stars:>150 pushed:>2025-01-01",
    rationale: "qwen/ollama tool-calling teknikleri — fleet lane ($0 yerel motor)." },
  { id: "dependency-cve", title: "Bağımlılık: aktif CVE yamaları", type: "issues", category: "dependency-cve",
    query: "CVE nodejs in:title state:open",
    rationale: "Node ekosisteminde aktif yamalanan CVE'ler — çekirdek-dep advisory nabzı (express/vite/zod/jose...)." },
  { id: "zero-dep-techniques", title: "Zero-dep: saf-TS teknikler", type: "repos", category: "zero-dep",
    query: "zero dependency typescript stars:>300",
    rationale: "npm-runtime-dep'siz saf-TS desenler — projenin zero-dep yasası." },
];

const CATEGORIES = new Set<Category>(SEARCH_STANDARD.map((i) => i.category));
export const CATEGORY_RATIONALE: Record<string, string> = Object.fromEntries(
  [...CATEGORIES].map((c) => [c, SEARCH_STANDARD.find((i) => i.category === c)!.rationale]),
);

export type AdoptFit = "adopt" | "idea-only" | "unknown";
// Self-contained SPDX rule mirroring orchestration/bin/lib/licenses.ts (NOT
// imported — cross-lane). permissive → adopt; copyleft → idea-only; else unknown.
const PERMISSIVE = new Set(["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "0BSD", "UNLICENSE", "CC0-1.0", "MPL-2.0"]);
const COPYLEFT = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.1", "LGPL-3.0", "GPL-2.0-ONLY", "GPL-3.0-ONLY", "AGPL-3.0-ONLY"]);
export function classifyAdoptFit(spdx?: string | null): AdoptFit {
  if (!spdx || spdx === "NOASSERTION") return "unknown";
  const s = spdx.toUpperCase();
  if (PERMISSIVE.has(s)) return "adopt";
  if (COPYLEFT.has(s)) return "idea-only";
  return "unknown";
}

const DAY = 86_400_000;
export function scoreRepo(repo: RepoResult, now: number): number {
  const stars = Math.max(0, repo.stargazers_count ?? 0);
  const ageDays = repo.pushed_at ? Math.max(0, (now - Date.parse(repo.pushed_at)) / DAY) : 730;
  const recency = Math.max(0, 1 - ageDays / 730); // linear decay to 0 at ~2y
  const fit = classifyAdoptFit(repo.license?.spdx_id);
  const fitBonus = fit === "adopt" ? 2.0 : fit === "idea-only" ? 0.5 : 0;
  const forkPenalty = repo.fork ? 1.5 : 0;
  return Math.log2(stars + 1) + 4.0 * recency + fitBonus - forkPenalty;
}

export interface DigestItem { full_name?: string; description?: string | null; stargazers_count?: number; language?: string | null; html_url?: string; pushed_at?: string; adoptFit: AdoptFit; score: number; }
export interface IssueDigestItem { title?: string; state?: string; html_url?: string; number?: number; repository_url?: string; }
export interface CategoryDigest { category: Category; rationale: string; items: (DigestItem | IssueDigestItem)[]; }
export interface Digest { byCategory: CategoryDigest[]; intentsRun: number; intentsTotal: number; rateLimit?: RateLimit; note?: string; }

const PER_CATEGORY_CAP = 6;
const TTL_MS = 15 * 60_000;
let digestCache: { at: number; key: string; digest: Digest } | null = null;
export function _resetCache(): void { digestCache = null; }

export async function runStandard(opts: {
  token: string; categories?: Category[]; refresh?: boolean; signal?: AbortSignal; fetchImpl?: GhFetch; now?: () => number;
}): Promise<Digest> {
  const now = opts.now ?? Date.now;
  const wanted = opts.categories && opts.categories.length ? new Set(opts.categories) : null;
  const intents = SEARCH_STANDARD.filter((i) => !wanted || wanted.has(i.category));
  const key = intents.map((i) => i.id).join(",");
  if (!opts.refresh && digestCache && digestCache.key === key && now() - digestCache.at < TTL_MS) return digestCache.digest;

  const groups = new Map<Category, { rationale: string; items: (DigestItem | IssueDigestItem)[] }>();
  let intentsRun = 0;
  let lastRate: RateLimit | undefined;
  let note: string | undefined;

  for (const intent of intents) {
    // Auto-degrade: never blind-fire into a 403. Stop while a request still fits.
    if (lastRate && lastRate.remaining < 3) {
      note = `kısmi: ${intentsRun}/${intents.length} intent çalıştı (kota ${lastRate.remaining} kaldı — GitHub token bağla → 30/dk)`;
      break;
    }
    let p: SearchPayload;
    try { p = await searchGitHub({ type: intent.type, q: intent.query, token: opts.token, signal: opts.signal, fetchImpl: opts.fetchImpl }); }
    catch { continue; }
    intentsRun++;
    if (p.rateLimit) lastRate = p.rateLimit;
    if (!p.ok) continue;

    const g = groups.get(intent.category) ?? { rationale: intent.rationale, items: [] };
    if (intent.type === "repos") {
      // Dedup by full_name across intents AND within this batch (seen grows as we go).
      const seen = new Set(g.items.map((it) => (it as DigestItem).full_name));
      for (const r of p.items as RepoResult[]) {
        if (r.archived || !r.full_name || seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        g.items.push({ full_name: r.full_name, description: r.description, stargazers_count: r.stargazers_count, language: r.language, html_url: r.html_url, pushed_at: r.pushed_at, adoptFit: classifyAdoptFit(r.license?.spdx_id), score: scoreRepo(r, now()) });
      }
      g.items = (g.items as DigestItem[]).sort((a, b) => b.score - a.score).slice(0, PER_CATEGORY_CAP);
    } else {
      const seen = new Set(g.items.map((it) => (it as IssueDigestItem).html_url));
      const items = (p.items as IssueResult[])
        .filter((it) => it.html_url && !seen.has(it.html_url))
        .slice(0, PER_CATEGORY_CAP)
        .map((it) => ({ title: it.title, state: it.state, html_url: it.html_url, number: it.number, repository_url: it.repository_url }));
      g.items.push(...items);
      g.items = g.items.slice(0, PER_CATEGORY_CAP);
    }
    groups.set(intent.category, g);
  }

  const digest: Digest = {
    byCategory: [...groups.entries()].map(([category, g]) => ({ category, rationale: g.rationale, items: g.items })),
    intentsRun, intentsTotal: intents.length, rateLimit: lastRate, ...(note ? { note } : {}),
  };
  digestCache = { at: now(), key, digest };
  return digest;
}
