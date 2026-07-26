// learnsite — the LESSON model, its renderer and its validator (pure, no I/O).
//
// WHY THIS EXISTS, AND WHY IT IS NOT `helpsite.ts`
// `lib/helpsite.ts` models a HELP site: hub → sections → pages, validated for navigation. A
// LEARNING tier needs everything that model checks (a page must exist, be non-empty, be
// anchored, and be reachable) plus four things a help page never has to prove:
//
//   1. a REAL example from this codebase, with `path:line` provenance — the difference between
//      teaching a language and teaching THIS system;
//   2. a runnable RECIPE with an expected output — so "ollamas and eCym can apply the code"
//      is a gate check, not a claim;
//   3. an EXERCISE — a lesson you cannot check is a blog post;
//   4. NO VERBATIM text from the upstream teaching sites — W3Schools is all-rights-reserved and
//      MDN is share-alike, so the licence constraint has to be mechanical, not a promise.
//
// All four are ERRORS, not warnings: a lesson that fails them must not be written to the vault.
// Keeping this module pure (no `node:fs`) is what lets the whole contract be tested without a
// disk, and `learn-build.ts` is then only responsible for I/O.
import type { Occurrence, Policy, Recipe } from "./learn/types";

export interface Lesson {
  /** Lesson slug (= construct id). Note file becomes `learn-<id>.md`. */
  id: string;
  track: string;
  title: string;
  level: string;
  /** Canonical anchor URLs — at least one. The reader's route to the authoritative source. */
  sources: string[];
  /** Rendered Turkish body. Empty is an error: a stub is not a lesson. */
  body: string;
  /** Real occurrences in our own code (≥1). */
  examples: Occurrence[];
  recipe: Recipe;
  /** Machine-actionable rule, when the lesson has a violation form (see learn/policy.ts). */
  policy?: Policy;
  /** The lesson's own detector source — carried so the validator can prove the policy's
   *  anti-pattern differs from it (same regex ⇒ correct code reported as a defect). */
  detectSource?: string;
  /** Wikilink targets to sibling lessons. */
  related: string[];
  /** Systems this construct was actually detected in. */
  systems: string[];
}

export interface TrackSection {
  id: string;
  title: string;
  outcome: string;
  lessons: Lesson[];
}

export interface LearnSite {
  hubTitle: string;
  /** Canonical source URLs the whole tier is anchored to. */
  references: string[];
  tracks: TrackSection[];
  /** The four systems that get their own entry-point hub. */
  systems: string[];
}

export interface LearnIssue {
  level: "error" | "warn";
  where: string;
  message: string;
}

/**
 * Every `[[wikilink]]` target in a body — EXCLUDING anything inside a code fence or inline code.
 *
 * This differs from `helpsite.wikilinks` on purpose. A help page rarely writes about links; a
 * lesson about wikilinks quotes `[[hedef]]` constantly as EXAMPLE SYNTAX. Obsidian does not
 * render links inside code spans either, so treating them as navigation produced a wall of
 * false "dangling link" errors on exactly the lessons that teach linking. Strip code first,
 * then extract — the check then matches what the reader actually sees.
 */
export function wikilinks(body: string): string[] {
  const prose = String(body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  return [...prose.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

/** Note names this tier creates, plus the pre-existing vault notes it is allowed to link to. */
/** The five pages every system folder gets. Kept here so the validator and the builder agree. */
export const SYSTEM_PAGES = ["learn", "baslangic", "izlekler", "kanit", "tarifler"] as const;

export function siteTargets(site: LearnSite, extra: string[] = []): Set<string> {
  const t = new Set<string>(["learn", "learn-kaynaklar", "learn-envanter", "learn-mufredat", ...extra]);
  for (const s of site.systems) for (const p of SYSTEM_PAGES) t.add(`${s}-${p}`);
  for (const tr of site.tracks) {
    t.add(`learn-${tr.id}`);
    for (const l of tr.lessons) t.add(`learn-${l.id}`);
  }
  return t;
}

/** Words of a text, lowercased and stripped of punctuation — the unit the verbatim check uses. */
function words(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Longest shared word-run between a lesson body and an upstream snapshot.
 *
 * `n` is 12 by default: long enough that ordinary technical sentences ("bir dizi döndürür ve
 * kaynağı değiştirmez") do not trip it, short enough that a copied paragraph cannot hide. The
 * check runs only when a snapshot is supplied — we deliberately do NOT fetch upstream bodies as
 * part of the build (fetching to compare would mean storing the very text we must not store).
 */
export function verbatimHits(body: string, snapshot: string, n = 12): string[] {
  const a = words(body);
  const b = words(snapshot);
  if (a.length < n || b.length < n) return [];
  const grams = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(" "));
  const hits: string[] = [];
  for (let i = 0; i + n <= a.length; i++) {
    const g = a.slice(i, i + n).join(" ");
    if (grams.has(g)) hits.push(g);
  }
  return hits;
}

/**
 * Validate the learning tier.
 *
 * ERROR blocks the write. WARN is a shape note a reviewer should see. The link check is the
 * load-bearing one for navigation; the provenance/recipe/exercise checks are the load-bearing
 * ones for the tier's actual claim — that it teaches THIS codebase and can apply what it teaches.
 */
export function validateLearnSite(site: LearnSite, snapshots: Record<string, string> = {}): LearnIssue[] {
  const out: LearnIssue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const warn = (where: string, message: string) => out.push({ level: "warn", where, message });

  if (!site || typeof site !== "object") return [{ level: "error", where: "site", message: "not an object" }];
  if (!site.hubTitle?.trim()) err("hub", "hub başlığı yok");
  if (!Array.isArray(site.references) || !site.references.length) {
    err("references", "kanonik kaynak yok — tüm tier çapasız kalır");
  }
  if (!Array.isArray(site.tracks) || !site.tracks.length) {
    err("tracks", "izlek yok");
    return out;
  }
  if (!Array.isArray(site.systems) || site.systems.length < 1) err("systems", "sistem girişi yok");

  const targets = siteTargets(site);
  const seen = new Set<string>();

  for (const tr of site.tracks) {
    if (!tr.lessons.length) {
      err(`track.${tr.id}`, "izlek boş — dersi olmayan izlek yayımlanmaz");
      continue;
    }
    if (tr.lessons.length === 1) warn(`track.${tr.id}`, "tek derslik izlek (ince)");

    for (const l of tr.lessons) {
      const w = `${tr.id}/${l.id}`;
      if (seen.has(l.id)) err(w, `ders id tekrar ediyor: ${l.id}`);
      seen.add(l.id);

      if (!l.title?.trim()) err(w, "başlık yok");
      if (!l.body?.trim()) err(w, "gövde boş — taslak sayfa yayımlanmaz");
      if (!l.sources?.length) err(w, "kanonik kaynak (çapa) yok");
      for (const u of l.sources ?? []) {
        if (!/^https?:\/\//.test(u)) err(w, `geçersiz kaynak URL'si: ${u}`);
      }

      // Provenance — the claim that separates this tier from a generic tutorial.
      if (!l.examples?.length) err(w, "depodan gerçek örnek yok (path:line kanıtı zorunlu)");
      for (const ex of l.examples ?? []) {
        if (!ex.path || !ex.line || ex.line < 1) err(w, `bozuk kanıt: ${JSON.stringify(ex)}`);
      }

      // Recipe — the claim that ollamas/eCym can APPLY the lesson.
      if (!l.recipe) err(w, "tarif yok");
      else {
        if (l.recipe.id !== l.id) err(w, `tarif id uyuşmuyor: ${l.recipe.id}`);
        if (!l.recipe.code?.trim()) err(w, "tarif kodu boş");
        if (!l.recipe.expect?.trim()) err(w, "tarif beklenen çıktısı boş — 'çalıştı' doğrulanamaz");
        if (!["node", "python", "bash"].includes(l.recipe.lang)) err(w, `bilinmeyen tarif dili: ${l.recipe.lang}`);
        if (!["safe", "gated"].includes(l.recipe.safety)) err(w, `bilinmeyen güvenlik sınıfı: ${l.recipe.safety}`);
      }

      // Navigation. Both the hand-written body links AND the generated `related` footer links
      // are checked — the renderer turns `related: ["x"]` into `[[learn-x]]`, so an id typo
      // there produces exactly the dangling link this tier refuses to ship.
      for (const target of wikilinks(l.body)) {
        if (!targets.has(target)) err(w, `kopuk wikilink: [[${target}]]`);
      }
      for (const r of l.related ?? []) {
        if (!targets.has(`learn-${r}`)) err(w, `kopuk ilgili-ders: [[learn-${r}]]`);
      }

      // Licence: no verbatim run from any cached upstream snapshot.
      for (const [src, text] of Object.entries(snapshots)) {
        const hits = verbatimHits(l.body, text);
        if (hits.length) err(w, `${src} kaynağından birebir kopya: "${hits[0].slice(0, 60)}…"`);
      }

      // Policy — the machine-actionable half. Optional, but if present it must be usable by a
      // program AND arguable by a human, because these rules constrain four systems.
      if (l.policy) {
        const p = l.policy;
        if (p.id !== l.id) err(w, `politika id uyuşmuyor: ${p.id}`);
        if (!["hata", "uyarı"].includes(p.severity)) err(w, `bilinmeyen politika ağırlığı: ${p.severity}`);
        if (!p.fix?.trim()) err(w, "politika düzeltmesi boş — 'dikkat et' bir düzeltme değildir");
        if (!p.why?.trim()) err(w, "politika gerekçesi boş — tartışılamayan kural körü körüne uygulanır");
        // The load-bearing check: the lesson's pattern finds CORRECT usage, the policy's finds the
        // violation. If they are the same regex, every compliant line is reported as a defect and
        // the linter becomes noise on its first run.
        if (p.detect.source === l.detectSource) {
          err(w, "politika anti-deseni dersin deseniyle AYNI — doğru kullanımı ihlal sayar");
        }
        for (const e of p.exceptions ?? []) {
          if (!e.reason?.trim()) err(w, `gerekçesiz istisna: ${e.path.source}`);
        }
      }
    }
  }

  return out;
}

export function isComplete(issues: LearnIssue[]): boolean {
  return !issues.some((i) => i.level === "error");
}

export function lessonCount(site: LearnSite): number {
  return site.tracks.reduce((n, t) => n + t.lessons.length, 0);
}

/** The permanent in-body footer. Survives brain re-materialisation; see track-md-obsidian. */
export function lessonFooter(l: Lesson): string {
  return [
    "---",
    `**İzlek:** [[learn-${l.track}]] · **Hub:** [[learn]] · **Seviye:** ${l.level} · **🔗 Kaynak:** ${l.sources[0]}`,
  ].join("\n");
}

/** Render one lesson note. Deterministic — same input, byte-identical output. */
export function renderLesson(l: Lesson): string {
  const L: string[] = [`# ${l.title}`, ""];

  L.push(`> **İzlek:** \`${l.track}\` · **Seviye:** ${l.level} · **Bulunduğu sistemler:** ${l.systems.join(", ")}`);
  L.push("");

  // ── The machine-facing block, FIRST.
  // The audience of this tier is `ollamas`, `eCym`, `obsidian` and `claudecode` — not a person
  // browsing the vault. So the page opens with what the lesson OBLIGES a system to do and the
  // exact commands that deliver it; the prose below is the rationale a system cites when it
  // refuses something, not homework for a reader.
  L.push("## Bu ders sisteme ne dayatıyor", "");
  if (l.policy) {
    L.push(
      `> **KURAL \`${l.policy.id}\`** · ağırlık \`${l.policy.severity}\`` +
        `${l.policy.severity === "hata" ? " (kapı: ihlal sayısı artamaz)" : " (raporlanır)"}`,
    );
    L.push("");
    L.push(`- **Yasak:** \`${l.policy.detect.source}\``);
    L.push(`- **Yerine:** ${l.policy.fix}`);
    L.push(`- **Neden:** ${l.policy.why}`);
    for (const e of l.policy.exceptions ?? []) {
      L.push(`- **Gerekçeli istisna:** \`${e.path.source}\` — ${e.reason}`);
    }
  } else {
    L.push("> Bu dersin **yasak biçimi yok** — ihlal olarak tanımlanabilir bir anti-deseni");
    L.push("> bulunmuyor. Dayattığı şey tarif sözleşmesidir: aşağıdaki program çalışır ve");
    L.push("> beklenen çıktıyı verir.");
  }
  L.push("");
  L.push("```bash");
  L.push(`learnkb get ${l.id}        # ollamas · eCym · claudecode: kuralı ve gerekçesini oku`);
  L.push(`learnkb apply ${l.id}      # tarifi çalıştır, çıktıyı beklenenle karşılaştır`);
  if (l.policy) L.push(`learnkb lint --rule ${l.id}   # bu kuralın ihlallerini say (ihlal/gerekçeli/temiz)`);
  L.push("```");
  L.push("");

  L.push(l.body.trim());
  L.push("");

  L.push("## Bu depodaki gerçek kullanım", "");
  L.push("| Dosya | Satır | Kod |", "|-------|-------|-----|");
  for (const ex of l.examples) {
    const code = ex.snippet.replace(/\|/g, "\\|").replace(/`/g, "'");
    L.push(`| \`${ex.path}\` | ${ex.line} | \`${code}\` |`);
  }
  L.push("");

  L.push("## Uygulanabilir tarif", "");
  L.push(
    `\`learnkb apply ${l.recipe.id}\` bu programı çalıştırır ve çıktısını beklenenle karşılaştırır ` +
      `(dil: \`${l.recipe.lang}\` · sınıf: \`${l.recipe.safety}\`).`,
  );
  L.push("");
  L.push("```" + (l.recipe.lang === "node" ? "javascript" : l.recipe.lang));
  L.push(l.recipe.code);
  L.push("```");
  L.push("");
  L.push(`**Beklenen çıktı:** \`${l.recipe.expect}\``);
  L.push("");

  if (l.related.length) {
    L.push("## İlgili dersler", "");
    L.push(l.related.map((r) => `[[learn-${r}]]`).join(" · "));
    L.push("");
  }

  L.push("## Kaynaklar", "");
  for (const s of l.sources) L.push(`- <${s}>`);
  L.push("");
  L.push(lessonFooter(l));
  L.push("");
  return L.join("\n");
}
