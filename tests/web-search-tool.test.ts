// Güven testleri — web_search aracı parser'ları (deterministik, OFFLINE: fixture HTML, ağ/browser yok).
import { describe, test, expect, beforeAll } from "vitest";

let parseSearchResults: any, extractReadable: any, decodeDdgHref: any, parseArgs: any;
let mapLimit: any, cacheKey: any, needsRender: any, snippetSufficient: any, buildDeepResult: any;
beforeAll(async () => {
  // @ts-ignore — host-bridge .mjs aracı (tip dosyası yok)
  const m = await import("../bin/host-bridge/tools/lib/web-extract.mjs");
  parseSearchResults = m.parseSearchResults;
  extractReadable = m.extractReadable;
  decodeDdgHref = m.decodeDdgHref;
  parseArgs = m.parseArgs;
  mapLimit = m.mapLimit;
  cacheKey = m.cacheKey;
  needsRender = m.needsRender;
  snippetSufficient = m.snippetSufficient;
  buildDeepResult = m.buildDeepResult;
});

const DDG = `<html><body>
<div class="result results_links web-result"><div class="links_main">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=aaa">Ollama Docs</a>
  <a class="result__snippet" href="//x">Run large language models   locally.</a>
</div></div>
<div class="result web-result"><div class="links_main">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Follama%2Follama&rut=bbb">ollama/ollama GitHub</a>
  <a class="result__snippet">Get up and running with LLMs.</a>
</div></div>
</body></html>`;

const ARTICLE = `<html><head><title>Test Article</title></head><body>
<nav>menu home about</nav>
<script>var secret = 1234;</script>
<style>.a{color:red}</style>
<article><h1>Heading</h1>
<p>First paragraph content here.</p>
<p>Second paragraph follows.</p>
<a href="https://example.com/inner">inner link</a>
<a href="/relative">rel</a>
</article>
<footer>footer junk text</footer>
</body></html>`;

describe("web_search parser'ları — jsdom (deterministik)", () => {
  test("parseSearchResults: {title,url,snippet} + uddg redirect decode (regex'ten üstün)", () => {
    const r = parseSearchResults(DDG);
    expect(r.length).toBe(2);
    expect(r[0]).toEqual({ title: "Ollama Docs", url: "https://example.com/page1", snippet: "Run large language models locally." });
    expect(r[1].url).toBe("https://github.com/ollama/ollama");
    expect(r[1].snippet).toBe("Get up and running with LLMs."); // ESKİDE snippet YOKTU
  });

  test("decodeDdgHref: redirect + protokolsüz", () => {
    expect(decodeDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fx&rut=z")).toBe("https://a.com/x");
    expect(decodeDdgHref("//cdn.example.com/y")).toBe("https://cdn.example.com/y");
    expect(decodeDdgHref("https://direct.com")).toBe("https://direct.com");
  });

  test("parseSearchResults: maxResults sınırlar", () => {
    expect(parseSearchResults(DDG, 1).length).toBe(1);
  });

  test("extractReadable: ana metin + başlık; script/style/nav/footer ÇIKAR (ham regex'ten temiz)", () => {
    const p = extractReadable(ARTICLE, "https://src");
    expect(p.title).toBe("Test Article");
    expect(p.text).toContain("First paragraph content here.");
    expect(p.text).toContain("Second paragraph follows.");
    expect(p.text).not.toContain("secret");     // <script> atıldı
    expect(p.text).not.toContain("menu home");   // <nav> atıldı
    expect(p.text).not.toContain("footer junk"); // <footer> atıldı
    expect(p.url).toBe("https://src");
  });

  test("extractReadable: yalnız mutlak http(s) linkler (ESKİDE link YOKTU)", () => {
    const p = extractReadable(ARTICLE);
    expect(p.links).toContain("https://example.com/inner");
    expect(p.links).not.toContain("/relative");
  });

  test("bozuk/boş HTML → çökme yok", () => {
    expect(parseSearchResults("")).toEqual([]);
    expect(parseSearchResults("<html><body>no results</body></html>")).toEqual([]);
    const e = extractReadable("<html></html>");
    expect(e.title).toBe("");
    expect(e.links).toEqual([]);
  });

  test("parseArgs: render/deep/top + fetch/query algılama (Chrome + verimli yol)", () => {
    expect(parseArgs(["--render", "--fetch", "http://x"])).toMatchObject({ action: "fetch", render: true, value: "http://x" });
    expect(parseArgs(["--fetch", "http://z"])).toMatchObject({ action: "fetch", render: false, value: "http://z" });
    expect(parseArgs(["ollama", "llm"])).toMatchObject({ action: "search", render: false, deep: false, value: "ollama llm" });
    expect(parseArgs(["--deep", "ollama"])).toMatchObject({ action: "deep", deep: true, top: 3, value: "ollama" });
    expect(parseArgs(["--deep", "--top", "5", "ollama", "llm"])).toMatchObject({ action: "deep", top: 5, value: "ollama llm" });
    expect(parseArgs(["--render", "--deep", "--top", "2", "x"])).toMatchObject({ action: "deep", render: true, top: 2, value: "x" });
  });
});

describe("verimlilik yardımcıları — mapLimit / cacheKey / needsRender / snippetSufficient (saf)", () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("mapLimit: eşzamanlılık ≤ limit + SIRA korunur", async () => {
    let active = 0, max = 0;
    const fn = async (x: number) => { active++; max = Math.max(max, active); await delay(15); active--; return x * 2; };
    const r = await mapLimit([1, 2, 3, 4, 5, 6], 2, fn);
    expect(max).toBeLessThanOrEqual(2);
    expect(r).toEqual([2, 4, 6, 8, 10, 12]); // sıra korunur
  });

  test("mapLimit: bir görev reddederse o slot null (diğerleri tamam)", async () => {
    const r = await mapLimit([1, 2, 3], 2, async (x: number) => { if (x === 2) throw new Error("boom"); return x; });
    expect(r).toEqual([1, null, 3]);
  });

  test("cacheKey: deterministik + ayırt edici", () => {
    expect(cacheKey("fetch", "http://a")).toBe(cacheKey("fetch", "http://a"));
    expect(cacheKey("fetch", "http://a")).not.toBe(cacheKey("fetch", "http://b"));
    expect(cacheKey("search", "q")).not.toBe(cacheKey("fetch", "q"));
  });

  test("needsRender: kısa+script-shell → true; uzun metin → false", () => {
    expect(needsRender('<div id="root"></div><script></script><script></script><script></script>', "x")).toBe(true);
    expect(needsRender("<html><body></body></html>", "")).toBe(true); // boş mount
    expect(needsRender("<p>hello world</p>", "x".repeat(300))).toBe(false); // uzun metin → gerek yok
    expect(needsRender("<p>tiny</p>", "tiny")).toBe(false); // kısa ama JS-shell değil
  });

  test("snippetSufficient: ≥160ch yeterli (fetch atla)", () => {
    expect(snippetSufficient("x".repeat(160))).toBe(true);
    expect(snippetSufficient("x".repeat(159))).toBe(false);
    expect(snippetSufficient("")).toBe(false);
  });

  test("buildDeepResult: fetch/render/snippet kaynak etiketi + şekil (siri-ask kontratı)", () => {
    const sr = { title: "T", url: "https://a.com/x", snippet: "kısa özet" };
    // (a) HTTP fetch sayfası → source:"fetch", text/chars sayfadan, links taşınır
    const f = buildDeepResult(sr, { title: "Page T", text: "tam sayfa metni burada", links: ["https://a.com/l"], rendered: false });
    expect(f).toMatchObject({ url: "https://a.com/x", title: "Page T", text: "tam sayfa metni burada", source: "fetch" });
    expect(f.chars).toBe("tam sayfa metni burada".length);
    expect(f.links).toEqual(["https://a.com/l"]);
    // (b) Chrome-render → source:"render"
    expect(buildDeepResult(sr, { text: "js sonrası metin", links: [], rendered: true }).source).toBe("render");
    // (c) fetch yok/boş → snippet metin olur, source:"snippet"
    const s = buildDeepResult(sr, null);
    expect(s).toMatchObject({ url: "https://a.com/x", title: "T", text: "kısa özet", source: "snippet" });
    expect(s.chars).toBe("kısa özet".length);
  });
});

// ── readability heuristikleri (otonom agent araştırmasından: boilerplate strip + link-density + article-öncelik) ──
describe("extractReadable — readability boilerplate filtreleri (otonom bulgudan)", () => {
  test("aside/figure ana düğüm İÇİNDE olsa bile çıkar (boilerplate strip genişletildi)", () => {
    const H = `<html><body><article>
      <p>Main body text here, a long enough sentence to keep.</p>
      <aside>Subscribe to our newsletter promo junk content</aside>
      <figure><figcaption>Photo getty caption credit</figcaption></figure>
    </article></body></html>`;
    const p = extractReadable(H);
    expect(p.text).toContain("Main body text here");
    expect(p.text).not.toContain("newsletter promo"); // <aside> atıldı
    expect(p.text).not.toContain("getty caption");     // <figure>/<figcaption> atıldı
  });

  test("olası-olmayan-aday kap (class=sidebar) elenir; içerik kabı kalır", () => {
    const H = `<html><body>
      <div class="content"><p>The real article content sentence here, quite long indeed.</p></div>
      <div class="sidebar"><p>Sidebar promo junk content block</p></div>
    </body></html>`;
    const p = extractReadable(H);
    expect(p.text).toContain("The real article content sentence");
    expect(p.text).not.toContain("Sidebar promo junk"); // class=sidebar UNLIKELY → atıldı
  });

  test("yüksek link-yoğunluklu nav-benzeri liste (≥3 link, yoğunluk>0.5) çıkar; paragraf kalır", () => {
    const H = `<html><body><article>
      <p>Genuine article paragraph with real sentences and enough words to matter here.</p>
      <ul>
        <li><a href="https://a.com/1">Link one</a></li>
        <li><a href="https://a.com/2">Link two</a></li>
        <li><a href="https://a.com/3">Link three</a></li>
        <li><a href="https://a.com/4">Link four</a></li>
      </ul>
    </article></body></html>`;
    const p = extractReadable(H);
    expect(p.text).toContain("Genuine article paragraph");
    expect(p.text).not.toContain("Link one"); // yüksek link-yoğunluklu <ul> atıldı
    expect(p.text).not.toContain("Link four");
  });
});
