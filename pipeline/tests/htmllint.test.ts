import { describe, it, expect } from "vitest";
import { lintHtml, isClean, renderReport } from "../lib/htmllint";

const good = `<!doctype html><html lang="tr"><head><title>X</title></head><body>
<h1>A</h1><h2>B</h2><h3>C</h3><a href="/x">link</a><img src="a" alt="pic"></body></html>`;

describe("lintHtml", () => {
  it("passes a well-formed page", () => {
    expect(isClean(lintHtml(good))).toBe(true);
    expect(lintHtml(good).filter((i) => i.level === "error")).toEqual([]);
  });
  it("flags missing lang and title", () => {
    const r = lintHtml("<html><head></head><body><h1>x</h1></body></html>");
    expect(r.some((i) => i.rule === "html-lang")).toBe(true);
    expect(r.some((i) => i.rule === "title")).toBe(true);
  });
  it("flags an img without alt", () => {
    expect(lintHtml(`<html lang="tr"><title>t</title><img src="a">`).some((i) => i.rule === "img-alt")).toBe(true);
  });
  it("flags a heading-level skip (h1 → h3)", () => {
    expect(lintHtml(`<html lang="tr"><title>t</title><h1>a</h1><h3>b</h3>`).some((i) => i.rule === "heading-skip")).toBe(true);
  });
  it("flags an empty anchor with no aria-label, allows aria-label", () => {
    expect(lintHtml(`<html lang="tr"><title>t</title><a href="/x"></a>`).some((i) => i.rule === "link-name")).toBe(true);
    expect(lintHtml(`<html lang="tr"><title>t</title><a href="/x" aria-label="go"></a>`).some((i) => i.rule === "link-name")).toBe(false);
  });
  it("warns on an oversized inline blob (perf), not an error", () => {
    const big = `<html lang="tr"><title>t</title><style>${"x".repeat(200_001)}</style>`;
    const r = lintHtml(big);
    expect(r.some((i) => i.level === "warn" && i.rule === "inline-size")).toBe(true);
    expect(isClean(r)).toBe(true);
  });
  it("handles empty/nullish input", () => {
    expect(lintHtml(null as never).some((i) => i.rule === "html-lang")).toBe(true);
  });
});

describe("renderReport", () => {
  it("lists errors, empty when clean", () => {
    expect(renderReport("x.html", lintHtml(good))).toEqual([]);
    expect(renderReport("x.html", lintHtml("<html><body></body></html>"))[0]).toMatch(/a11y hata/);
  });
});
