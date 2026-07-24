// Help-site model + validation (pure) — an Obsidian help vault, built like obsidian.md/help.
//
// WHY THIS EXISTS
// The operator wants a user-facing HELP SITE (like claude.com/product, support.claude.com,
// and structurally like obsidian.md/help) for Claude, eCym and ollamas — not the raw
// technical KB that already exists as the cc-* notes. obsidian.md/help is itself an Obsidian
// Publish vault: a Home hub, section MOCs, leaf pages, wikilinks, and a graph. That is the
// exact information architecture modelled here.
//
// The model and its validator are pure so the interesting property — "is this a COMPLETE,
// navigable help site, or a folder of orphan notes?" — is checkable without touching disk. A
// help site whose sections are empty, whose links dangle, or which is not anchored to its
// canonical sources is not "done"; validateHelpSite makes those errors, not warnings.

export interface HelpPage {
  /** Vault-relative slug within the site, e.g. "getting-started/install". */
  slug: string;
  title: string;
  /** Rendered Markdown body. Empty body on a listed page is an error — a stub is not a page. */
  body: string;
  /** Canonical source URLs this page rests on (≥1 required; that is the anchor contract). */
  sources: string[];
}

export interface HelpSection {
  /** Section id, e.g. "getting-started". */
  id: string;
  title: string;
  /** One-line description shown on the hub. */
  summary: string;
  pages: HelpPage[];
}

export interface HelpSite {
  /** System this site documents. */
  system: "claude" | "ecym" | "obsidian" | "ollamas" | string;
  /** Hub (Home) note title, e.g. "Claude — Yardım". */
  hubTitle: string;
  /** Canonical reference URLs the whole site is anchored to. */
  references: string[];
  sections: HelpSection[];
}

export const REQUIRED_SECTIONS = ["getting-started", "guides", "reference", "troubleshooting"] as const;

export interface HelpIssue {
  level: "error" | "warn";
  where: string;
  message: string;
}

/** Every `[[wikilink]]` target in a body. */
export function wikilinks(body: string): string[] {
  return [...String(body ?? "").matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

/**
 * Validate a help site against the obsidian.md/help standard.
 *
 * ERRORS block "done": a missing required section, an empty listed page, a page with no
 * source anchor, a wikilink that resolves to no page or hub. WARNINGS are shape notes (a thin
 * section, a section with one page) that a reviewer should see but that do not fail the build.
 *
 * The link check is the load-bearing one: a help site is defined by navigation, and a
 * dangling `[[link]]` is the exact defect that turns a site into a pile of notes.
 */
export function validateHelpSite(site: HelpSite): HelpIssue[] {
  const out: HelpIssue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const warn = (where: string, message: string) => out.push({ level: "warn", where, message });

  if (!site || typeof site !== "object") return [{ level: "error", where: "site", message: "not an object" }];
  if (!site.hubTitle?.trim()) err("hub", "hub title missing");
  if (!Array.isArray(site.references) || !site.references.length) {
    err("references", "no canonical reference URLs — the whole site must be anchored");
  }
  if (!Array.isArray(site.sections) || !site.sections.length) {
    err("sections", "no sections");
    return out;
  }

  const sectionIds = new Set(site.sections.map((s) => s.id));
  for (const req of REQUIRED_SECTIONS) {
    if (!sectionIds.has(req)) err(`sections.${req}`, `required section '${req}' missing (obsidian.md/help standard)`);
  }

  // Buildable navigation targets: every section id and every page title/slug the hub can link.
  const targets = new Set<string>([site.hubTitle]);
  for (const s of site.sections) {
    targets.add(s.id);
    targets.add(s.title);
    for (const p of s.pages ?? []) {
      targets.add(p.slug);
      targets.add(p.title);
      targets.add(p.slug.split("/").pop() ?? p.slug);
    }
  }

  for (const s of site.sections) {
    if (!s.title?.trim()) err(`section ${s.id}`, "section title missing");
    if (!s.summary?.trim()) warn(`section ${s.id}`, "no summary (shown on hub)");
    if (!Array.isArray(s.pages) || !s.pages.length) {
      err(`section ${s.id}`, "empty section — a listed section with no page is a dead link");
      continue;
    }
    if (s.pages.length === 1) warn(`section ${s.id}`, "only one page");
    for (const p of s.pages) {
      const at = `${s.id}/${p.slug}`;
      if (!p.title?.trim()) err(at, "page title missing");
      if (!p.body?.trim()) err(at, "empty page — a stub is not a page");
      if (!Array.isArray(p.sources) || !p.sources.length) {
        err(at, "no source anchor — every help page must cite where it came from");
      }
      // A page too short to help is a stub with prose. 120 chars is ~2 sentences.
      if (p.body && p.body.replace(/\s+/g, " ").trim().length < 120) warn(at, "very thin page (<120 chars)");
      for (const link of wikilinks(p.body)) {
        if (!targets.has(link)) err(at, `dangling link [[${link}]] — resolves to no page or section`);
      }
    }
  }
  return out;
}

export const isComplete = (issues: HelpIssue[]): boolean => !issues.some((i) => i.level === "error");

export function pageCount(site: HelpSite): number {
  return (site.sections ?? []).reduce((n, s) => n + (s.pages?.length ?? 0), 0);
}

/**
 * The hub (Home) note — the obsidian.md/help "Home": title, a one-line intro, the anchor
 * list, then a section index that wikilinks every page. Deterministic so the same site always
 * renders the same hub (stable diffs, testable).
 */
export function renderHub(site: HelpSite): string {
  const L: string[] = [
    "---",
    `cssclasses: [brain, help-${site.system}]`,
    `tags: [moc, help/${site.system}]`,
    `aliases: [${site.hubTitle}]`,
    "---",
    "",
    `# ${site.hubTitle}`,
    "",
    `> [!info] ${site.system} yardım merkezi`,
    `> ${pageCount(site)} sayfa · ${site.sections.length} bölüm · kanonik kaynaklara çapalı.`,
    "",
    "## Kaynaklar",
    ...site.references.map((u) => `- ${u}`),
    "",
    "## Bölümler",
    "",
  ];
  for (const s of site.sections) {
    L.push(`### ${s.title}`, s.summary ? `> ${s.summary}` : "", "");
    for (const p of s.pages) L.push(`- [[${p.slug.split("/").pop()}|${p.title}]]`);
    L.push("");
  }
  return L.join("\n");
}

/** One leaf page: frontmatter + title + body + a source footer (the anchor that survives sync). */
export function renderPage(site: HelpSite, section: HelpSection, page: HelpPage): string {
  return [
    "---",
    `cssclasses: [brain, help-${site.system}]`,
    `tags: [help/${site.system}, help/${section.id}]`,
    `aliases: [${page.title}]`,
    "---",
    "",
    `# ${page.title}`,
    "",
    page.body.trim(),
    "",
    "---",
    `**Bölüm:** [[${site.hubTitle}]] · **🔗 Kaynak:** ${page.sources.join(" · ")}`,
    "",
  ].join("\n");
}

/** Human summary for the gate and the tab. */
export function renderReport(site: HelpSite, issues: HelpIssue[]): string[] {
  const errs = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  return [
    `${site.system}: ${site.sections.length} bölüm · ${pageCount(site)} sayfa · ${errs.length} hata · ${warns.length} uyarı`,
    ...errs.map((i) => `  HATA  ${i.where}: ${i.message}`),
    ...warns.slice(0, 8).map((i) => `  uyarı ${i.where}: ${i.message}`),
  ];
}
