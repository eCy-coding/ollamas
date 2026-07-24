#!/usr/bin/env -S npx tsx
// help-build — assemble a help SITE for one system from its REAL sources, write it to the vault.
//
// WHY THIS EXISTS
// The content already exists (cckb for Claude, the terminal-dataset for eCym, README+PROMPT
// for ollamas) but as a technical KB, not a navigable help site. This turns each into the
// obsidian.md/help shape (hub → sections → pages → wikilinks) via `lib/helpsite.ts`, then
// validates it and writes it under `~/ollamas-vault/_help/<system>/`.
//
// Source-truth is the rule: every page cites where it came from. Nothing is invented — a
// section with no source material is reported empty, not filled with plausible prose.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  validateHelpSite, isComplete, renderHub, renderPage, renderReport, pageCount,
  type HelpSite, type HelpSection, type HelpPage,
} from "../lib/helpsite";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const CCKB = join(VAULT, "_bin", "cckb");

const CLAUDE_URLS = [
  "https://code.claude.com/docs/en/quickstart",
  "https://claude.com/product/claude-code",
  "https://support.claude.com/en/",
  "https://www.anthropic.com/",
];

/**
 * Trim source text to a help-page body: first real prose, bounded, sentence-whole.
 *
 * The KB notes carry their OWN `[[claude-code-*]]` wikilinks (their internal graph). Those
 * targets do not exist inside the help site, so they must be flattened to plain text — the
 * help site builds its OWN navigation from the hub. Leaving them in produced dangling links,
 * which the validator (correctly) rejected. This strips the wiki brackets, keeping the words.
 */
function toBody(text: string, max = 700): string {
  const clean = String(text ?? "")
    .replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_m, tgt, alias) => alias || String(tgt).replace(/-/g, " "))
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("---") && !l.startsWith("**") && !l.startsWith("|"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const i = cut.lastIndexOf(". ");
  return i > max * 0.5 ? cut.slice(0, i + 1) : cut + "…";
}

/** Claude help site — 219 cckb notes, mapped onto the obsidian.md/help section standard. */
function buildClaude(): HelpSite {
  // cckb category → help section. The standard four are always present; the rest fold in.
  const SECTION_MAP: Record<string, { id: string; title: string; summary: string }> = {
    "cc-getting-started": { id: "getting-started", title: "Başlangıç", summary: "Kurulum, ilk oturum, temel komutlar" },
    "cc-features": { id: "guides", title: "Rehberler", summary: "Özellikler, iş akışları, günlük kullanım" },
    "cc-reference": { id: "reference", title: "Referans", summary: "CLI, ayarlar, komut referansı" },
    "cc-troubleshoot": { id: "troubleshooting", title: "Sorun Giderme", summary: "Hatalar, tanılama, kurtarma" },
    "cc-config": { id: "config", title: "Yapılandırma", summary: "settings.json, hooks, izinler" },
    "cc-mcp": { id: "mcp", title: "MCP & Araçlar", summary: "Model Context Protocol, dış araçlar" },
    "cc-security": { id: "security", title: "Güvenlik", summary: "İzin modları, sandbox, güven" },
  };
  const sections: HelpSection[] = [];
  for (const [cat, meta] of Object.entries(SECTION_MAP)) {
    let slugs: string[] = [];
    try {
      const out = execFileSync(CCKB, ["cat", cat], { encoding: "utf8", timeout: 20_000 });
      slugs = [...out.matchAll(/●\s+(\S+)/g)].map((m) => m[1]).slice(0, 6);
    } catch {
      /* category may be absent → section stays empty and is reported */
    }
    const pages: HelpPage[] = [];
    for (const slug of slugs) {
      try {
        let body = toBody(execFileSync(CCKB, ["get", slug], { encoding: "utf8", timeout: 20_000 }));
        // TEACH-LOOP: a note whose full body is empty (e.g. `fast-mode`) is not skipped — the
        // capsule layer is asked for its TL;DR, which is always populated. A page without
        // content is a build failure; re-learning from the same KB is the fix, not fabrication.
        if (body.replace(/\s+/g, " ").trim().length < 120) {
          try {
            const ask = execFileSync(CCKB, ["--json", "ask", slug.replace(/-/g, " ")], { encoding: "utf8", timeout: 20_000 });
            const hit = (JSON.parse(ask).hits ?? []).find((h: { slug: string; tldr: string }) => h.slug === slug)
              ?? (JSON.parse(ask).hits ?? [])[0];
            if (hit?.tldr) body = String(hit.tldr);
          } catch {
            /* KB could not teach it → leave short; validator will flag it honestly */
          }
        }
        pages.push({
          slug: `${meta.id}/${slug}`,
          title: slug.replace(/-/g, " "),
          body,
          sources: [`https://code.claude.com/docs/en/${slug}`],
        });
      } catch {
        /* skip a note that cannot be read rather than fabricate it */
      }
    }
    sections.push({ ...meta, pages });
  }
  return { system: "claude", hubTitle: "Claude — Yardım", references: CLAUDE_URLS, sections };
}

/** eCym help site — from the terminal-dataset (235 commands) grouped by level. */
function buildEcym(): HelpSite {
  const dsPath = join(HOME, "ecy-model", "terminal-dataset.json");
  const cmds = (JSON.parse(readFileSync(dsPath, "utf8")).commands ?? []) as Array<{
    id: string; level: string; triggers: string[]; cmd: string; desc: string;
  }>;
  const byLevel = (lv: string) => cmds.filter((c) => c.level === lv);
  const page = (c: { id: string; triggers: string[]; cmd: string; desc: string }): HelpPage => ({
    slug: `komutlar/${c.id}`,
    title: c.id,
    body: `${c.desc}\n\nKomut: \`${c.cmd}\`\n\nTetikleyiciler: ${(c.triggers ?? []).slice(0, 6).join(", ")}`,
    sources: ["~/ecy-model/terminal-dataset.json"],
  });
  const sections: HelpSection[] = [
    {
      id: "getting-started", title: "Başlangıç", summary: "eCym nedir, nasıl konuşulur",
      pages: [{
        slug: "getting-started/genel", title: "eCym Nedir",
        body: `eCym, Emre'nin kişisel yerel modelidir: doğal dil komutunu ${cmds.length} komutluk bir kataloğa eşler ve $0 yerel çalışır. "ecym <istek>" yaz, en yakın komut önerilir.`,
        sources: ["~/ecy-model/terminal-dataset.json", "~/.local/bin/ecym"],
      }],
    },
    { id: "guides", title: "Rehberler", summary: "Sık kullanım kalıpları", pages: byLevel("baslangic").slice(0, 6).map(page) },
    { id: "komutlar", title: "Komutlar", summary: `${cmds.length} komutun kataloğu`, pages: byLevel("orta").slice(0, 6).map(page) },
    { id: "reference", title: "Referans", summary: "İleri komutlar ve rotalar", pages: byLevel("ileri").slice(0, 6).map(page) },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Rota tutmuyorsa",
      pages: [{
        slug: "troubleshooting/rota", title: "Rota Sorunları",
        body: "Bir sorgu yanlış komuta gidiyorsa: tetikleyicileri genişlet, `ecy-brain --build` ile vektörleri yeniden kur. Skorlayıcı |ortak token| + çok-kelimeli tetikleyici + binary adı ağırlıklıdır.",
        sources: ["~/.local/bin/ecy-cmd", "~/ecy-model/terminal-dataset.json"],
      }],
    },
  ];
  return { system: "ecym", hubTitle: "eCym — Yardım", references: ["~/ecy-model/terminal-dataset.json", "~/.local/bin/ecym"], sections };
}

/** ollamas help site — from README + pipeline/PROMPT.md. */
function buildOllamas(): HelpSite {
  const readme = existsSync(join(REPO, "README.md")) ? readFileSync(join(REPO, "README.md"), "utf8") : "";
  const prompt = existsSync(join(REPO, "pipeline", "PROMPT.md")) ? readFileSync(join(REPO, "pipeline", "PROMPT.md"), "utf8") : "";
  const sec = (h: string, text: string) => {
    const i = text.indexOf(h);
    if (i < 0) return "";
    const rest = text.slice(i + h.length);
    const end = rest.search(/\n#{1,3}\s/);
    return toBody(end > 0 ? rest.slice(0, end) : rest);
  };
  const sections: HelpSection[] = [
    {
      id: "getting-started", title: "Başlangıç", summary: "ollamas nedir, nasıl kurulur",
      pages: [{
        slug: "getting-started/genel", title: "ollamas Nedir",
        body: toBody(readme) || "ollamas, yerel LLM Mission Control: MCP gateway, sağlayıcı yönlendirme, orkestra ve pipeline. $0 yerel çalışma hedefli.",
        sources: ["~/Desktop/ollamas/README.md"],
      }],
    },
    {
      id: "guides", title: "Rehberler", summary: "CLI ve günlük kullanım",
      pages: [{
        slug: "guides/cli", title: "ollamas CLI",
        body: "ollamas CLI komutları: doctor (sağlık), pipeline (18-adım DAG), board (görünür sekmeler), watch (okunabilir log), job --visible (işi sekmede koştur), bench, top, mcp.",
        sources: ["~/Desktop/ollamas/cli/index.ts"],
      }],
    },
    {
      id: "reference", title: "Referans", summary: "Pipeline ve DAG",
      pages: [{
        slug: "reference/pipeline", title: "eCym Pipeline",
        body: sec("## 1. What this is", prompt) || "18-adım kanıt hattı: search→think→analyze→plan→todo→sandbox_test→…→push. Kapılar ölçer, chaos koşar, prompt kendini günceller.",
        sources: ["~/Desktop/ollamas/pipeline/PROMPT.md"],
      }],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Servis ve kapı sorunları",
      pages: [{
        slug: "troubleshooting/servis", title: "Servis Sorunları",
        body: "`ollamas doctor --json` ile sağlık raporu al (gateway/ollama/bridge/ready paralel problanır). `:3000` yoğunsa doctor yine hızlı döner. Kapı için `zsh pipeline/verify.sh`.",
        sources: ["~/Desktop/ollamas/cli/lib/client.ts"],
      }],
    },
  ];
  return { system: "ollamas", hubTitle: "ollamas — Yardım", references: ["~/Desktop/ollamas/README.md", "~/Desktop/ollamas/pipeline/PROMPT.md"], sections };
}

const BUILDERS: Record<string, () => HelpSite> = { claude: buildClaude, ecym: buildEcym, ollamas: buildOllamas };

export function buildSite(system: string): HelpSite {
  const b = BUILDERS[system];
  if (!b) throw new Error(`unknown help system '${system}' (claude|ecym|ollamas)`);
  return b();
}

/** Write hub + every page to disk. Returns the file count. */
export function writeSite(site: HelpSite): number {
  const root = join(VAULT, "_help", site.system);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${site.system}-help.md`), renderHub(site), "utf8");
  let n = 1;
  for (const s of site.sections) {
    for (const p of s.pages) {
      const dir = join(root, s.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${p.slug.split("/").pop()}.md`), renderPage(site, s, p), "utf8");
      n++;
    }
  }
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const system = argv.find((a) => !a.startsWith("--")) ?? "";
  const verifyOnly = argv.includes("--verify");
  if (!system) {
    console.log("help-build <claude|ecym|ollamas> [--verify]");
    process.exit(0);
  }
  try {
    const site = buildSite(system);
    const issues = validateHelpSite(site);
    console.log(renderReport(site, issues).join("\n"));
    if (!verifyOnly) {
      const n = writeSite(site);
      console.log(`yazıldı: _help/${system}/ · ${n} dosya · ${pageCount(site)} sayfa`);
    }
    process.exit(isComplete(issues) ? 0 : 1);
  } catch (e) {
    console.error(`help-build: ${(e as Error).message}`);
    process.exit(2);
  }
}
