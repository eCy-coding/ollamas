import { describe, it, expect } from "vitest";
import { generateManPage, troffEscape, type ManPage } from "../cli/lib/man";

describe("troffEscape", () => {
  it("escapes backslash → \\e", () => {
    expect(troffEscape("a\\b")).toBe("a\\eb");
  });
  it("escapes hyphen → \\- (real hyphen-minus); leading char becomes \\ so no \\& guard", () => {
    expect(troffEscape("--json")).toBe("\\-\\-json");
  });
  it("guards a leading dot/apostrophe with \\&", () => {
    expect(troffEscape(".hidden")).toBe("\\&.hidden");
    expect(troffEscape("'quote")).toBe("\\&'quote");
  });
});

describe("generateManPage", () => {
  const page: ManPage = {
    name: "ollamas",
    section: 1,
    version: "13.0.0",
    date: "2026-06-20",
    tagline: "LLM Mission Control CLI",
    synopsis: "[--gateway url] <command> [options]",
    sections: [
      { heading: "Commands", items: [{ term: "chat", def: "one-shot or REPL against the gateway" }] },
      { heading: "Notes", paragraphs: ["First paragraph.", "Second paragraph."] },
    ],
  };
  const out = generateManPage(page);

  it("emits a .TH header with name, section, version", () => {
    expect(out).toContain('.TH OLLAMAS 1 "2026-06-20" "ollamas 13.0.0"');
  });
  it("emits NAME with the \\- separator", () => {
    expect(out).toContain(".SH NAME");
    expect(out).toContain("ollamas \\- LLM Mission Control CLI");
  });
  it("emits SYNOPSIS with a bold name", () => {
    expect(out).toContain(".SH SYNOPSIS");
    expect(out).toContain(".B ollamas");
  });
  it("renders a command item as .TP/.B", () => {
    expect(out).toContain(".SH COMMANDS");
    expect(out).toContain(".TP");
    expect(out).toContain(".B chat");
  });
  it("separates 2nd+ paragraphs with .PP (none right after .SH)", () => {
    expect(out).toContain(".SH NOTES");
    expect(out).toContain(".PP"); // between the two paragraphs
    // no .PP immediately after the section header
    expect(out).not.toContain(".SH NOTES\n.PP");
  });
});
