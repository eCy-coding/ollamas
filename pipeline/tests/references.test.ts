import { describe, it, expect } from "vitest";
import { REFERENCES, TARGET_SPEC, renderReferencesMd, renderReferencesHtml } from "../lib/references";

describe("REFERENCES — the permanent canonical list", () => {
  it("names exactly the five sources the operator gave", () => {
    expect(REFERENCES).toHaveLength(5);
    const urls = REFERENCES.map((r) => r.url);
    for (const u of ["obsidian.md/help", "code.claude.com/docs", "support.claude.com", "claude.com/product/claude-code", "anthropic.com"]) {
      expect(urls.some((x) => x.includes(u))).toBe(true);
    }
  });

  it("every reference records at least one IA pattern and its observed sections", () => {
    for (const r of REFERENCES) {
      expect(r.iaPatterns.length).toBeGreaterThanOrEqual(1);
      expect(r.observedSections.length).toBeGreaterThanOrEqual(1);
      expect(["docs", "marketing", "kb"]).toContain(r.archetype);
    }
  });

  it("covers all three archetypes (docs + marketing + kb)", () => {
    const kinds = new Set(REFERENCES.map((r) => r.archetype));
    expect(kinds).toEqual(new Set(["docs", "marketing", "kb"]));
  });
});

describe("TARGET_SPEC — the feature contract, fully traceable", () => {
  it("has the 12 distilled features, each citing a real reference URL", () => {
    expect(TARGET_SPEC).toHaveLength(12);
    const known = new Set(REFERENCES.map((r) => r.url));
    for (const f of TARGET_SPEC) {
      expect(f.from.length).toBeGreaterThanOrEqual(1);
      for (const u of f.from) expect(known.has(u)).toBe(true); // no invented sources
    }
  });

  it("includes the load-bearing docs features", () => {
    const blob = TARGET_SPEC.map((f) => f.feature).join(" ").toLowerCase();
    for (const kw of ["kenar-çubuğu", "toc", "arama", "tema", "kod", "callout", "prev/next", "responsive", "llms.txt"]) {
      expect(blob).toContain(kw);
    }
  });
});

describe("renderReferencesMd", () => {
  const md = renderReferencesMd();
  it("lists every reference and the target-spec table, and is deterministic", () => {
    for (const r of REFERENCES) expect(md).toContain(r.url);
    expect(md).toContain("Hedef özellik sözleşmesi");
    expect(md).toContain("metni asla kopyalanmaz");
    expect(renderReferencesMd()).toBe(md); // no clock/random
  });
});

describe("renderReferencesHtml", () => {
  const html = renderReferencesHtml();
  it("emits an escaped fragment with the refs table and spec", () => {
    expect(html).toContain("<table");
    for (const r of REFERENCES) expect(html).toContain(r.url);
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain("<script"); // fragment carries no executable markup
  });
});
