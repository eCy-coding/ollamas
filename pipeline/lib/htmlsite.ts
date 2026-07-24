// htmlsite — render the (already-validated) HelpSite model into a REAL static docs website.
//
// WHY THIS EXISTS
// v8 produced Obsidian markdown; the operator wants a coded website that looks and behaves like
// the reference docs sites (code.claude.com/docs, obsidian.md/help): a landing card-grid, a
// persistent left sidebar, a right-hand "on this page" TOC, client-side search, a dark/light
// theme, copy-button code blocks, callouts, prev/next, responsive layout, and an llms.txt
// machine index. This module is the renderer — PURE (no fs/clock/random) so the whole site is a
// deterministic function of the model and unit-testable byte-for-byte.
//
// file:// CONSTRAINT (the load-bearing one): a page opened from disk cannot fetch(). So the
// search index is emitted as `assets/search-index.js` that ASSIGNS `window.__HELP_INDEX__`, and
// every asset/link is a RELATIVE url prefixed by the page's depth. No absolute paths, no fetch —
// the site works from file:// and from any trivial static server identically.

import type { HelpSite, HelpSection, HelpPage } from "./helpsite";
import { renderReferencesHtml, renderReferencesMd } from "./references";
import { renderGapsMd, SEED_GAPS, type Gap } from "./gaps";

export interface SiteFile {
  /** Path relative to the site root, e.g. "claude/guides/cli.html". */
  path: string;
  content: string;
}

export interface SystemRef {
  id: string;
  title: string;
}

export interface RenderCtx {
  /** All systems in the portal (for the sidebar's system-switcher). Defaults to just this site. */
  systems: SystemRef[];
}

export interface NavPage {
  title: string;
  href: string;
}
export interface NavSection {
  id: string;
  title: string;
  pages: NavPage[];
}
export interface FlatPage {
  system: string;
  title: string;
  sectionTitle: string;
  href: string;
}
export interface TocEntry {
  level: 2 | 3;
  id: string;
  text: string;
}
export interface SearchDoc {
  title: string;
  system: string;
  section: string;
  href: string;
  text: string;
}

// ─── primitives ──────────────────────────────────────────────────────────────

/** HTML-escape (callback-free so it is fully exercised regardless of input). */
export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A stable heading id: lower-cased, Turkish letters folded, non-word → dash. */
export function slugify(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return String(text ?? "")
    .toLowerCase() // fold case first so Ş/İ/… lower to their ş/i̇/… forms
    .replace(/[çğıöşü]/g, (c) => map[c])
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip combining marks (İ → i̇ → i)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "b";
}

/** A page slug within a system → its href relative to the system dir, e.g. "guides/cli" → "guides/cli.html". */
export function slugToHref(slug: string): string {
  return `${slug}.html`;
}

/** The relative prefix that turns a root-relative href into one usable from a file at this path. */
export function relPrefix(fileRelPath: string): string {
  const depth = (fileRelPath.match(/\//g) || []).length; // number of dir levels
  return "../".repeat(depth);
}

// ─── model → navigation ──────────────────────────────────────────────────────

/** Root-relative href of a page: "<system>/<slug>.html". */
function pageHref(system: string, page: HelpPage): string {
  return `${system}/${slugToHref(page.slug)}`;
}
/** Root-relative href of a system hub. */
function hubHref(system: string): string {
  return `${system}/index.html`;
}

/** Sidebar tree for one system: sections in model order, pages in model order. Deterministic. */
export function buildNav(site: HelpSite): NavSection[] {
  return site.sections.map((s) => ({
    id: s.id,
    title: s.title,
    pages: (s.pages ?? []).map((p) => ({ title: p.title, href: pageHref(site.system, p) })),
  }));
}

/** The linear beginner→advanced spine for prev/next: every page, section order then page order. */
export function readingOrder(site: HelpSite): FlatPage[] {
  const out: FlatPage[] = [];
  for (const s of site.sections) {
    for (const p of s.pages ?? []) {
      out.push({ system: site.system, title: p.title, sectionTitle: s.title, href: pageHref(site.system, p) });
    }
  }
  return out;
}

/**
 * Map every wikilink target the validator accepts to a real href — EXACTLY the target set
 * validateHelpSite builds, so a site that passes the validator has zero unresolved links here.
 */
export function buildLinkMap(site: HelpSite): Map<string, string> {
  const m = new Map<string, string>();
  m.set(site.hubTitle, hubHref(site.system));
  for (const s of site.sections) {
    const secHref = `${hubHref(site.system)}#${slugify(s.id)}`;
    m.set(s.id, secHref);
    m.set(s.title, secHref);
    for (const p of s.pages ?? []) {
      const h = pageHref(site.system, p);
      m.set(p.slug, h);
      m.set(p.title, h);
      m.set(p.slug.split("/").pop() ?? p.slug, h);
    }
  }
  return m;
}

export function resolveWikilink(map: Map<string, string>, target: string): string | null {
  return map.get(target) ?? null;
}

// ─── markdown → html (tiny, line-oriented subset) ────────────────────────────

/** Inline: **bold**, `code`, [text](url), [[wikilink]] (resolved or marked broken). */
function inlineMd(text: string, resolve: (t: string) => string | null): string {
  const parts: string[] = [];
  let rest = text;
  const codeSplit = rest.split(/(`[^`]+`)/g);
  for (const seg of codeSplit) {
    if (seg.startsWith("`") && seg.endsWith("`") && seg.length >= 2) {
      parts.push(`<code>${escapeHtml(seg.slice(1, -1))}</code>`);
      continue;
    }
    let h = escapeHtml(seg);
    h = h.replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_m, tgt, alias) => {
      const label = alias || String(tgt).replace(/-/g, " ");
      const href = resolve(String(tgt).trim());
      return href ? `<a href="${href}">${escapeHtml(label)}</a>` : `<span class="wikilink-broken">${escapeHtml(label)}</span>`;
    });
    h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, label, url) => `<a href="${escapeHtml(url)}" rel="noopener" target="_blank">${escapeHtml(label)}</a>`);
    h = h.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
    parts.push(h);
  }
  return parts.join("");
}

/**
 * Render a Markdown subset to HTML: headings (with ids), fenced code (copy-button), tables,
 * unordered lists, callouts (`> [!type] …`), blockquotes, paragraphs, and the inline forms.
 * `resolve` turns a wikilink target into an href (or null). Deterministic.
 */
export function mdToHtml(md: string, resolve: (t: string) => string | null = () => null): string {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const flushPara: string[] = [];
  const closePara = () => {
    if (flushPara.length) {
      out.push(`<p>${inlineMd(flushPara.join(" "), resolve)}</p>`);
      flushPara.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      closePara();
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // consume closing fence
      out.push(
        `<div class="code"><button class="copy" type="button" aria-label="Kopyala">Kopyala</button>` +
          `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(buf.join("\n"))}</code></pre></div>`,
      );
      continue;
    }
    // table (header row + separator row)
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closePara();
      const cells = (r: string) => r.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineMd(c, resolve)}</th>`).join("")}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c, resolve)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    // callout: > [!type] title
    const callout = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (callout) {
      closePara();
      out.push(`<div class="callout callout-${escapeHtml(callout[1].toLowerCase())}">${inlineMd(callout[2], resolve)}</div>`);
      i++;
      continue;
    }
    // blockquote
    if (/^>\s+/.test(line)) {
      closePara();
      out.push(`<blockquote>${inlineMd(line.replace(/^>\s+/, ""), resolve)}</blockquote>`);
      i++;
      continue;
    }
    // heading
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      closePara();
      const level = h[1].length;
      const text = h[2].trim();
      out.push(`<h${level} id="${slugify(text)}">${inlineMd(text, resolve)}</h${level}>`);
      i++;
      continue;
    }
    // unordered list
    if (/^[-*]\s+/.test(line)) {
      closePara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^[-*]\s+/, ""), resolve)}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // blank line ends a paragraph
    if (!line.trim()) {
      closePara();
      i++;
      continue;
    }
    flushPara.push(line.trim());
    i++;
  }
  closePara();
  return out.join("\n");
}

/** Scrape the "on this page" TOC from rendered body HTML (h2/h3 with ids). */
export function buildToc(bodyHtml: string): TocEntry[] {
  const out: TocEntry[] = [];
  for (const m of bodyHtml.matchAll(/<h([23]) id="([^"]+)">(.*?)<\/h[23]>/g)) {
    out.push({ level: Number(m[1]) as 2 | 3, id: m[2], text: m[3].replace(/<[^>]+>/g, "") });
  }
  return out;
}

// ─── search index ────────────────────────────────────────────────────────────

/** One search doc per hub + leaf page; text = flattened, lowercased, capped. */
export function buildSearchIndex(site: HelpSite): SearchDoc[] {
  const docs: SearchDoc[] = [
    { title: site.hubTitle, system: site.system, section: "", href: hubHref(site.system), text: site.sections.map((s) => s.title).join(" ").toLowerCase() },
  ];
  for (const s of site.sections) {
    for (const p of s.pages ?? []) {
      const text = String(p.body ?? "")
        .replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_m, t, a) => a || String(t))
        .replace(/[#*`|>-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .slice(0, 1500);
      docs.push({ title: p.title, system: site.system, section: s.title, href: pageHref(site.system, p), text });
    }
  }
  return docs;
}

// ─── page shells ─────────────────────────────────────────────────────────────

function sidebarHtml(site: HelpSite, ctx: RenderCtx, prefix: string, activeHref: string): string {
  const switcher = ctx.systems.length > 1
    ? `<div class="switcher">${ctx.systems.map((s) => `<a href="${prefix}${hubHref(s.id)}"${s.id === site.system ? ' aria-current="true"' : ""}>${escapeHtml(s.title.replace(/ — Yardım$/, ""))}</a>`).join("")}</div>`
    : "";
  const groups = buildNav(site).map((sec) => {
    const items = sec.pages
      .map((p) => `<li><a href="${prefix}${p.href}"${p.href === activeHref ? ' aria-current="page"' : ""}>${escapeHtml(p.title)}</a></li>`)
      .join("");
    return `<div class="nav-group"><a class="nav-head" href="${prefix}${hubHref(site.system)}#${slugify(sec.id)}">${escapeHtml(sec.title)}</a><ul>${items}</ul></div>`;
  }).join("");
  return `<nav class="sidebar" aria-label="Bölümler"><a class="home-link" href="${prefix}index.html">← Yardım Merkezi</a>${switcher}${groups}</nav>`;
}

function tocHtml(toc: TocEntry[]): string {
  if (!toc.length) return "";
  const items = toc.map((t) => `<li class="lvl-${t.level}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join("");
  return `<nav class="toc" aria-label="Bu sayfada"><p class="toc-title">Bu sayfada</p><ul>${items}</ul></nav>`;
}

function topbar(prefix: string): string {
  return (
    `<header class="topbar"><a class="brand" href="${prefix}index.html">Yardım Merkezi</a>` +
    `<div class="search"><input id="q" type="search" placeholder="Ara…  ( / )" autocomplete="off" aria-label="Ara"><div id="results" class="results" hidden></div></div>` +
    `<button id="theme" class="theme" type="button" aria-label="Tema">◐</button></header>`
  );
}

const THEME_HEAD = `<script>try{var t=localStorage.getItem('help-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>`;

function docShell(opts: { title: string; prefix: string; body: string; bodyClass: string; dataRoot: string }): string {
  return (
    `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(opts.title)}</title>${THEME_HEAD}<link rel="stylesheet" href="${opts.prefix}assets/styles.css"></head>` +
    `<body class="${opts.bodyClass}" data-root="${opts.dataRoot}">${opts.body}` +
    `<script src="${opts.prefix}assets/search-index.js"></script><script src="${opts.prefix}assets/app.js"></script></body></html>`
  );
}

function prevNextHtml(order: FlatPage[], idx: number, prefix: string): string {
  const prev = order[idx - 1];
  const next = order[idx + 1];
  if (!prev && !next) return "";
  const link = (p: FlatPage | undefined, rel: string) =>
    p ? `<a class="pn ${rel}" href="${prefix}${p.href}"><span>${rel === "prev" ? "← Önceki" : "Sonraki →"}</span><strong>${escapeHtml(p.title)}</strong></a>` : `<span class="pn"></span>`;
  return `<nav class="prevnext">${link(prev, "prev")}${link(next, "next")}</nav>`;
}

// ─── per-system rendering ────────────────────────────────────────────────────

/** Render every page (hub + leaves) for one system. Deterministic. */
export function renderHtmlSite(site: HelpSite, ctx?: RenderCtx): SiteFile[] {
  const context: RenderCtx = ctx ?? { systems: [{ id: site.system, title: site.hubTitle }] };
  const resolve = (t: string) => {
    const href = resolveWikilink(buildLinkMap(site), t);
    return href ?? null;
  };
  const order = readingOrder(site);
  const files: SiteFile[] = [];

  // hub (system landing): hero + section index with anchors
  const hubPath = hubHref(site.system);
  const hubPrefix = relPrefix(hubPath);
  const hubBodyParts: string[] = [
    `<div class="hero"><h1>${escapeHtml(site.hubTitle)}</h1><p class="lead">${site.sections.length} bölüm · ${order.length} sayfa · kanonik kaynaklara çapalı.</p></div>`,
  ];
  for (const s of site.sections) {
    hubBodyParts.push(`<h2 id="${slugify(s.id)}">${escapeHtml(s.title)}</h2>`);
    if (s.summary) hubBodyParts.push(`<p>${escapeHtml(s.summary)}</p>`);
    hubBodyParts.push(
      `<ul class="pagelist">${(s.pages ?? []).map((p) => `<li><a href="${hubPrefix}${pageHref(site.system, p)}">${escapeHtml(p.title)}</a></li>`).join("")}</ul>`,
    );
  }
  const hubMain = `<main class="content"><article class="doc">${hubBodyParts.join("\n")}</article></main>`;
  files.push({
    path: hubPath,
    content: docShell({
      title: site.hubTitle,
      prefix: hubPrefix,
      dataRoot: hubPrefix,
      bodyClass: "layout",
      body: topbar(hubPrefix) + `<div class="shell">${sidebarHtml(site, context, hubPrefix, "")}${hubMain}</div>`,
    }),
  });

  // leaf pages
  order.forEach((flat, idx) => {
    // hrefs in `order` come from the same pages, so findPage always resolves (asserted).
    const page = findPage(site, flat.href)!;
    const path = flat.href;
    const prefix = relPrefix(path);
    const bodyHtml = mdToHtml(page.body, resolve);
    const toc = buildToc(bodyHtml);
    const crumb = `<nav class="crumb"><a href="${prefix}${hubHref(site.system)}">${escapeHtml(site.hubTitle)}</a> › <span>${escapeHtml(flat.sectionTitle)}</span></nav>`;
    const footer = `<footer class="page-foot">🔗 Kaynak: ${(page.sources ?? []).map((u) => escapeHtml(u)).join(" · ")}</footer>`;
    const article = `<article class="doc">${crumb}<h1>${escapeHtml(page.title)}</h1>${bodyHtml}${prevNextHtml(order, idx, prefix)}${footer}</article>`;
    const main = `<main class="content">${article}</main>`;
    files.push({
      path,
      content: docShell({
        title: `${page.title} — ${site.hubTitle}`,
        prefix,
        dataRoot: prefix,
        bodyClass: "layout",
        body: topbar(prefix) + `<div class="shell">${sidebarHtml(site, context, prefix, flat.href)}${main}${tocHtml(toc)}</div>`,
      }),
    });
  });

  return files;
}

/** Find the HelpPage whose href matches (used to attach body/sources to a FlatPage). */
function findPage(site: HelpSite, href: string): HelpPage | undefined {
  for (const s of site.sections) for (const p of s.pages ?? []) if (pageHref(site.system, p) === href) return p;
  return undefined;
}

// ─── portal (the whole site) ─────────────────────────────────────────────────

export interface PortalOptions {
  gaps?: Gap[];
}

/** Render the unified site: landing card-grid + every system + assets + refs + gaps + llms.txt. */
export function renderPortal(sites: HelpSite[], opts: PortalOptions = {}): SiteFile[] {
  const ctx: RenderCtx = { systems: sites.map((s) => ({ id: s.system, title: s.hubTitle })) };
  const files: SiteFile[] = [];
  for (const site of sites) files.push(...renderHtmlSite(site, ctx));

  // landing (root index): hero + a card per system + a Kaynaklar card
  const cards = sites
    .map((s) => {
      const pages = readingOrder(s).length;
      const summary = s.sections[0]?.summary ?? "";
      return `<a class="card" href="${hubHref(s.system)}"><h3>${escapeHtml(s.hubTitle.replace(/ — Yardım$/, ""))}</h3><p>${escapeHtml(summary)}</p><span class="badge">${s.sections.length} bölüm · ${pages} sayfa</span></a>`;
    })
    .join("");
  const refCard = `<a class="card card-ref" href="kaynaklar.html"><h3>Kaynaklar</h3><p>Bu sitenin referans aldığı sayfalar ve hedef özellik sözleşmesi.</p><span class="badge">kalıcı liste</span></a>`;
  const landingBody =
    topbar("") +
    `<main class="landing"><div class="hero big"><h1>Yardım Merkezi</h1><p class="lead">ollamas · eCym · Claude · Obsidian — referans docs siteleri standardında, başlangıçtan ileriye.</p></div>` +
    `<div class="cards">${cards}${refCard}</div></main>`;
  files.push({ path: "index.html", content: docShell({ title: "Yardım Merkezi", prefix: "", dataRoot: "", bodyClass: "home", body: landingBody }) });

  // Kaynaklar page (references), from the permanent data
  const refBody =
    topbar("") +
    `<main class="content"><article class="doc"><nav class="crumb"><a href="index.html">Yardım Merkezi</a> › <span>Kaynaklar</span></nav><h1>Kaynaklar</h1>${renderReferencesHtml()}</article></main>`;
  files.push({ path: "kaynaklar.html", content: docShell({ title: "Kaynaklar — Yardım Merkezi", prefix: "", dataRoot: "", bodyClass: "layout", body: refBody }) });

  // permanent markdown deliverables
  files.push({ path: "REFERENCES.md", content: renderReferencesMd() });
  files.push({ path: "GAPS.md", content: renderGapsMd(opts.gaps ?? SEED_GAPS) });

  // llms.txt machine index — every page, one line
  const idx = ["# Yardım Merkezi — sayfa indeksi", ""];
  for (const site of sites) {
    idx.push(`## ${site.hubTitle}`, `- ${hubHref(site.system)} — ${site.hubTitle}`);
    for (const f of readingOrder(site)) idx.push(`- ${f.href} — ${f.title} (${f.sectionTitle})`);
    idx.push("");
  }
  files.push({ path: "llms.txt", content: idx.join("\n") });

  // assets
  const searchDocs = sites.flatMap((s) => buildSearchIndex(s));
  files.push({ path: "assets/search-index.js", content: `window.__HELP_INDEX__ = ${JSON.stringify(searchDocs)};` });
  files.push({ path: "assets/styles.css", content: renderStylesCss() });
  files.push({ path: "assets/app.js", content: renderAppJs() });

  return files;
}

// ─── assets (inline, zero-dep) ───────────────────────────────────────────────

export function renderStylesCss(): string {
  return `:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e4e4e7;--accent:#6d4aff;--code-bg:#f6f6f7;--card:#fafafa;--side:#fbfbfc}
:root[data-theme=dark]{--bg:#16161a;--fg:#e8e8ea;--muted:#9a9aa5;--line:#2a2a30;--accent:#a78bfa;--code-bg:#1e1e24;--card:#1c1c22;--side:#141418}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16161a;--fg:#e8e8ea;--muted:#9a9aa5;--line:#2a2a30;--accent:#a78bfa;--code-bg:#1e1e24;--card:#1c1c22;--side:#141418}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{font-weight:700;color:var(--fg)}
.search{position:relative;flex:1;max-width:520px}.search input{width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
.results{position:absolute;top:110%;left:0;right:0;background:var(--bg);border:1px solid var(--line);border-radius:8px;max-height:60vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.12)}
.results a{display:block;padding:8px 12px;color:var(--fg);border-bottom:1px solid var(--line)}.results a:hover,.results a.sel{background:var(--card);text-decoration:none}
.results .r-sec{color:var(--muted);font-size:12px}
.theme{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;width:36px;height:36px;cursor:pointer}
.shell{display:grid;grid-template-columns:260px 1fr 220px;gap:0;align-items:start;max-width:1280px;margin:0 auto}
.sidebar{position:sticky;top:57px;align-self:start;max-height:calc(100vh - 57px);overflow:auto;padding:20px 14px;border-right:1px solid var(--line);background:var(--side)}
.home-link{display:block;color:var(--muted);font-size:13px;margin-bottom:12px}
.switcher{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}.switcher a{font-size:12px;padding:3px 8px;border:1px solid var(--line);border-radius:999px;color:var(--fg)}
.switcher a[aria-current=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.nav-group{margin-bottom:14px}.nav-head{display:block;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px}
.sidebar ul{list-style:none;margin:0;padding:0}.sidebar li a{display:block;padding:4px 8px;border-radius:6px;color:var(--fg);font-size:14px}
.sidebar li a[aria-current=page]{background:var(--card);color:var(--accent);font-weight:600}
.content{min-width:0;padding:28px 40px}.doc{max-width:780px}
.toc{position:sticky;top:57px;align-self:start;padding:24px 16px;font-size:13px}.toc-title{color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin:0 0 8px}
.toc ul{list-style:none;margin:0;padding:0}.toc li{margin:3px 0}.toc .lvl-3{padding-left:12px}.toc a{color:var(--muted)}.toc a:hover{color:var(--accent)}
h1{font-size:2rem;margin:.2em 0 .6em}h2{font-size:1.4rem;margin:1.8em 0 .5em;padding-top:.2em;border-top:1px solid var(--line)}h3{font-size:1.15rem;margin:1.4em 0 .4em}
.crumb{color:var(--muted);font-size:13px;margin-bottom:8px}.crumb a{color:var(--muted)}
.lead{color:var(--muted);font-size:1.1rem}
code{background:var(--code-bg);padding:.15em .4em;border-radius:5px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.code{position:relative;margin:1em 0}.code pre{margin:0;background:var(--code-bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto}
.code pre code{background:none;padding:0}.code .copy{position:absolute;top:8px;right:8px;font-size:12px;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--muted);cursor:pointer;opacity:0;transition:.15s}
.code:hover .copy{opacity:1}.code .copy.ok{color:#16a34a;border-color:#16a34a}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{background:var(--card)}
.callout{border-left:3px solid var(--accent);background:var(--card);padding:10px 14px;border-radius:0 8px 8px 0;margin:1em 0}
.callout-warning,.callout-uyarı{border-left-color:#e0a800}.callout-tip,.callout-ipucu{border-left-color:#16a34a}
blockquote{border-left:3px solid var(--line);margin:1em 0;padding:2px 14px;color:var(--muted)}
.wikilink-broken{color:#c026d3;border-bottom:1px dashed #c026d3}
.pagelist{list-style:none;padding:0}.pagelist li{margin:4px 0}
.prevnext{display:flex;justify-content:space-between;gap:12px;margin:2.4em 0 1em;border-top:1px solid var(--line);padding-top:16px}
.pn{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.pn span{display:block;color:var(--muted);font-size:12px}.pn.next{text-align:right}
.page-foot{margin-top:2em;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:12px}
.landing{max-width:1080px;margin:0 auto;padding:32px 24px}.hero.big h1{font-size:2.6rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-top:24px}
.card{display:block;border:1px solid var(--line);border-radius:14px;padding:20px;background:var(--card);color:var(--fg)}
.card:hover{border-color:var(--accent);text-decoration:none;transform:translateY(-2px);transition:.15s}.card h3{margin:.1em 0 .4em}.card p{color:var(--muted);font-size:14px;margin:.2em 0 1em}
.badge{font-size:12px;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.card-ref{border-style:dashed}
.ref-card{border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:12px 0;background:var(--card)}.ref-meta{color:var(--muted);font-size:13px}
@media(max-width:1000px){.shell{grid-template-columns:240px 1fr}.toc{display:none}}
@media(max-width:720px){.shell{grid-template-columns:1fr}.sidebar{position:fixed;left:0;top:57px;bottom:0;width:80%;max-width:320px;z-index:30;transform:translateX(-100%);transition:.2s}
body.nav-open .sidebar{transform:none}.content{padding:20px}.menu-btn{display:inline-flex}}
.menu-btn{display:none;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;width:36px;height:36px;cursor:pointer}`;
}

export function renderAppJs(): string {
  return `(function(){
var root=document.body.getAttribute('data-root')||'';
// theme toggle
var tb=document.getElementById('theme');
if(tb)tb.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('help-theme',next);}catch(e){}});
// copy buttons
document.querySelectorAll('.code .copy').forEach(function(b){b.addEventListener('click',function(){var c=b.parentElement.querySelector('code');var t=c?c.innerText:'';try{navigator.clipboard.writeText(t);}catch(e){}b.textContent='Kopyalandı';b.classList.add('ok');setTimeout(function(){b.textContent='Kopyala';b.classList.remove('ok');},1200);});});
// search
var q=document.getElementById('q'),box=document.getElementById('results');
var IDX=(window.__HELP_INDEX__||[]);
function score(d,terms){var t=(d.title||'').toLowerCase(),s=(d.section||'').toLowerCase(),b=(d.text||'');var sc=0;terms.forEach(function(w){if(t.indexOf(w)>=0)sc+=5;if(s.indexOf(w)>=0)sc+=2;if(b.indexOf(w)>=0)sc+=1;});return sc;}
function run(){if(!q)return;var v=q.value.trim().toLowerCase();if(!v){box.hidden=true;box.innerHTML='';return;}var terms=v.split(/\\s+/);
var hits=IDX.map(function(d){return{d:d,s:score(d,terms)};}).filter(function(x){return x.s>0;}).sort(function(a,b){return b.s-a.s;}).slice(0,8);
if(!hits.length){box.hidden=false;box.innerHTML='<a>Sonuç yok</a>';return;}
box.innerHTML=hits.map(function(x){return '<a href="'+root+x.d.href+'"><div>'+x.d.title+'</div><div class="r-sec">'+(x.d.section||x.d.system)+'</div></a>';}).join('');box.hidden=false;}
if(q){q.addEventListener('input',run);q.addEventListener('focus',run);
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}if(e.key==='Escape'){box.hidden=true;q.blur();}});
document.addEventListener('click',function(e){if(box&&!box.contains(e.target)&&e.target!==q)box.hidden=true;});}
})();`;
}
