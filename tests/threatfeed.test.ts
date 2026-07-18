import { describe, test, expect, beforeEach } from "vitest";
import {
  parseRss, parseAtom, parseKevJson, decodeEntities, fetchFeed,
  getFeedItems, _resetCache, FEEDS, type FetchLike,
} from "../server/threatfeed";

const rssFixture = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <title>Chan</title>
  <item foo="bar">
    <media:title>SHADOW</media:title>
    <title><![CDATA[Critical bug &amp; <exploit> found]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link>
    <pubDate>Wed, 02 Jul 2026 10:00:00 GMT</pubDate>
    <description>&lt;p&gt;Long &amp;amp; detailed &#39;analysis&#x27; here&lt;/p&gt;</description>
  </item>
  <item>
    <title>No date, no link</title>
  </item>
</channel></rss>`;

const atomFixture = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="https://blog.example/feed.xml" rel="self"/>
  <entry>
    <title type="html">Zero-day chain</title>
    <link href="https://blog.example/feed2.xml" rel="self" />
    <link href="https://blog.example/post/1" rel="alternate" type="text/html"/>
    <published>2026-07-01T12:00:00+02:00</published>
    <summary>Chain of &amp; bugs</summary>
  </entry>
</feed>`;

const kevFixture = JSON.stringify({
  vulnerabilities: [
    { cveID: "CVE-2026-0001", vulnerabilityName: "Old RCE", dateAdded: "2026-01-01", shortDescription: "old", knownRansomwareCampaignUse: "Unknown" },
    { cveID: "CVE-2026-9999", vulnerabilityName: "Fresh RCE", dateAdded: "2026-07-01", shortDescription: "fresh", knownRansomwareCampaignUse: "Known" },
  ],
});

describe("decodeEntities", () => {
  test("named + decimal + hex; &amp; decoded last", () => {
    expect(decodeEntities("&lt;a&gt; &#39;q&#x27; &quot;w&quot;")).toBe(`<a> 'q' "w"`);
    // &amp;lt; must stay literal "&lt;", never become "<"
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("parseRss", () => {
  test("CDATA literal (no double-decode), entity link, HTML-stripped summary, ISO date", () => {
    const [a, b] = parseRss(rssFixture, "Src");
    // CDATA content is literal (no entity decode) but tag-shaped text is still
    // stripped — the UI must never receive markup, whatever the feed intended.
    expect(a!.title).toBe("Critical bug &amp; found");
    expect(a!.link).toBe("https://example.com/a?x=1&y=2");
    expect(a!.dateIso).toBe("2026-07-02T10:00:00.000Z");
    expect(a!.summary).toContain("Long &amp; detailed 'analysis' here"); // one decode pass only
    expect(a!.summary).not.toContain("<p>");
    // media:title must NOT shadow <title>
    expect(a!.title).not.toContain("SHADOW");
    // missing fields tolerated
    expect(b!.title).toBe("No date, no link");
    expect(b!.link).toBe("");
    expect(b!.dateIso).toBe("");
  });
});

describe("parseAtom", () => {
  test("prefers rel=alternate link, skips rel=self; parses published date", () => {
    const [e] = parseAtom(atomFixture, "P0");
    expect(e!.link).toBe("https://blog.example/post/1");
    expect(e!.dateIso).toBe("2026-07-01T10:00:00.000Z");
    expect(e!.summary).toBe("Chain of & bugs");
  });
});

describe("parseKevJson", () => {
  test("maps fields, NVD link, ransomware→critical, sorts date desc", () => {
    const items = parseKevJson(kevFixture, "CISA KEV");
    expect(items[0]!.title).toBe("CVE-2026-9999: Fresh RCE");
    expect(items[0]!.severity).toBe("critical");
    expect(items[1]!.severity).toBe("high");
    expect(items[0]!.link).toBe("https://nvd.nist.gov/vuln/detail/CVE-2026-9999");
  });

  test("caps at 40 latest and survives malformed JSON", () => {
    const many = JSON.stringify({ vulnerabilities: Array.from({ length: 60 }, (_, i) => ({ cveID: `CVE-X-${i}`, dateAdded: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` })) });
    expect(parseKevJson(many, "K").length).toBe(40);
    expect(parseKevJson("not json", "K")).toEqual([]);
  });
});

const okFetch = (body: string): FetchLike => async () => ({ ok: true, status: 200, text: async () => body });
const failFetch: FetchLike = async () => ({ ok: false, status: 404, text: async () => "" });

describe("fetchFeed", () => {
  test("non-200 → null; throw → null", async () => {
    expect(await fetchFeed(FEEDS[1]!, failFetch)).toBeNull();
    expect(await fetchFeed(FEEDS[1]!, async () => { throw new Error("timeout"); })).toBeNull();
  });
});

describe("getFeedItems — cache + isolation", () => {
  beforeEach(() => _resetCache());

  const oneItemRss = (title: string) => `<rss><channel><item><title>${title}</title><pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`;

  test("TTL serves cache; refresh bypasses", async () => {
    let calls = 0;
    const f: FetchLike = async () => { calls++; return { ok: true, status: 200, text: async () => oneItemRss("t") }; };
    await getFeedItems({ fetchImpl: f });
    const c1 = calls;
    await getFeedItems({ fetchImpl: f }); // within TTL → no new fetches
    expect(calls).toBe(c1);
    await getFeedItems({ fetchImpl: f, refresh: true });
    expect(calls).toBe(c1 * 2);
  });

  test("one dead source keeps stale items; others refresh (isolation)", async () => {
    // Round 1: everything succeeds.
    await getFeedItems({ fetchImpl: okFetch(oneItemRss("first")) , refresh: true });
    // Round 2: the SANS feed dies, everything else succeeds with new content.
    const f2: FetchLike = async (url) => {
      if (url.includes("isc.sans.edu")) throw new Error("down");
      return { ok: true, status: 200, text: async () => oneItemRss("second") };
    };
    const { sources, items } = await getFeedItems({ fetchImpl: f2, refresh: true });
    const sans = sources.find((s) => s.id === "sans-isc")!;
    expect(sans.error).toBe("fetch failed");
    expect(sans.items).toBe(1); // stale "first" retained
    expect(items.length).toBeGreaterThan(0);
  });

  test("merges operator-added custom feeds (v12 gap #9)", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => oneItemRss("x") }; };
    const extra = [{ id: "custom-myfeed", title: "My Feed", url: "https://my.example/feed.xml", kind: "rss" as const }];
    const { sources } = await getFeedItems({ fetchImpl: f, refresh: true, extra });
    expect(sources.find((s) => s.id === "custom-myfeed")).toBeTruthy();
    expect(seen).toContain("https://my.example/feed.xml");
  });

  test("a custom feed cannot shadow a curated source id", async () => {
    const f: FetchLike = async () => ({ ok: true, status: 200, text: async () => oneItemRss("x") });
    const extra = [{ id: FEEDS[0].id, title: "evil", url: "https://evil.example/x", kind: "rss" as const }];
    const { sources } = await getFeedItems({ fetchImpl: f, refresh: true, extra });
    // curated id appears exactly once (the impostor is dropped)
    expect(sources.filter((s) => s.id === FEEDS[0].id)).toHaveLength(1);
  });

  test("aggregate sorts date desc and caps totals", async () => {
    const bigRss = `<rss><channel>${Array.from({ length: 50 }, (_, i) => `<item><title>i${i}</title><pubDate>Tue, 0${(i % 9) + 1} Jun 2026 00:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
    const { items } = await getFeedItems({ fetchImpl: okFetch(bigRss), refresh: true });
    expect(items.length).toBeLessThanOrEqual(100);
    const dates = items.map((i) => i.dateIso);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
