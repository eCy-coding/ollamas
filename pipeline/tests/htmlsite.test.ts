import { describe, it, expect } from "vitest";
import {
  escapeHtml, slugify, slugToHref, relPrefix,
  buildNav, readingOrder, buildLinkMap, resolveWikilink,
  mdToHtml, buildToc, buildSearchIndex,
  renderHtmlSite, renderPortal, renderStylesCss, renderAppJs,
} from "../lib/htmlsite";
import type { HelpSite } from "../lib/helpsite";

const site = (over: Partial<HelpSite> = {}): HelpSite => ({
  system: "demo",
  hubTitle: "Demo — Yardım",
  references: ["https://code.claude.com/docs/en/quickstart"],
  sections: [
    {
      id: "getting-started", title: "Başlangıç", summary: "ilk adımlar",
      pages: [
        { slug: "getting-started/quickstart", title: "Hızlı Başlangıç", body: "Giriş cümlesi buraya.\n\n## 1. Kur\n\nKurulum açıklaması.\n\n```bash\nnpm run ready\n```\n\n### Alt başlık\n\n- madde bir\n- madde iki", sources: ["README.md"] },
        { slug: "getting-started/genel", title: "Genel", body: "Bu **kalın** ve `kod` içeren bir paragraf, en az iki cümledir. İkinci cümle burada.", sources: ["README.md"] },
      ],
    },
    {
      id: "reference", title: "Referans", summary: "tablolar",
      pages: [
        { slug: "reference/cli", title: "CLI", body: "Tablo:\n\n| Komut | Ne yapar |\n| --- | --- |\n| `ls` | listeler |\n\n> [!info] Bir not\n\n> düz alıntı", sources: ["cli.ts"] },
      ],
    },
  ],
  ...over,
});

describe("primitives", () => {
  it("escapeHtml escapes the dangerous four", () => {
    expect(escapeHtml('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
    expect(escapeHtml(null as never)).toBe("");
  });
  it("slugify folds Turkish letters and collapses non-word", () => {
    expect(slugify("Şık Başlık İçin")).toBe("sik-baslik-icin");
    expect(slugify("!!!")).toBe("b");
  });
  it("slugToHref appends .html", () => {
    expect(slugToHref("guides/cli")).toBe("guides/cli.html");
  });
  it("relPrefix counts directory depth", () => {
    expect(relPrefix("index.html")).toBe("");
    expect(relPrefix("claude/index.html")).toBe("../");
    expect(relPrefix("claude/guides/cli.html")).toBe("../../");
  });
});

describe("model → navigation", () => {
  it("buildNav mirrors sections and pages in model order", () => {
    const nav = buildNav(site());
    expect(nav.map((s) => s.id)).toEqual(["getting-started", "reference"]);
    expect(nav[0].pages[0].href).toBe("demo/getting-started/quickstart.html");
  });
  it("readingOrder is the flat beginner→advanced spine", () => {
    const order = readingOrder(site());
    expect(order.map((p) => p.title)).toEqual(["Hızlı Başlangıç", "Genel", "CLI"]);
  });
  it("buildLinkMap resolves hub, section (id+title), and page (slug+title+leaf)", () => {
    const m = buildLinkMap(site());
    expect(resolveWikilink(m, "Demo — Yardım")).toBe("demo/index.html");
    expect(resolveWikilink(m, "getting-started")).toBe("demo/index.html#getting-started");
    expect(resolveWikilink(m, "Referans")).toBe("demo/index.html#reference");
    expect(resolveWikilink(m, "reference/cli")).toBe("demo/reference/cli.html");
    expect(resolveWikilink(m, "CLI")).toBe("demo/reference/cli.html");
    expect(resolveWikilink(m, "cli")).toBe("demo/reference/cli.html"); // leaf
    expect(resolveWikilink(m, "bilinmeyen")).toBeNull();
  });
});

describe("mdToHtml", () => {
  it("renders every block type", () => {
    const html = mdToHtml(site().sections[0].pages[0].body);
    expect(html).toContain('<h2 id="1-kur">'); // heading with id
    expect(html).toContain('<h3 id="alt-baslik">');
    expect(html).toContain('class="code"'); // fenced code + copy button
    expect(html).toContain('lang-bash');
    expect(html).toContain("<ul><li>madde bir</li>");
    expect(html).toContain("<p>Giriş cümlesi buraya.</p>");
  });
  it("renders tables, callouts and blockquotes", () => {
    const html = mdToHtml(site().sections[1].pages[0].body);
    expect(html).toContain("<table><thead>");
    expect(html).toContain("<td><code>ls</code></td>");
    expect(html).toContain('class="callout callout-info"');
    expect(html).toContain("<blockquote>düz alıntı</blockquote>");
  });
  it("renders inline bold, code, links and wikilinks (resolved + broken)", () => {
    const resolve = (t: string) => (t === "genel" ? "demo/getting-started/genel.html" : null);
    const html = mdToHtml("**b** `c` [x](https://y.z) [[genel]] [[yok]]", resolve);
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<code>c</code>");
    expect(html).toContain('<a href="https://y.z" rel="noopener" target="_blank">x</a>');
    expect(html).toContain('<a href="demo/getting-started/genel.html">genel</a>');
    expect(html).toContain('<span class="wikilink-broken">yok</span>');
  });
  it("handles empty/null input and code fence without a language", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml(null as never)).toBe("");
    expect(mdToHtml("```\nplain\n```")).toContain('class="lang-"');
  });
  it("buildToc scrapes h2/h3 ids and omits when empty", () => {
    const toc = buildToc(mdToHtml(site().sections[0].pages[0].body));
    expect(toc.map((t) => t.id)).toContain("1-kur");
    expect(toc.some((t) => t.level === 3)).toBe(true);
    expect(buildToc("<p>no headings</p>")).toEqual([]);
  });
});

describe("buildSearchIndex", () => {
  it("emits a hub doc + one per page, text flattened and lowercased", () => {
    const docs = buildSearchIndex(site());
    expect(docs).toHaveLength(1 + 3);
    expect(docs[0].href).toBe("demo/index.html");
    expect(docs[1].text).not.toMatch(/[#*`|]/);
    expect(docs[1].text).toBe(docs[1].text.toLowerCase());
  });
});

describe("renderHtmlSite", () => {
  const files = renderHtmlSite(site());
  it("emits a hub + one file per page, all under the system dir", () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain("demo/index.html");
    expect(paths).toContain("demo/getting-started/quickstart.html");
    expect(paths).toContain("demo/reference/cli.html");
    expect(files.every((f) => f.path.startsWith("demo/"))).toBe(true);
  });
  it("hub lists sections with anchors and the page list", () => {
    const hub = files.find((f) => f.path === "demo/index.html")!.content;
    expect(hub).toContain('<h2 id="getting-started">Başlangıç</h2>');
    expect(hub).toContain('class="pagelist"');
    expect(hub).not.toContain('class="switcher"'); // single system → no switcher
  });
  it("a leaf page carries breadcrumb, TOC, prev/next and source footer", () => {
    const q = files.find((f) => f.path === "demo/getting-started/quickstart.html")!.content;
    expect(q).toContain('class="crumb"');
    expect(q).toContain('class="toc"');
    expect(q).toContain("Sonraki →");
    expect(q).toContain("🔗 Kaynak: README.md");
    const last = files.find((f) => f.path === "demo/reference/cli.html")!.content;
    expect(last).toContain("← Önceki");
    expect(last).not.toContain('class="toc"'); // cli body has no headings → no TOC
  });
  it("is byte-deterministic", () => {
    expect(renderHtmlSite(site())).toEqual(files);
  });
});

describe("renderPortal", () => {
  const files = renderPortal([site(), site({ system: "demo2", hubTitle: "Demo2 — Yardım" })]);
  const at = (p: string) => files.find((f) => f.path === p)?.content ?? "";
  it("emits landing, kaynaklar, both systems, assets, llms.txt and md deliverables", () => {
    for (const p of ["index.html", "kaynaklar.html", "llms.txt", "REFERENCES.md", "GAPS.md",
      "assets/styles.css", "assets/app.js", "assets/search-index.js", "demo/index.html", "demo2/index.html"]) {
      expect(files.some((f) => f.path === p)).toBe(true);
    }
  });
  it("landing has a card per system + a references card", () => {
    expect(at("index.html")).toContain('class="cards"');
    expect((at("index.html").match(/class="card"/g) || []).length).toBe(2);
    expect(at("index.html")).toContain('class="card card-ref"');
  });
  it("multi-system pages carry the switcher", () => {
    expect(at("demo/index.html")).toContain('class="switcher"');
  });
  it("search index assigns window.__HELP_INDEX__ and covers both systems", () => {
    const js = at("assets/search-index.js");
    expect(js.startsWith("window.__HELP_INDEX__ = [")).toBe(true);
    const arr = JSON.parse(js.replace(/^window\.__HELP_INDEX__ = /, "").replace(/;$/, ""));
    expect(arr.some((d: { system: string }) => d.system === "demo")).toBe(true);
    expect(arr.some((d: { system: string }) => d.system === "demo2")).toBe(true);
  });
  it("llms.txt lists every page and no html carries a broken wikilink", () => {
    expect(at("llms.txt")).toContain("demo/getting-started/quickstart.html");
    expect(files.filter((f) => f.path.endsWith(".html") && f.content.includes("wikilink-broken"))).toEqual([]);
  });
  it("is deterministic", () => {
    expect(renderPortal([site(), site({ system: "demo2", hubTitle: "Demo2 — Yardım" })])).toEqual(files);
  });
  it("accepts explicit gaps and a first section without a summary", () => {
    const g = [{ system: "demo", area: "quickstart", evidence: "kanıt", severity: "high" as const, plannedBy: "p1", plan: "yap" }];
    const noSummary = site({ sections: [{ id: "getting-started", title: "Başlangıç", summary: "", pages: site().sections[0].pages }] });
    const f2 = renderPortal([noSummary], { gaps: g });
    expect(f2.find((f) => f.path === "GAPS.md")!.content).toContain("p1");
    expect(f2.find((f) => f.path === "index.html")!.content).toContain('class="card"');
  });
});

describe("defensive + edge branches", () => {
  it("wikilink with an explicit alias uses the alias label", () => {
    const html = mdToHtml("[[genel|Özel Etiket]]", (t) => (t === "genel" ? "demo/x.html" : null));
    expect(html).toContain('<a href="demo/x.html">Özel Etiket</a>');
  });
  it("buildNav/readingOrder tolerate a section with no pages array", () => {
    const s = site({ sections: [{ id: "x", title: "X", summary: "", pages: undefined as never }] });
    expect(buildNav(s)[0].pages).toEqual([]);
    expect(readingOrder(s)).toEqual([]);
  });
  it("renders a single-page site with no prev/next and a page lacking summary/sources", () => {
    const one = site({
      sections: [{ id: "getting-started", title: "Başlangıç", summary: "", pages: [
        { slug: "getting-started/solo", title: "Tek", body: "Tek sayfalık gövde, yeterince uzun bir cümle burada duruyor.", sources: undefined as never },
      ] }],
    });
    const files = renderHtmlSite(one);
    const leaf = files.find((f) => f.path === "demo/getting-started/solo.html")!.content;
    expect(leaf).not.toContain("class=\"prevnext\""); // no prev and no next
    expect(leaf).toContain("🔗 Kaynak: "); // empty sources → footer still renders
    const hub = files.find((f) => f.path === "demo/index.html")!.content;
    expect(hub).toContain('<h2 id="getting-started">'); // no summary → no <p> after, still valid
  });
});

describe("assets", () => {
  it("styles carry theme vars and the responsive grid", () => {
    const css = renderStylesCss();
    expect(css).toContain("data-theme=dark");
    expect(css).toContain("grid-template-columns:260px 1fr 220px");
  });
  it("app.js wires theme, copy, and search with '/' focus", () => {
    const js = renderAppJs();
    expect(js).toContain("__HELP_INDEX__");
    expect(js).toContain("help-theme");
    expect(js).toContain("navigator.clipboard");
    expect(js).toContain("'/'");
  });
});
