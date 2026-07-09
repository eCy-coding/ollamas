// @ts-check
// bin/host-bridge/tools/lib/web-extract.mjs — saf, deterministik web yardımcıları (jsdom; ağ yok).
// web_search.mjs bunları kullanır; testler aynı fonksiyonları fixture/birim ile doğrular.
import { JSDOM, VirtualConsole } from "jsdom";
import { createHash } from "node:crypto";

// Sessiz VirtualConsole: jsdom'un CSS/script uyarılarını yutar → stdout JSON'u ASLA kirlenmez
// (agent stdout'u parse eder; stderr gürültüsü tool çağrısını bozardı).
const SILENT = new VirtualConsole();
const dom = (html) => new JSDOM(html || "", { virtualConsole: SILENT }).window.document;

/** DuckDuckGo HTML sonucu `/l/?uddg=<encoded>` redirect'iyle sarar → gerçek URL'i çöz. */
export function decodeDdgHref(href) {
  if (!href) return "";
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  if (href.startsWith("//")) return "https:" + href;
  return href;
}

/** DuckDuckGo HTML → yapısal sonuçlar [{title,url,snippet}] (regex yerine jsdom). */
export function parseSearchResults(html, maxResults = 6) {
  const doc = dom(html);
  const out = [];
  const nodes = Array.from(doc.querySelectorAll(".result, .web-result, .results_links"));
  for (const n of nodes) {
    const a = n.querySelector("a.result__a") || n.querySelector("h2 a") || n.querySelector("a[href]");
    if (!a) continue;
    const title = (a.textContent || "").trim().replace(/\s+/g, " ");
    const url = decodeDdgHref(a.getAttribute("href") || "");
    const snEl = n.querySelector(".result__snippet") || n.querySelector(".snippet");
    const snippet = (snEl?.textContent || "").trim().replace(/\s+/g, " ");
    if (title && /^https?:\/\//.test(url)) {
      out.push({ title, url, snippet });
      if (out.length >= maxResults) break;
    }
  }
  return out;
}

// ── readability heuristikleri (otonom agent araştırmasından, dependency-free) ──
// Kesin boilerplate düğümleri: anlamsal tag'ler + ARIA landmark'lar.
const STRIP_SEL =
  "script, style, noscript, nav, footer, header, svg, iframe, form, aside, figure, figcaption, " +
  "[role=navigation], [role=banner], [role=complementary], [role=search], [aria-hidden=true]";
// "Olası olmayan aday" kap class/id anahtar kelimeleri (Readability unlikelyCandidates ruhunda).
// header/footer ve çıplak "ad" KASTEN yok (içerik class'larında yanlış-pozitif riski: article-header vb.).
const UNLIKELY =
  /(^|[\s_-])(nav|navbar|menu|sidebar|comment|comments|share|sharing|social|related|recirc|promo|advert|advertisement|ads|adbox|cookie|consent|gdpr|popup|modal|subscribe|newsletter|breadcrumb|pagination|masthead|widget|disqus)([\s_-]|$)/i;

/** Bir elemanın link-yoğunluğu = link metni uzunluğu / toplam metin uzunluğu (arc90/Boilerpipe sinyali). */
function linkDensity(el) {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  let linkLen = 0;
  for (const a of el.querySelectorAll("a")) linkLen += (a.textContent || "").replace(/\s+/g, " ").trim().length;
  return linkLen / text.length;
}

/** Bir sayfanın OKUNABİLİR ana metni + başlık + linkler. Boilerplate (nav/sidebar/yüksek link-yoğunluğu) elenir. */
export function extractReadable(html, url = "", maxText = 6000) {
  const doc = dom(html);
  // 1) Kesin boilerplate (tag + ARIA landmark) çıkar.
  doc.querySelectorAll(STRIP_SEL).forEach((e) => e.remove());
  // 2) Olası-olmayan-aday kaplar (class/id anahtar kelime). Ana içeriği koruyan guard: article/main içeren
  //    ya da article/main/body OLAN düğümü ASLA silme.
  doc.querySelectorAll("[class], [id]").forEach((e) => {
    const tag = e.tagName;
    if (tag === "ARTICLE" || tag === "MAIN" || tag === "BODY") return;
    if (e.querySelector && e.querySelector("article, main")) return;
    const key = (e.getAttribute("class") || "") + " " + (e.getAttribute("id") || "");
    if (UNLIKELY.test(key)) e.remove();
  });
  const title = (doc.querySelector("title")?.textContent || doc.querySelector("h1")?.textContent || "").trim();
  // 3) En özgül içerik düğümü: article > main > (en yüksek metin-yoğunluklu) body.
  let main = doc.querySelector("article") || doc.querySelector("main");
  if (!main) main = doc.body || doc.documentElement;
  // 4) Link-density temizliği: ana düğüm içinde kalan nav-benzeri kaplar (≥3 link + yoğunluk>0.5) çıkar.
  if (main && main.querySelectorAll) {
    for (const c of Array.from(main.querySelectorAll("ul, ol, div, section"))) {
      if (c.querySelectorAll("a").length >= 3 && linkDensity(c) > 0.5) c.remove();
    }
  }
  const text = (main?.textContent || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxText);
  const links = Array.from(doc.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") || "")
    .filter((h) => /^https?:\/\//.test(h))
    .slice(0, 30);
  return { title, url, text, links };
}

/** CLI argv → {action, render, deep, top, value} (saf; deterministik test edilir). */
export function parseArgs(argv) {
  const render = argv.includes("--render");
  const deep = argv.includes("--deep");
  const ti = argv.indexOf("--top");
  const top = ti >= 0 ? Math.max(1, parseInt(argv[ti + 1], 10) || 3) : 3;
  const rest = argv.filter((a, i) => a !== "--render" && a !== "--deep" && a !== "--top" && !(ti >= 0 && i === ti + 1));
  if (rest[0] === "--fetch") return { action: "fetch", render, deep, top, value: rest[1] || "" };
  return { action: deep ? "deep" : "search", render, deep, top, value: rest.join(" ").trim() };
}

// ───────────────────────── verimlilik yardımcıları (saf, deterministik) ─────────────────────────
/** Sıra-koruyan bounded paralel pool; eşzamanlılık ≤ limit; bir görev reddederse o slot null. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); } catch { results[idx] = null; }
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** İçerik-adresli cache anahtarı (sha256). */
export function cacheKey(kind, value) {
  return createHash("sha256").update(kind + ":" + value).digest("hex");
}

/** Sayfa JS-render gerektiriyor mu? Kısa metin + script-yoğun/boş-mount shell → evet. */
export function needsRender(html, text) {
  if ((text || "").length >= 200) return false;
  const scripts = ((html || "").match(/<script\b/gi) || []).length;
  const emptyMount = /<(?:div|main)[^>]*\bid=["'](?:root|app|__next|___gatsby)["']/i.test(html || "") || /<body[^>]*>\s*<\/body>/i.test(html || "");
  return scripts >= 3 || emptyMount;
}

/** Snippet tek başına yeterliyse (uzunsa) fetch'i atla. */
export function snippetSufficient(snippet) {
  return (snippet || "").length >= 160;
}

/**
 * deep sonuç objesini derle (saf). sr={title,url,snippet}; page={title,text,links,rendered}|null.
 * page varsa TAM metin (source: rendered?"render":"fetch"); yoksa snippet metin olur (source:"snippet").
 * siri-ask + deep-demo kontratı: {title,url,snippet,text,chars,source,links}.
 */
export function buildDeepResult(sr, page) {
  if (page && page.text) {
    return {
      title: page.title || sr.title || "",
      url: sr.url,
      snippet: sr.snippet || "",
      text: page.text,
      chars: page.text.length,
      source: page.rendered ? "render" : "fetch",
      links: page.links || [],
    };
  }
  const text = sr.snippet || "";
  return { title: sr.title || "", url: sr.url, snippet: sr.snippet || "", text, chars: text.length, source: "snippet", links: [] };
}
