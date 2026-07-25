// htmllint — a zero-dep static a11y/perf linter over emitted HTML (closes 9.7 honestly). SESSION-B
// suggested this over Chrome Lighthouse: it keeps the offline / zero-dep / MISS≠PASS contract by
// checking the already-emitted `web/help/**.html` as plain strings — no browser, no network.
//
// PURE: `lintHtml(html)` returns issues; the bin walks the tree. Deterministic, unit-testable.
// Checks are the ones a static string can prove: lang, title, img alt, heading-skip, empty links,
// and a perf guard on oversized inline blobs. It errs toward silence on things a string can't know.

export interface A11yIssue {
  level: "error" | "warn";
  rule: string;
  detail: string;
}

/** Count real content inside an anchor: strip tags, whitespace. */
function anchorHasText(inner: string): boolean {
  return inner.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length > 0;
}

/** Lint one HTML document. `error` blocks; `warn` is advisory. Deterministic. */
export function lintHtml(html: string): A11yIssue[] {
  const out: A11yIssue[] = [];
  const s = String(html ?? "");
  const err = (rule: string, detail: string) => out.push({ level: "error", rule, detail });
  const warn = (rule: string, detail: string) => out.push({ level: "warn", rule, detail });

  // <html lang="…"> — required for screen readers.
  if (!/<html[^>]*\blang=/i.test(s)) err("html-lang", "<html> has no lang attribute");
  // <title> — required for a11y + SEO.
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(s)) err("title", "missing or empty <title>");
  // every <img> needs an alt attribute.
  for (const m of s.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=/i.test(m[0])) err("img-alt", `<img> without alt: ${m[0].slice(0, 60)}`);
  }
  // no heading-level skip (e.g. h1 → h3). Parse the heading sequence.
  const levels = [...s.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) { err("heading-skip", `heading jumps h${levels[i - 1]} → h${levels[i]}`); break; }
  }
  // anchors must have discernible text (or an aria-label).
  for (const m of s.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!anchorHasText(m[2]) && !/aria-label=/i.test(m[1])) { err("link-name", "empty <a> with no aria-label"); break; }
  }
  // perf guard: a single inline <script>/<style> over ~200KB bloats first paint.
  for (const m of s.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (m[2].length > 200_000) warn("inline-size", `${m[1]} inline blob ${Math.round(m[2].length / 1024)}KB (>200KB)`);
  }
  return out;
}

export const isClean = (issues: A11yIssue[]): boolean => !issues.some((i) => i.level === "error");

/** Human summary for one file. */
export function renderReport(name: string, issues: A11yIssue[]): string[] {
  const errs = issues.filter((i) => i.level === "error");
  return errs.length ? [`${name}: ${errs.length} a11y hata`, ...errs.map((i) => `  HATA  ${i.rule}: ${i.detail}`)] : [];
}
