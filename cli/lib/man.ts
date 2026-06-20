// Pure troff(7) man-page generator (v13) — zero-dep, no ronn / asciidoc / marked-man.
// Produces a man(1) page for `ollamas` from structured data; validated live with
// `mandoc -Tlint`. The generator is pure (data in → troff string out) so it is
// unit-testable; index.ts builds the ManPage from the command surface.

export interface ManItem {
  term: string;
  def: string;
}
export interface ManSection {
  heading: string;
  paragraphs?: string[]; // each → .PP <text>
  items?: ManItem[]; // each → .TP / .B term / def
}
export interface ManPage {
  name: string; // "ollamas"
  section: number; // 1
  version: string; // "13.0.0"
  date: string; // ISO date, e.g. "2026-06-20"
  tagline: string; // NAME one-liner
  synopsis: string; // SYNOPSIS args after the bold name
  sections: ManSection[]; // COMMANDS, ENVIRONMENT, OPTIONS, …
}

// Escape plain text for troff: a literal backslash becomes \e; a leading dot/apostrophe
// would be read as a request, so guard it with the \&  zero-width; hyphen → \- so it
// renders as a real hyphen-minus, not a soft hyphen (man convention).
export function troffEscape(s: string): string {
  const escaped = s.replace(/\\/g, "\\e").replace(/-/g, "\\-");
  return /^[.']/.test(escaped) ? "\\&" + escaped : escaped;
}

export function generateManPage(p: ManPage): string {
  const out: string[] = [];
  out.push(`.TH ${p.name.toUpperCase()} ${p.section} "${p.date}" "ollamas ${p.version}" "General Commands Manual"`);
  out.push(".SH NAME");
  out.push(`${troffEscape(p.name)} \\- ${troffEscape(p.tagline)}`);
  out.push(".SH SYNOPSIS");
  out.push(`.B ${troffEscape(p.name)}`);
  out.push(troffEscape(p.synopsis));
  for (const s of p.sections) {
    out.push(`.SH ${s.heading.toUpperCase()}`);
    // A .PP right after .SH is redundant (mandoc skips it) — only separate the 2nd+
    // paragraph. .TP is fine directly after .SH.
    let first = true;
    for (const para of s.paragraphs ?? []) {
      if (!first) out.push(".PP");
      out.push(troffEscape(para));
      first = false;
    }
    for (const it of s.items ?? []) {
      out.push(".TP");
      out.push(`.B ${troffEscape(it.term)}`);
      out.push(troffEscape(it.def));
    }
  }
  return out.join("\n") + "\n";
}
