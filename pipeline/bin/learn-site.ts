#!/usr/bin/env -S npx tsx
// learn-site — render the learning tier as a real, coded, zero-dependency website.
//
// WHY THIS EXISTS
// `learn-build.ts` writes the Obsidian target (markdown notes). This is the OTHER target, built
// the same way the help tier already is: a browsable site with a landing card-grid, per-track
// docs, sidebar, on-this-page TOC, client-side search, theme toggle, copy-buttons and an
// `llms.txt` machine index — written to the committed `ollamas/web/learn/` and, with `--vault`,
// mirrored into `~/ollamas-vault/_learn/_web/`.
//
// WHY IT REUSES `lib/htmlsite.ts` INSTEAD OF A NEW RENDERER
// That module already solves the hard parts (wikilink resolution with a broken-link marker,
// heading anchors with Turkish folding, search index, `file://`-safe relative prefixes, dark
// mode). Writing a second renderer would mean maintaining two of every one of those decisions,
// and the second one would drift. The learn tier is therefore projected onto the `HelpSite`
// shape — one "system" per TRACK — and handed to `renderPortal`.
//
// The projection is lossy in exactly one direction: `renderPortal` brands the landing page for
// the help centre. Rather than fork the renderer, the three help-specific artefacts (landing
// hero, Kaynaklar page, llms.txt header) are rewritten afterwards from the learn data. Each
// rewrite is a single, named transform below — visible, not hidden inside a copy of the renderer.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildInventory } from "./learn-inventory";
import { buildSite } from "./learn-build";
import { curriculumStats } from "../lib/learn/curriculum";
import { renderPortal, type SiteFile } from "../lib/htmlsite";
import type { HelpSite } from "../lib/helpsite";
import { renderLesson, type LearnSite } from "../lib/learnsite";
import { CURRICULUM, LEARN_SOURCES } from "../lib/learnrefs";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

/** Level → section, so the site reads beginner→advanced like the reference curricula. */
const LEVEL_SECTIONS: Array<{ id: string; title: string; summary: string; level: string }> = [
  { id: "temel", title: "Temel", summary: "Buradan başla — günlük kodda en sık geçen yapılar.", level: "temel" },
  { id: "orta", title: "Orta", summary: "Desenler ve tuzaklar: doğru olan ile kolay olanın ayrıldığı yer.", level: "orta" },
  { id: "ileri", title: "İleri", summary: "Pahalı öğrenilmiş dersler — çoğu bu depoda bir hatadan doğdu.", level: "ileri" },
];

/**
 * Project the learn tier onto the help-site model: one HelpSite per track.
 *
 * CROSS-TRACK LINKS ARE PRE-RESOLVED, NOT HANDED TO THE RENDERER.
 * Each track becomes its own HelpSite, so each gets its own link map — and `[[learn-py-math-log]]`
 * written inside a `data` lesson would resolve against the wrong map and ship as a broken link
 * (measured: 471 of them on the first attempt). Since the site's file layout is fully determined
 * (`<track>/<level>/<id>.html`, always three levels deep), every lesson reference is rewritten
 * here into an ordinary relative markdown link before rendering. What the renderer then sees has
 * no wikilinks left at all, so `wikilink-broken` staying at 0 is a real signal.
 *
 * The Obsidian-only footer (hub/inventory/curriculum backlinks) is dropped: those notes are not
 * pages of this site, and the web page already prints its canonical sources in its own footer.
 */
export function toHelpSites(site: LearnSite): HelpSite[] {
  // Titles are inserted as ESCAPED TEXT (h1, <title>, sidebar, breadcrumb) — markdown is not
  // rendered there. A lesson called "Gömme (`![[...]]`)" therefore showed its backticks and its
  // brackets raw on four surfaces. Obsidian renders the same title as code, so the backticks stay
  // in the note and are stripped only here.
  const plainTitle = (s: string) => s.replace(/`/g, "");

  // lesson id → { href from a lesson page, title }
  const linkMap = new Map<string, { href: string; title: string }>();
  for (const t of site.tracks) {
    for (const l of t.lessons) linkMap.set(l.id, { href: `../../${t.id}/${l.level}/${l.id}.html`, title: plainTitle(l.title) });
  }
  const trackHref = (id: string) => `../../${id}/index.html`;

  const webBody = (l: (typeof site.tracks)[number]["lessons"][number]): string => {
    const md = renderLesson(l)
      .replace(/^# .*\n/, "")
      .replace(/\n---\n\*\*İzlek:\*\*[\s\S]*$/, "\n");
    return md
      .replace(/\[\[learn-([a-z0-9-]+)\]\]/g, (whole, id: string) => {
        const hit = linkMap.get(id);
        if (hit) return `[${hit.title}](${hit.href})`;
        if (site.tracks.some((t) => t.id === id)) return `[${id}](${trackHref(id)})`;
        return whole; // left visible on purpose: the gate counts it
      })
      .replace(/\[\[learn\]\]/g, "[Kodlama Öğrenme Sistemi](../../index.html)");
  };

  return site.tracks.map((t) => {
    const meta = CURRICULUM.find((c) => c.id === t.id);
    return {
      system: t.id,
      hubTitle: `${t.title} — Kodlama`,
      references: [...new Set(t.lessons.flatMap((l) => l.sources))].slice(0, 6),
      sections: LEVEL_SECTIONS.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.id === "temel" ? `${meta?.outcome ?? ""} ${s.summary}`.trim() : s.summary,
        pages: t.lessons
          .filter((l) => l.level === s.level)
          .map((l) => ({ slug: `${s.id}/${l.id}`, title: plainTitle(l.title), body: webBody(l), sources: l.sources })),
      })).filter((s) => s.pages.length > 0),
    };
  });
}

/* ─────────────────────────────────────────── learn-specific rewrites */

function landingHtml(site: LearnSite, lessons: number, cs: ReturnType<typeof curriculumStats>): string {
  const cards = site.tracks
    .map((t) => {
      const meta = CURRICULUM.find((c) => c.id === t.id);
      return (
        `<a class="card" href="${t.id}/index.html"><h2>${t.title}</h2>` +
        `<p>${meta?.outcome ?? ""}</p><span class="badge">${t.lessons.length} ders</span></a>`
      );
    })
    .join("");
  const refCard =
    `<a class="card card-ref" href="kaynaklar.html"><h2>Kaynaklar ve Müfredat</h2>` +
    `<p>${LEARN_SOURCES.length} kaynağın merdiveni ve ${cs.total} bölümlük müfredat yürüyüşü — her bölümün hesabı yazılı.</p>` +
    `<span class="badge">telif kuralı dahil</span></a>`;
  return (
    `<main class="landing"><div class="hero big"><h1>Kodlama Öğrenme Sistemi</h1>` +
    `<p class="lead">MDN → W3Schools → 9 kaynak taksonomisine çapalı, ${lessons} ders — hepsi bu dört sistemin ` +
    `gerçek kodundan, <code>dosya:satır</code> kanıtıyla ve çalıştırılabilir tariflerle.</p></div>` +
    `<div class="cards">${cards}${refCard}</div></main>`
  );
}

function sourcesHtml(cs: ReturnType<typeof curriculumStats>): string {
  const rows = LEARN_SOURCES.map(
    (s, i) =>
      `<tr><td>${i + 1}</td><td><a href="${s.url}" rel="noopener" target="_blank">${s.title}</a></td>` +
      `<td>${s.license}</td><td>${s.textPolicy === "taxonomy-only" ? "<strong>yalnız konu başlıkları</strong>" : s.textPolicy === "attribute-never-mirror" ? "atıf · aynalanmaz" : "yalnız bağlantı"}</td></tr>`,
  ).join("");
  return (
    `<p class="lead">Bu tier bu sayfaların <strong>konu taksonomisini</strong> ve kanonik bağlantısını kullanır; ` +
    `metnini ve örneklerini <strong>asla kopyalamaz</strong> — W3Schools tüm hakları saklı, MDN share-alike.</p>` +
    `<table class="ref-table"><thead><tr><th>#</th><th>Kaynak</th><th>Lisans</th><th>Metin politikası</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<h2 id="mufredat">Müfredat kapsaması</h2>` +
    `<p>Kaynakların <strong>${cs.total}</strong> bölümünün her birinin hesabı verildi: ` +
    `<strong>${cs.covered}</strong> ders · <strong>${cs["not-used-here"]}</strong> bu depoda kullanılmıyor · ` +
    `<strong>${cs.external}</strong> kapsam dışı. Hesabı verilmeyen bölüm: <strong>${cs.unaccounted.length}</strong>.</p>` +
    `<p>"%100" burada <em>her konuyu öğretiyoruz</em> demek değil — <strong>her konunun hesabını veriyoruz</strong> ` +
    `demektir. Kullanılmayan bir konu için ders yazmak taslak üretmek olurdu.</p>`
  );
}

/** Swap the help-branded artefacts for learn ones, keeping the chrome byte-identical. */
function rebrand(files: SiteFile[], site: LearnSite, lessons: number, cs: ReturnType<typeof curriculumStats>): SiteFile[] {
  return files.flatMap((f) => {
    if (f.path === "index.html") {
      const body = f.content.replace(/<main class="landing">[\s\S]*?<\/main>/, landingHtml(site, lessons, cs));
      return [{ path: f.path, content: body.replace(/<title>[^<]*<\/title>/, "<title>Kodlama Öğrenme Sistemi</title>") }];
    }
    if (f.path === "kaynaklar.html") {
      const body = f.content.replace(/<h1>Kaynaklar<\/h1>[\s\S]*?<\/article>/, `<h1>Kaynaklar ve Müfredat</h1>${sourcesHtml(cs)}</article>`);
      return [{ path: f.path, content: body }];
    }
    if (f.path === "llms.txt") {
      return [{ path: f.path, content: f.content.replace("# Yardım Merkezi — sayfa indeksi", "# Kodlama Öğrenme Sistemi — sayfa indeksi") }];
    }
    // The help tier's permanent markdown deliverables do not belong to this site; the learn
    // equivalents are written by learn-build.ts into the vault.
    if (f.path === "REFERENCES.md" || f.path === "GAPS.md") return [];
    return [f];
  });
}

/** Every page a site emits, plus a count of unresolved wikilinks (the gate reads this). */
export function buildFiles(): { files: SiteFile[]; broken: number; lessons: number } {
  const inv = buildInventory();
  const site = buildSite(inv);
  const cs = curriculumStats();
  const lessons = site.tracks.reduce((n, t) => n + t.lessons.length, 0);
  const files = rebrand(renderPortal(toHelpSites(site), {}), site, lessons, cs);
  const broken = files
    .filter((f) => f.path.endsWith(".html"))
    .reduce((n, f) => n + (f.content.match(/wikilink-broken/g)?.length ?? 0), 0);
  return { files, broken, lessons };
}

function writeAll(files: SiteFile[], root: string): number {
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, "utf8");
  }
  return files.length;
}

function main(): void {
  const toVault = process.argv.includes("--vault");
  const { files, broken, lessons } = buildFiles();

  const pages = files.filter((f) => f.path.endsWith(".html")).length;
  console.log(`ders: ${lessons} · sayfa: ${pages} · dosya: ${files.length} · kopuk wikilink: ${broken}`);
  if (broken > 0) {
    console.log("yazılmadı — kopuk wikilink var (site navigasyonla tanımlanır)");
    process.exitCode = 1;
    return;
  }

  const repoRoot = join(REPO, "web", "learn");
  console.log(`yazıldı: web/learn/ · ${writeAll(files, repoRoot)} dosya`);
  if (toVault) {
    const vaultRoot = join(VAULT, "_learn", "_web");
    console.log(`yazıldı: _learn/_web/ · ${writeAll(files, vaultRoot)} dosya`);
  }
}

if (process.argv[1] && process.argv[1].includes("learn-site")) main();
