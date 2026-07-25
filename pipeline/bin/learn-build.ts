#!/usr/bin/env -S npx tsx
// learn-build — assemble the LEARN tier from the code inventory and write it into the vault.
//
// WHY THIS EXISTS
// `learn-inventory.ts` proves which constructs this codebase uses. This program turns each
// proven construct into a lesson note, builds the navigation around them (hub, per-track MOCs,
// per-system entry points), emits the machine contract (`learn-recipes.json`) that ollamas and
// eCym consume, and refuses to write anything if `validateLearnSite` reports a single error.
//
// TWO STRUCTURAL DECISIONS WORTH KNOWING
//  1. ONE canonical note per construct, at `_learn/<track>/learn-<id>.md`. A construct detected
//     in three systems does NOT become three notes — this vault has already been burned by
//     byte-identical duplicate notes appearing under drifting slugs, and deleting notes is
//     forbidden here (only `_sandbox/` may be deleted). Deduplicate at write time, not later.
//  2. The four systems the operator named (`ollamas`, `eCym`, `obsidian`, `claudecode`) each get
//     their OWN folder and mini-site — hub, quickstart, evidence table, recipe list — built from
//     the occurrences detected in that system. They are entry points into the shared lesson
//     pool, which is why they carry navigation and evidence but never a copy of a lesson body.
//
// Everything written here is NEW: `_learn/**`, `_index/learn-*`. No pre-existing note, script or
// index is modified or removed by this program.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildInventory, inventoryJson, inventoryMd, type Inventory } from "./learn-inventory";
import { CURRICULUM, LEARN_SOURCES, LESSON_SPEC, renderLearnReferencesMd, sourceById, trackById } from "../lib/learnrefs";
import {
  isComplete, lessonCount, renderLesson, validateLearnSite,
  type Lesson, type LearnSite, type TrackSection,
} from "../lib/learnsite";
import { constructById } from "../lib/learn/index";
import { isTaught } from "../lib/learn/types";

const HOME = homedir();
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

/** The operator's four system names, in his order. `claudecode` is his spelling. */
const SYSTEMS = ["ollamas", "ecym", "obsidian", "claudecode"] as const;
const SYSTEM_TITLE: Record<string, string> = {
  ollamas: "ollamas",
  ecym: "eCym",
  obsidian: "obsidian",
  claudecode: "claudecode",
};

/**
 * Compose a lesson body from the authored fields.
 *
 * The order is fixed and is itself a teaching decision, borrowed from the reference curricula:
 * WHAT it is (MDN's job) → WHY IT IS LIKE THIS HERE (nothing upstream can tell you) → a
 * checkable EXERCISE (freeCodeCamp's shape). The reader always gets the general answer before
 * the local one, so the lesson is useful even outside this repo.
 */
function lessonBody(what: string, whyHere: string, exercise: string): string {
  return [
    "## Nedir",
    "",
    what,
    "",
    "## Bizde neden böyle yazılmış",
    "",
    whyHere,
    "",
    "## Alıştırma",
    "",
    exercise,
  ].join("\n");
}

/** Turn the proven inventory into the site model. */
export function buildSite(inv: Inventory): LearnSite {
  const tracks: TrackSection[] = [];
  // A `related` id may legitimately point at a construct this codebase does not (yet) use —
  // that construct has no lesson, so the link would dangle. Distinguish the two cases: an id
  // absent from the CATALOGUE is a typo and throws; an id present but untaught is filtered out.
  const taught = new Set(inv.entries.filter(isTaught).map((e) => e.construct.id));
  for (const t of CURRICULUM) {
    const entries = inv.entries.filter((e) => e.construct.track === t.id && isTaught(e));
    if (!entries.length) continue;
    const lessons: Lesson[] = entries
      .sort((a, b) => {
        const order = { temel: 0, orta: 1, ileri: 2 } as Record<string, number>;
        return (order[a.construct.level] ?? 9) - (order[b.construct.level] ?? 9) || a.construct.id.localeCompare(b.construct.id);
      })
      .map((e) => {
        const c = e.construct;
        for (const r of c.related ?? []) {
          if (!constructById(r)) throw new Error(`learn-build: '${c.id}' bilinmeyen ilgili-ders'e işaret ediyor: '${r}'`);
        }
        return {
          id: c.id,
          track: c.track,
          title: c.title,
          level: c.level,
          sources: [c.url ?? sourceById(c.source).url],
          body: lessonBody(c.what, c.whyHere, c.exercise),
          examples: e.examples,
          recipe: c.recipe,
          related: (c.related ?? []).filter((r) => taught.has(r)),
          systems: e.systems,
        };
      });
    tracks.push({ id: t.id, title: t.title, outcome: t.outcome, lessons });
  }
  return {
    hubTitle: "Kodlama Öğrenme Sistemi",
    references: LEARN_SOURCES.map((s) => s.url),
    tracks,
    systems: [...SYSTEMS],
  };
}

/* ------------------------------------------------------------------ navigation notes */

function renderHub(site: LearnSite, inv: Inventory): string {
  const L: string[] = [
    `# ${site.hubTitle}`,
    "",
    "> Bu tier, MDN Web Docs ve W3Schools başta olmak üzere on kaynağın **konu taksonomisi**",
    "> üzerine kurulmuş, ama **bu dört sistemin gerçek kodundan** öğreten bir ders kümesidir.",
    "> Her ders bir kanonik kaynağa çapalıdır, bir `dosya:satır` kanıtı taşır ve",
    "> `learnkb apply <id>` ile **çalıştırılabilir**.",
    "",
    `**${lessonCount(site)} ders · ${site.tracks.length} izlek · ${inv.filesScanned} taranan dosya · kapsama ${inv.entries.length}/${inv.entries.length + inv.unused.length}**`,
    "",
    "## Sistemler",
    "",
    "| Sistem | Giriş | Ne öğretir |",
    "|--------|-------|------------|",
  ];
  const blurb: Record<string, string> = {
    ollamas: "TypeScript sunucu, pipeline üreticileri, izin listesi ve HTTP uçları",
    ecym: "yerel Python araçları, komut kataloğu, kod-bilgi-tabanı enjeksiyonu",
    obsidian: "vault yüzeyleri: wikilink grafiği, Dataview, Canvas, .base, kapı betikleri",
    claudecode: "ajan katmanı: skill, slash komutu, hook, izin ve token bütçesi",
  };
  for (const s of site.systems) {
    L.push(`| ${SYSTEM_TITLE[s]} | [[${s}-learn]] | ${blurb[s]} |`);
  }

  L.push("", "## İzlekler", "", "| İzlek | Ders | Kazanım |", "|-------|------|---------|");
  for (const t of site.tracks) {
    L.push(`| [[learn-${t.id}]] | ${t.lessons.length} | ${t.outcome} |`);
  }

  L.push("", "## Nasıl kullanılır", "");
  L.push("```bash");
  L.push('learnkb ask "discriminated union"     # ~1 KB kapsül, AĞSIZ');
  L.push("learnkb get ts-union                  # tam ders");
  L.push("learnkb apply ts-union                # tarifi çalıştır, çıktıyı doğrula");
  L.push("learnkb map                           # izlek haritası");
  L.push("```");

  L.push("", "## Ders sözleşmesi", "");
  L.push("Her ders şunları karşılamak zorundadır (kapı denetler):", "");
  for (const r of LESSON_SPEC) L.push(`- **${r.id}** — ${r.requirement}`);

  L.push("", "---");
  L.push("**Kaynaklar:** [[learn-kaynaklar]] · **Envanter:** [[learn-envanter]] · **Yardım sitesi:** [[claude-code]]");
  L.push("");
  return L.join("\n");
}

function renderTrackMoc(t: TrackSection): string {
  const meta = trackById(t.id);
  const L: string[] = [
    `# ${t.title}`,
    "",
    `> **Kazanım:** ${t.outcome}`,
    `> **Kaynak çapaları:** ${meta.sources.map((s) => `[${sourceById(s).title}](${sourceById(s).url})`).join(" · ")}`,
    "",
    `${t.lessons.length} ders. Sıra: temel → orta → ileri.`,
    "",
    "| Ders | Seviye | Sistemler |",
    "|------|--------|-----------|",
  ];
  for (const l of t.lessons) {
    L.push(`| [[learn-${l.id}\\|${l.title}]] | ${l.level} | ${l.systems.join(", ")} |`);
  }
  L.push("", "## Dataview (canlı liste)", "");
  L.push("```dataview");
  L.push(`LIST FROM [[learn-${t.id}]]`);
  L.push("SORT file.name ASC");
  L.push("```");
  L.push("", "---", `**Hub:** [[learn]] · **Kaynaklar:** [[learn-kaynaklar]]`, "");
  return L.join("\n");
}

function renderSystemHub(system: string, site: LearnSite, inv: Inventory): string {
  const mine = inv.entries.filter((e) => e.systems.includes(system) && isTaught(e));
  const byTrack = new Map<string, typeof mine>();
  for (const e of mine) {
    const arr = byTrack.get(e.construct.track) ?? [];
    arr.push(e);
    byTrack.set(e.construct.track, arr);
  }
  const files = inv.bySystem[system] ?? 0;
  const L: string[] = [
    `# ${SYSTEM_TITLE[system]} — Kodlama Öğrenme Girişi`,
    "",
    `> \`${system}\` sisteminde taranan **${files} dosya** içinde kanıtlanmış **${mine.length} dil yapısı**.`,
    "> Dersler ortak havuzdadır (kopyalanmaz); bu sayfa o havuza bu sistemin kanıtıyla girer.",
    "",
    "## Bu sistemde hangi izlekler var",
    "",
    "| İzlek | Ders | En çok kullanılan |",
    "|-------|------|-------------------|",
  ];
  for (const t of site.tracks) {
    const list = byTrack.get(t.id);
    if (!list?.length) continue;
    const top = [...list].sort((a, b) => b.hits - a.hits)[0];
    L.push(`| [[learn-${t.id}]] | ${list.length} | [[learn-${top.construct.id}\\|${top.construct.id}]] (${top.hits}) |`);
  }

  L.push("", "## Kanıt tablosu — bu sistemdeki gerçek satırlar", "");
  L.push("| Ders | Bulgu | İlk kanıt |", "|------|-------|-----------|");
  for (const e of [...mine].sort((a, b) => b.hits - a.hits).slice(0, 40)) {
    const ex = e.examples.find((x) => x.path.startsWith(`${system}:`)) ?? e.examples[0];
    L.push(`| [[learn-${e.construct.id}]] | ${e.hits} | \`${ex.path}:${ex.line}\` |`);
  }
  if (mine.length > 40) L.push("", `> Tabloda ilk 40 gösteriliyor; tamamı [[learn-envanter]] içinde.`);

  L.push("", "## Bu sistemde uygulanabilir tarifler", "");
  L.push("```bash");
  for (const e of mine.slice(0, 5)) L.push(`learnkb apply ${e.construct.id}`);
  L.push("```");

  L.push("", "---", "**Hub:** [[learn]] · **Envanter:** [[learn-envanter]] · **Kaynaklar:** [[learn-kaynaklar]]", "");
  return L.join("\n");
}

/** The machine contract consumed by ollamas, eCym and the gate. */
export function recipesJson(site: LearnSite, stamp: string): string {
  const recipes = site.tracks.flatMap((t) =>
    t.lessons.map((l) => ({
      id: l.id,
      track: l.track,
      title: l.title,
      level: l.level,
      lang: l.recipe.lang,
      safety: l.recipe.safety,
      code: l.recipe.code,
      expect: l.recipe.expect,
      note: `_learn/${l.track}/learn-${l.id}.md`,
      source: l.sources[0],
      systems: l.systems,
    })),
  );
  return JSON.stringify(
    {
      generated: stamp,
      count: recipes.length,
      safe: recipes.filter((r) => r.safety === "safe").length,
      langs: [...new Set(recipes.map((r) => r.lang))].sort(),
      recipes,
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ main */

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--vault");
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");

  const inv = buildInventory();
  const site = buildSite(inv);
  const issues = validateLearnSite(site);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  console.log(`ders: ${lessonCount(site)} · izlek: ${site.tracks.length} · sistem: ${site.systems.length}`);
  console.log(`doğrulama: HATA=${errors.length} UYARI=${warns.length}`);
  for (const i of errors.slice(0, 20)) console.log(`  HATA  ${i.where}: ${i.message}`);
  for (const i of warns.slice(0, 10)) console.log(`  uyarı ${i.where}: ${i.message}`);

  if (!isComplete(issues)) {
    console.log("yazılmadı — doğrulama hatası (taslak/kopuk bağlantı/kanıtsız ders yayımlanmaz)");
    process.exitCode = 1;
    return;
  }
  if (!write) {
    console.log("(--vault verilmedi; hiçbir dosya yazılmadı)");
    return;
  }

  const root = join(VAULT, "_learn");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(VAULT, "_index"), { recursive: true });
  let n = 0;

  // 1. lessons — one canonical note per construct
  for (const t of site.tracks) {
    const dir = join(root, t.id);
    mkdirSync(dir, { recursive: true });
    for (const l of t.lessons) {
      writeFileSync(join(dir, `learn-${l.id}.md`), renderLesson(l), "utf8");
      n++;
    }
  }

  // 2. track MOCs (in _index, next to the existing cc-* MOCs)
  for (const t of site.tracks) {
    writeFileSync(join(VAULT, "_index", `learn-${t.id}.md`), renderTrackMoc(t), "utf8");
    n++;
  }

  // 3. per-system entry points — the four folders the operator named
  for (const s of site.systems) {
    const dir = join(root, s);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${s}-learn.md`), renderSystemHub(s, site, inv), "utf8");
    n++;
  }

  // 4. hub, sources, inventory
  writeFileSync(join(VAULT, "_index", "learn.md"), renderHub(site, inv), "utf8");
  writeFileSync(join(VAULT, "_index", "learn-kaynaklar.md"), renderLearnReferencesMd(), "utf8");
  writeFileSync(join(root, "REFERENCES.md"), renderLearnReferencesMd(), "utf8");
  writeFileSync(join(VAULT, "_index", "learn-envanter.md"), inventoryMd(inv, stamp), "utf8");
  writeFileSync(join(root, "INVENTORY.md"), inventoryMd(inv, stamp), "utf8");
  writeFileSync(join(VAULT, "_index", "learn-inventory.json"), inventoryJson(inv, stamp), "utf8");
  writeFileSync(join(VAULT, "_index", "learn-recipes.json"), recipesJson(site, stamp), "utf8");
  n += 7;

  console.log(`yazıldı: _learn/ + _index/learn-* · ${n} dosya`);
}

if (process.argv[1] && process.argv[1].includes("learn-build")) main();
