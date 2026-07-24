#!/usr/bin/env -S npx tsx
// help-export — the reference sites' `.doc` deliverable, via pandoc.
//
// WHY THIS EXISTS
// The operator asked for a "help website AND .doc page" like the reference sites. The vault
// notes are the website; this produces the `.docx`. It concatenates a site's hub + every
// page into one document and runs pandoc — the tool is already installed, so no new
// dependency. The source-footer wikilinks are stripped for the docx (a Word reader has no
// vault to resolve them), but the source URLs are kept as plain text so the anchor survives.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

function pandocAvailable(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/** Collect a site's markdown (hub first, then each page) into one document string. */
function collect(system: string): string {
  const root = join(VAULT, "_help", system);
  const hub = join(root, `${system}-help.md`);
  if (!existsSync(hub)) throw new Error(`help sitesi yok: _help/${system}/ — önce help-build.ts ${system}`);

  const strip = (md: string) =>
    md
      .replace(/^---\n[\s\S]*?\n---\n/, "")          // drop frontmatter (meaningless in Word)
      .replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_m, t, a) => a || String(t).replace(/-/g, " ")); // flatten wikilinks

  const parts: string[] = [strip(readFileSync(hub, "utf8"))];
  for (const section of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = join(root, section.name);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      parts.push("\n\n---\n\n" + strip(readFileSync(join(dir, f), "utf8")));
    }
  }
  return parts.join("\n");
}

export function exportDocx(system: string): string {
  if (!pandocAvailable()) throw new Error("pandoc kurulu değil — brew install pandoc");
  const md = collect(system);
  const tmp = mkdtempSync(join(tmpdir(), "help-export-"));
  const src = join(tmp, `${system}.md`);
  writeFileSync(src, md, "utf8");
  const out = join(VAULT, "_help", system, `${system}-help.docx`);
  // `-yaml_metadata_block`: frontmatter is already stripped, but a page body can still open
  // with a line pandoc mistakes for YAML (a wikilink-flattened alias like `[eCym Nedir]`).
  // Disabling the YAML reader makes pandoc treat every `---` block as a horizontal rule, which
  // is what the docx should show anyway.
  execFileSync("pandoc", [src, "-f", "markdown-yaml_metadata_block", "-t", "docx", "-o", out, "--toc", "--metadata", `title=${system} — Yardım`], {
    timeout: 60_000,
  });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const system = process.argv[2] ?? "";
  if (!system) {
    console.log("help-export <claude|ecym|ollamas>");
    process.exit(0);
  }
  try {
    const out = exportDocx(system);
    const bytes = readFileSync(out).length;
    console.log(`.docx üretildi: _help/${system}/${system}-help.docx (${Math.round(bytes / 1024)} KB)`);
    process.exit(0);
  } catch (e) {
    console.error(`help-export: ${(e as Error).message}`);
    process.exit(1);
  }
}
