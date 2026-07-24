import { describe, it, expect } from "vitest";
import {
  validateHelpSite, isComplete, wikilinks, pageCount, renderHub, renderPage, renderReport,
  REQUIRED_SECTIONS, type HelpSite, type HelpSection,
} from "../lib/helpsite";

const page = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  title: slug.split("/").pop()!,
  body: "Bu sayfa yeterince uzun bir gövde taşıyor, en az iki cümle. İkinci cümle burada duruyor.",
  sources: ["https://code.claude.com/docs/en/quickstart"],
  ...over,
});

const section = (id: string, pages = 2): HelpSection => ({
  id,
  title: id,
  summary: `${id} özeti`,
  pages: Array.from({ length: pages }, (_, i) => page(`${id}/p${i}`)),
});

const site = (over: Partial<HelpSite> = {}): HelpSite => ({
  system: "claude",
  hubTitle: "Claude — Yardım",
  references: ["https://claude.com/product/claude-code"],
  sections: REQUIRED_SECTIONS.map((s) => section(s)),
  ...over,
});

describe("wikilinks", () => {
  it("extracts targets, ignoring aliases and anchors", () => {
    expect(wikilinks("bkz [[install]] ve [[guides|Rehberler]] ve [[ref#bölüm]]")).toEqual(["install", "guides", "ref"]);
    expect(wikilinks("")).toEqual([]);
  });
});

describe("validateHelpSite — completeness", () => {
  const errs = (s: HelpSite) => validateHelpSite(s).filter((i) => i.level === "error");

  it("accepts a well-formed site", () => {
    expect(isComplete(validateHelpSite(site()))).toBe(true);
  });

  it("requires the obsidian.md/help standard sections", () => {
    const missing = site({ sections: [section("getting-started"), section("guides")] });
    const keys = errs(missing).map((i) => i.where);
    expect(keys).toContain("sections.reference");
    expect(keys).toContain("sections.troubleshooting");
  });

  // The load-bearing check: a help site is navigation, and a dangling link is the defect that
  // turns it back into a pile of notes.
  it("rejects a dangling wikilink", () => {
    const s = site();
    s.sections[0].pages[0].body += " bkz [[bilinmeyen-sayfa]]";
    expect(errs(s).some((i) => i.message.includes("dangling link [[bilinmeyen-sayfa]]"))).toBe(true);
  });

  it("resolves a link to a real page slug, title, or section", () => {
    const s = site();
    s.sections[0].pages[0].body += " bkz [[p1]] ve [[guides]] ve [[Claude — Yardım]]";
    expect(isComplete(validateHelpSite(s))).toBe(true);
  });

  it("rejects an empty section as a dead link", () => {
    const s = site();
    s.sections[1].pages = [];
    expect(errs(s).some((i) => i.where === "section guides" && i.message.includes("dead link"))).toBe(true);
  });

  it("rejects an empty page body — a stub is not a page", () => {
    const s = site();
    s.sections[0].pages[0].body = "";
    expect(errs(s).some((i) => i.message.includes("stub is not a page"))).toBe(true);
  });

  it("requires a source anchor on every page", () => {
    const s = site();
    s.sections[0].pages[0].sources = [];
    expect(errs(s).some((i) => i.message.includes("no source anchor"))).toBe(true);
  });

  it("requires site-level references", () => {
    expect(errs(site({ references: [] })).some((i) => i.where === "references")).toBe(true);
  });

  // A thin page is a WARNING, not an error — it has real (if short) content and a source, so
  // the site is still complete. Thinness is a review note, not a build blocker.
  it("flags a thin page as a warning while the site stays complete", () => {
    const s = site();
    s.sections[0].pages[0].body = "kısa.";
    const issues = validateHelpSite(s);
    expect(issues.some((i) => i.level === "warn" && i.message.includes("thin"))).toBe(true);
    expect(isComplete(issues)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isComplete(validateHelpSite(null as never))).toBe(false);
  });
});

describe("pageCount", () => {
  it("sums pages across sections", () => {
    expect(pageCount(site())).toBe(REQUIRED_SECTIONS.length * 2);
  });
});

describe("renderHub", () => {
  const h = renderHub(site());

  it("is a MOC with the anchor list and a section index", () => {
    expect(h).toContain("# Claude — Yardım");
    expect(h).toContain("tags: [moc, help/claude]");
    expect(h).toContain("https://claude.com/product/claude-code");
    expect(h).toContain("## Bölümler");
  });

  it("wikilinks every page from the hub", () => {
    expect(h).toContain("[[p0|p0]]");
    expect(h.match(/\[\[/g)?.length).toBeGreaterThanOrEqual(pageCount(site()));
  });

  it("is deterministic", () => {
    expect(renderHub(site())).toBe(h);
  });
});

describe("renderPage", () => {
  it("carries a body and a source footer that survives sync", () => {
    const s = site();
    const out = renderPage(s, s.sections[0], s.sections[0].pages[0]);
    expect(out).toContain("# p0");
    expect(out).toContain("**Bölüm:** [[Claude — Yardım]]");
    expect(out).toContain("**🔗 Kaynak:** https://code.claude.com/docs/en/quickstart");
  });
});

describe("renderReport", () => {
  it("counts errors and warnings and lists errors first", () => {
    const s = site();
    s.sections[0].pages[0].body = "";
    const lines = renderReport(s, validateHelpSite(s));
    expect(lines[0]).toMatch(/claude: 4 bölüm · 8 sayfa · \d+ hata/);
    expect(lines.some((l) => l.includes("HATA"))).toBe(true);
  });
});
