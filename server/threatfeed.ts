// Canlı Tehdit Akışı (dalga-3) — zero-dep RSS/Atom/KEV feed reader feeding the
// threat-intel tab, independent of the external eCySearcher Flask stack (which
// 502s when down). Pure parsers + injectable fetch; only public GETs go out —
// no personal data ever leaves the machine.
//
// XML is extracted without a DOM: RSS <item> / Atom <entry> blocks never nest,
// so non-greedy block scanning is safe; per-tag extraction is case-insensitive,
// attribute-tolerant, and prefers the exact tag before namespace-prefixed
// variants so <media:title> can't shadow <title>.

export interface FeedItem {
  source: string;
  title: string;
  link: string;
  dateIso: string;
  summary: string;
  severity?: "critical" | "high";
}

export interface FeedDef {
  id: string;
  title: string;
  url: string;
  kind: "rss" | "atom" | "kev-json";
}

// Curated zero-account sources — every URL live-verified 200 before hardcoding.
export const FEEDS: FeedDef[] = [
  { id: "cisa-kev", title: "CISA KEV", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", kind: "kev-json" },
  { id: "cisa-adv", title: "CISA Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", kind: "rss" },
  { id: "sans-isc", title: "SANS ISC", url: "https://isc.sans.edu/rssfeed_full.xml", kind: "rss" },
  { id: "hackernews", title: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", kind: "rss" },
  { id: "bleeping", title: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", kind: "rss" },
  { id: "project-zero", title: "Project Zero", url: "https://googleprojectzero.blogspot.com/feeds/posts/default", kind: "atom" },
];

const PER_SOURCE_CAP = 25;
const TOTAL_CAP = 100;
const KEV_CAP = 40;
const TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 8000;
const SUMMARY_MAX = 280;

// --- entity / text helpers (pure) ---

// &amp; decodes LAST so "&amp;lt;" yields the literal "&lt;", not "<".
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const stripCdata = (s: string): { text: string; wasCdata: boolean } => {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? { text: m[1] ?? "", wasCdata: true } : { text: s, wasCdata: false };
};

const cleanText = (raw: string): string => {
  const { text, wasCdata } = stripCdata(raw);
  const decoded = wasCdata ? text : decodeEntities(text);
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

// First matching tag's inner content; exact name first, then any-namespace-prefixed.
// M-009 ReDoS audit: `name` is NEVER user input — every caller passes a fixed
// literal tag name (title/link/pubDate/date/description/published/updated/summary/
// content). The untrusted value is `block` (matched against), not the pattern. The
// pattern is linear-time (lazy `[\s\S]*?`, single non-overlapping `[^>]*` before a
// required `>`) so there is no catastrophic backtracking — RE2 is unnecessary.
function tagContent(block: string, name: string): string {
  for (const pattern of [
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp — `name` is a fixed literal (not user input); pattern is linear-time. See M-009 note above.
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, "i"),
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp — `name` is a fixed literal (not user input); pattern is linear-time. See M-009 note above.
    new RegExp(`<\\w+:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</\\w+:${name}\\s*>`, "i"),
  ]) {
    const m = block.match(pattern);
    if (m) return (m[1] ?? "").trim();
  }
  return "";
}

const toIso = (raw: string): string => {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

const clip = (s: string): string => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

// --- parsers (pure) ---

export function parseRss(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    const block = m[1] ?? "";
    const title = cleanText(tagContent(block, "title"));
    if (!title) continue;
    items.push({
      source,
      title,
      link: cleanText(tagContent(block, "link")),
      dateIso: toIso(cleanText(tagContent(block, "pubDate") || tagContent(block, "date"))),
      summary: clip(cleanText(tagContent(block, "description"))),
    });
  }
  return items;
}

export function parseAtom(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/gi)) {
    const block = m[1] ?? "";
    const title = cleanText(tagContent(block, "title"));
    if (!title) continue;
    // Atom carries several <link/> elements; prefer rel="alternate" (or no rel), never rel="self".
    let link = "";
    for (const lm of block.matchAll(/<link\b([^>]*)\/?>/gi)) {
      const attrs = lm[1] ?? "";
      const href = attrs.match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? "";
      if (!href) continue;
      const rel = attrs.match(/rel\s*=\s*"([^"]*)"/i)?.[1] ?? "";
      if (rel === "alternate") { link = href; break; }
      if (!rel && !link) link = href;
    }
    items.push({
      source,
      title,
      link: decodeEntities(link),
      dateIso: toIso(cleanText(tagContent(block, "published") || tagContent(block, "updated"))),
      summary: clip(cleanText(tagContent(block, "summary") || tagContent(block, "content"))),
    });
  }
  return items;
}

export function parseKevJson(text: string, source: string): FeedItem[] {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return []; }
  const vulns: any[] = Array.isArray(doc?.vulnerabilities) ? doc.vulnerabilities : [];
  return vulns
    .filter((v) => v?.cveID)
    .sort((a, b) => String(b.dateAdded ?? "").localeCompare(String(a.dateAdded ?? "")))
    .slice(0, KEV_CAP)
    .map((v) => ({
      source,
      title: `${v.cveID}: ${v.vulnerabilityName ?? ""}`.trim().replace(/:$/, ""),
      link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      dateIso: toIso(String(v.dateAdded ?? "")),
      summary: clip(String(v.shortDescription ?? "")),
      severity: (v.knownRansomwareCampaignUse === "Known" ? "critical" : "high") as "critical" | "high",
    }));
}

// --- fetch + cache ---

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export async function fetchFeed(feed: FeedDef, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<FeedItem[] | null> {
  try {
    const res = await fetchImpl(feed.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "ollamas-threatfeed/1.0", Accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*" },
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (feed.kind === "kev-json") return parseKevJson(body, feed.title);
    if (feed.kind === "atom") return parseAtom(body, feed.title);
    return parseRss(body, feed.title);
  } catch {
    return null; // timeout / network / abort — fail-soft, caller keeps stale cache
  }
}

interface CacheEntry { items: FeedItem[]; fetchedAt: number; lastError?: string; }
const cache = new Map<string, CacheEntry>();
export function _resetCache(): void { cache.clear(); }

export interface FeedSourceStatus { id: string; title: string; items: number; fetchedAt: string | null; error?: string; }

export async function getFeedItems(opts: { refresh?: boolean; fetchImpl?: FetchLike; now?: () => number; extra?: FeedDef[] } = {}): Promise<{ items: FeedItem[]; sources: FeedSourceStatus[] }> {
  const now = opts.now ?? Date.now;
  // Curated sources + operator-added custom feeds (v12 gap #9). Curated ids win on
  // collision; only genuinely-new ids are appended.
  const seen = new Set(FEEDS.map((f) => f.id));
  const allFeeds = [...FEEDS, ...(opts.extra ?? []).filter((f) => f.url && !seen.has(f.id))];
  const due = allFeeds.filter((f) => {
    if (opts.refresh) return true;
    const c = cache.get(f.id);
    return !c || now() - c.fetchedAt > TTL_MS;
  });
  // Per-feed isolation: one dead source keeps its stale entry, others refresh.
  await Promise.allSettled(due.map(async (f) => {
    const items = await fetchFeed(f, opts.fetchImpl);
    const prev = cache.get(f.id);
    if (items) cache.set(f.id, { items, fetchedAt: now() });
    else cache.set(f.id, { items: prev?.items ?? [], fetchedAt: prev?.fetchedAt ?? 0, lastError: "fetch failed" });
  }));

  const sources: FeedSourceStatus[] = allFeeds.map((f) => {
    const c = cache.get(f.id);
    return { id: f.id, title: f.title, items: c?.items.length ?? 0, fetchedAt: c?.fetchedAt ? new Date(c.fetchedAt).toISOString() : null, ...(c?.lastError ? { error: c.lastError } : {}) };
  });
  const items = allFeeds
    .flatMap((f) => (cache.get(f.id)?.items ?? []).slice(0, PER_SOURCE_CAP))
    .sort((a, b) => (b.dateIso || "0").localeCompare(a.dateIso || "0"))
    .slice(0, TOTAL_CAP);
  return { items, sources };
}
