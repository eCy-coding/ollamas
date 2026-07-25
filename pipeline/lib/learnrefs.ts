// learnrefs — the PERMANENT, ordered list of the teaching sources the LEARN tier is built against.
//
// WHY THIS EXISTS
// `lib/references.ts` names the five sources the HELP SITE borrows its information architecture
// from. This is its sibling for a different question: not "how should a docs site look" but
// "where does the authoritative explanation of a language construct live". The operator named
// the order — MDN Web Docs first, W3Schools second, then the rest of the top-10 teaching sites.
//
// THE LICENCE PROBLEM IS THE REASON THIS IS DATA AND NOT PROSE
// "Build MDN and W3Schools into Obsidian" reads as "mirror the pages". That is not buildable:
//   * MDN prose is CC-BY-SA 2.5+ — copyable WITH attribution, but share-alike is infectious and
//     a mirror rots the moment upstream edits.
//   * W3Schools content is ALL RIGHTS RESERVED. Copying its text or its examples is
//     infringement, not a stylistic choice.
// So each source below carries an explicit `textPolicy`, and the build reads it. What we take is
// the TAXONOMY (which topics exist, in which order) and the ANCHOR (the canonical URL a reader
// should click). Every sentence of every lesson is ours; every code example is lifted from OUR
// OWN repositories with `path:line` provenance. `pipeline/lib/learnsite.ts` enforces this: a
// lesson with no anchor, or with a ≥12-word n-gram shared with a cached upstream snapshot, is an
// ERROR, not a warning.
//
// The list is closed and ordered. Adding a source is a deliberate edit here, never an inline
// URL somewhere in a generator.

export type SourceKind = "reference" | "tutorial" | "curriculum" | "aggregator";

/** What the build is permitted to do with a source's TEXT. Read by the no-verbatim gate. */
export type TextPolicy =
  /** Attribution-licensed prose (CC-BY-SA). We still never mirror it — link + attribute. */
  | "attribute-never-mirror"
  /** All rights reserved. Taxonomy (topic names/order) only; zero text, zero examples. */
  | "taxonomy-only"
  /** Public docs we link to and paraphrase in our own words. */
  | "link-only";

export interface LearnSource {
  /** Stable id used in lesson `sources[]` and in the capsule index. */
  id: string;
  url: string;
  title: string;
  kind: SourceKind;
  license: string;
  textPolicy: TextPolicy;
  /** Why it is in the ladder — the concrete job it does for this build. */
  role: string;
  /** Top-level topic groups observed on the site. This is the part we are allowed to reuse. */
  taxonomy: string[];
  /** Tracks (see CURRICULUM) this source is the primary anchor for. */
  anchorsTracks: string[];
}

/** The teaching sources, in the operator's order. Closed list. */
export const LEARN_SOURCES: LearnSource[] = [
  {
    id: "mdn",
    url: "https://developer.mozilla.org/",
    title: "MDN Web Docs",
    kind: "reference",
    license: "CC-BY-SA 2.5+ (içerik)",
    textPolicy: "attribute-never-mirror",
    role: "Web platformunun otoritesi. Her web/JS dersinin 'daha derini burada' bağlantısı MDN'e gider; açıklamayı biz yazarız, doğruluğun son mercii MDN'dir.",
    taxonomy: [
      "HTML — yapı ve anlamsal etiketler",
      "CSS — düzen, kutu modeli, cascade",
      "JavaScript — dil, tipler, kapanışlar, async",
      "Web API'leri — DOM, fetch, Storage, Events",
      "HTTP — metodlar, durum kodları, başlıklar",
      "Erişilebilirlik ve performans",
    ],
    anchorsTracks: ["web", "js-ts", "http-api"],
  },
  {
    id: "w3schools",
    url: "https://www.w3schools.com/",
    title: "W3Schools",
    kind: "tutorial",
    license: "Tüm hakları saklı (© Refsnes Data)",
    textPolicy: "taxonomy-only",
    role: "Müfredat SIRALAMASININ kaynağı: hangi konu hangi konudan önce öğretilir. Konu başlıkları bir kapsama listesi olarak yürünür; metni ve örnekleri ASLA alınmaz (telif).",
    taxonomy: [
      "HTML Tutorial",
      "CSS Tutorial",
      "JavaScript Tutorial",
      "SQL Tutorial",
      "Python Tutorial",
      "Bash/Shell",
      "TypeScript",
      "Node.js",
      "JSON",
      "Git",
    ],
    anchorsTracks: ["web", "js-ts", "python", "shell", "data"],
  },
  {
    id: "freecodecamp",
    url: "https://www.freecodecamp.org/learn",
    title: "freeCodeCamp",
    kind: "curriculum",
    license: "BSD-3 (kod) / CC-BY-SA (müfredat)",
    textPolicy: "link-only",
    role: "Ders şekli: her konu 'anlat → alıştır → projede kullan' üçlüsüyle biter. Bizim ders şablonumuzdaki zorunlu 'Alıştırma' bölümü buradan gelir.",
    taxonomy: ["Responsive Web Design", "JavaScript Algorithms", "Front End Libraries", "Back End & APIs", "Relational Database"],
    anchorsTracks: ["web", "js-ts", "data"],
  },
  {
    id: "odin",
    url: "https://www.theodinproject.com/paths",
    title: "The Odin Project",
    kind: "curriculum",
    license: "CC-BY-NC-SA 4.0",
    textPolicy: "link-only",
    role: "Başlangıç→ileri yol sıralaması (kur → dil → araç → proje). Derslerin `level` alanı (temel/orta/ileri) bu sıralamaya göre atanır.",
    taxonomy: ["Foundations", "Full Stack JavaScript", "Ruby on Rails", "Intermediate HTML/CSS"],
    anchorsTracks: ["web", "js-ts", "shell"],
  },
  {
    id: "devdocs",
    url: "https://devdocs.io/",
    title: "DevDocs",
    kind: "aggregator",
    license: "MPL-2.0 (uygulama)",
    textPolicy: "link-only",
    role: "Tek arama kutusundan çok-yığın referans deseni — `learnkb ask`'in UX modeli budur: kaynak ne olursa olsun tek kapı, tek sözdizimi.",
    taxonomy: ["JavaScript", "TypeScript", "Node.js", "Python", "HTML", "CSS", "Bash", "SQLite"],
    anchorsTracks: ["js-ts", "python", "shell", "data"],
  },
  {
    id: "nodejs",
    url: "https://nodejs.org/docs/latest/api/",
    title: "Node.js API Docs",
    kind: "reference",
    license: "MIT (docs)",
    textPolicy: "link-only",
    role: "ollamas sunucusunun ve pipeline'ın koştuğu çalışma-zamanı. `node:fs`, `node:child_process`, `node:path` derslerinin çapası.",
    taxonomy: ["fs", "path", "child_process", "http", "os", "process", "test runner"],
    anchorsTracks: ["js-ts", "http-api"],
  },
  {
    id: "typescript",
    url: "https://www.typescriptlang.org/docs/handbook/",
    title: "TypeScript Handbook",
    kind: "reference",
    license: "Apache-2.0 (docs)",
    textPolicy: "link-only",
    role: "Tip sistemi dersleri: arayüz, union, generic, `as const`, tip-daraltma. Depomuzdaki her tip anotasyonunun çapası.",
    taxonomy: ["Everyday Types", "Narrowing", "Functions", "Object Types", "Generics", "Modules", "Type Manipulation"],
    anchorsTracks: ["js-ts"],
  },
  {
    id: "python",
    url: "https://docs.python.org/3/",
    title: "Python Docs",
    kind: "reference",
    license: "PSF License",
    textPolicy: "link-only",
    role: "Vault'un `_bin/*.py` katmanının çapası: dosya G/Ç, `json`, `re`, `argparse`, `subprocess`, `str.translate`.",
    taxonomy: ["Tutorial", "Library Reference", "Language Reference", "HOWTOs"],
    anchorsTracks: ["python"],
  },
  {
    id: "sqlite",
    url: "https://www.sqlite.org/docs.html",
    title: "SQLite Docs",
    kind: "reference",
    license: "Public Domain",
    textPolicy: "link-only",
    role: "`brain.db` veri katmanının çapası: şema, UPSERT, indeks, FTS.",
    taxonomy: ["SQL Syntax", "UPSERT", "Indexes", "FTS5", "JSON1"],
    anchorsTracks: ["data"],
  },
  {
    id: "obsidian-help",
    url: "https://obsidian.md/help/",
    title: "Obsidian Help",
    kind: "reference",
    license: "Obsidian docs (kapalı, link serbest)",
    textPolicy: "link-only",
    role: "Vault yüzeylerinin (wikilink, Dataview, Canvas, .base, graph) çapası. `lib/references.ts` içinde zaten kanonik — burada TEKRARLANMAZ, aynı URL ile atıf verilir.",
    taxonomy: ["Get started", "Editing and formatting", "Plugins", "Bases", "Canvas", "Publish"],
    anchorsTracks: ["md-obsidian"],
  },
  {
    id: "claude-code-docs",
    url: "https://code.claude.com/docs/en/quickstart",
    title: "Claude Code Docs",
    kind: "reference",
    license: "Anthropic docs (link serbest)",
    textPolicy: "link-only",
    role: "Ajan katmanının çapası: hook sözleşmeleri, skill/komut biçimi, MCP, izin modeli. Derinliği `cckb` kapsüllerinde — bu tier ona LİNK verir, kopyalamaz.",
    taxonomy: ["Getting Started", "Guides", "Reference", "Troubleshooting"],
    anchorsTracks: ["agents"],
  },
];

/** A curriculum track — the spine that lessons hang from. Derived from what our code uses. */
export interface Track {
  id: string;
  title: string;
  /** One line: what a reader can do after finishing this track. */
  outcome: string;
  /** Where in OUR repos the ground truth for this track lives (globs, informational). */
  codeRoots: string[];
  /** Source ids that anchor this track, most authoritative first. */
  sources: string[];
}

export const CURRICULUM: Track[] = [
  {
    id: "js-ts",
    title: "JavaScript & TypeScript",
    outcome: "Depodaki tip tanımlarını, saf modülleri ve async akışları okuyup aynı desende yenisini yazabilmek.",
    codeRoots: ["pipeline/lib/*.ts", "pipeline/bin/*.ts", "server/*.ts", "cli/**/*.ts"],
    sources: ["typescript", "mdn", "nodejs", "w3schools"],
  },
  {
    id: "web",
    title: "Web (HTML · CSS · DOM)",
    outcome: "Sıfır-bağımlı, file:// altında çalışan bir sayfayı okumak ve üretmek.",
    codeRoots: ["web/**", "pipeline/lib/htmlsite.ts", "_bin/claude-code-dashboard.html"],
    sources: ["mdn", "w3schools", "freecodecamp"],
  },
  {
    id: "python",
    title: "Python (vault araçları)",
    outcome: "`_bin/*.py` araçlarını okumak, deterministik bir metin/indeks aracı yazmak.",
    codeRoots: ["_bin/*.py"],
    sources: ["python", "w3schools", "devdocs"],
  },
  {
    id: "shell",
    title: "Shell & otomasyon",
    outcome: "Zarif-degrade eden bir kapı betiği ve bir launchd görevi yazmak.",
    codeRoots: ["_bin/*.sh", "*.plist"],
    sources: ["w3schools", "odin", "devdocs"],
  },
  {
    id: "data",
    title: "Veri (JSON · SQL · vektör)",
    outcome: "JSON indeksi tasarlamak, UPSERT semantiğini ve gömme (embedding) akışını anlamak.",
    codeRoots: ["_index/*.json", "~/ecy-model/*.json", "brain.db"],
    sources: ["sqlite", "w3schools", "devdocs"],
  },
  {
    id: "md-obsidian",
    title: "Markdown & Obsidian yüzeyleri",
    outcome: "Wikilink grafiği, Dataview MOC, Canvas ve .base üretmek; uygulama-otoriter dosyaları bozmadan yazmak.",
    codeRoots: ["_index/*.md", "*.canvas", "_index/*.base"],
    sources: ["obsidian-help", "mdn"],
  },
  {
    id: "http-api",
    title: "HTTP & API",
    outcome: "REST uç noktası okumak/çağırmak, hata ve hız-sınırı davranışını doğru yorumlamak.",
    codeRoots: ["server/*.ts", "server/openapi.ts"],
    sources: ["mdn", "nodejs", "w3schools"],
  },
  {
    id: "agents",
    title: "Ajan katmanı (Claude Code · eCym · ollamas)",
    outcome: "Hook/skill/komut sözleşmesi yazmak; kapsül-önce erişimle token bütçesini korumak.",
    codeRoots: [".claude/**", "_bin/cckb", "~/.local/bin/ecy-*"],
    sources: ["claude-code-docs", "devdocs"],
  },
];

/**
 * The contract EVERY lesson must satisfy. This is the learn-tier analogue of `TARGET_SPEC` in
 * references.ts: each requirement points at the source that justifies it, so nothing is invented.
 * `lib/learnsite.ts` turns each row into a validator rule.
 */
export const LESSON_SPEC: Array<{ id: string; requirement: string; from: string[] }> = [
  { id: "anchor", requirement: "En az bir kanonik kaynak URL'si (çapa) — açıklamanın son mercii", from: ["mdn", "typescript"] },
  { id: "own-prose", requirement: "Açıklama tamamen kendi cümlelerimizle; hiçbir kaynaktan metin kopyalanmaz", from: ["w3schools", "mdn"] },
  { id: "real-example", requirement: "Örnek kod KENDİ depomuzdan, `path:line` kanıtıyla — uydurma snippet yok", from: ["odin", "freecodecamp"] },
  { id: "why-here", requirement: "'Bizde neden böyle yazılmış' paragrafı — desenin bu depodaki gerekçesi", from: ["odin"] },
  { id: "recipe", requirement: "Uygulanabilir tarif: id · komut · doğrulama · geri-alma · safe|gated", from: ["devdocs"] },
  { id: "exercise", requirement: "En az bir alıştırma, kontrol edilebilir bir iddia ile", from: ["freecodecamp"] },
  { id: "level", requirement: "Seviye etiketi (temel · orta · ileri) — başlangıç→ileri sıralama", from: ["odin", "w3schools"] },
  { id: "graph", requirement: "Gövde-içi footer: track MOC + hub + kaynak (brain re-materialize'e dayanıklı)", from: ["obsidian-help"] },
];

const KIND_TR: Record<SourceKind, string> = {
  reference: "referans",
  tutorial: "öğretici",
  curriculum: "müfredat",
  aggregator: "toplayıcı",
};

const POLICY_TR: Record<TextPolicy, string> = {
  "attribute-never-mirror": "atıf zorunlu · **aynalanmaz**",
  "taxonomy-only": "**yalnız konu başlıkları** · metin/örnek ALINMAZ",
  "link-only": "yalnız bağlantı + kendi cümlelerimiz",
};

/** Look up a source by id; throws on unknown id so a typo fails the build, not the reader. */
export function sourceById(id: string): LearnSource {
  const s = LEARN_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`learnrefs: unknown source id '${id}'`);
  return s;
}

/** Look up a track by id; throws on unknown id. */
export function trackById(id: string): Track {
  const t = CURRICULUM.find((x) => x.id === id);
  if (!t) throw new Error(`learnrefs: unknown track id '${id}'`);
  return t;
}

/**
 * The permanent, committed `_learn/REFERENCES.md`. Deterministic (no clock, no random) so the
 * file only changes when the data changes — a diff means someone edited the ladder.
 */
export function renderLearnReferencesMd(): string {
  const L: string[] = [
    "# Kodlama Kaynakları — Learn tier'ın referans merdiveni",
    "",
    "> Bu liste **kalıcı ve sıralıdır** (Emre'nin verdiği sıra: MDN → W3Schools → diğerleri).",
    "> Bu tier kaynakların **konu taksonomisini** ve **kanonik bağlantısını** kullanır;",
    "> **metni ve örnekleri asla kopyalamaz**. Gerekçe iki katmanlı: **telif** (W3Schools tüm",
    "> hakları saklı, MDN CC-BY-SA/share-alike) ve **bayatlama** (kopya, kaynak güncellendiğinde",
    "> sessizce yanlışa döner). Her dersin örnek kodu **kendi depomuzdan** `path:line` kanıtıyla gelir.",
    "",
    "## Referans merdiveni",
    "",
    "| # | Kaynak | Tür | Lisans | Metin politikası |",
    "|---|--------|-----|--------|------------------|",
  ];
  LEARN_SOURCES.forEach((s, i) => {
    L.push(`| ${i + 1} | [${s.title}](${s.url}) | ${KIND_TR[s.kind]} | ${s.license} | ${POLICY_TR[s.textPolicy]} |`);
  });

  L.push("", "## Her kaynağın rolü ve alınan taksonomi", "");
  for (const s of LEARN_SOURCES) {
    L.push(`### ${s.title}`, `<${s.url}> · **tür:** ${KIND_TR[s.kind]} · **politika:** ${POLICY_TR[s.textPolicy]}`, "");
    L.push(s.role, "");
    L.push(`- **Konu başlıkları:** ${s.taxonomy.join(" · ")}`);
    L.push(`- **Çapaladığı izlekler:** ${s.anchorsTracks.map((t) => `\`${t}\``).join(", ")}`);
    L.push("");
  }

  L.push("## İzlekler (müfredat omurgası)", "");
  L.push("| İzlek | Başlık | Kazanım | Kaynak |", "|-------|--------|---------|--------|");
  for (const t of CURRICULUM) {
    L.push(`| \`${t.id}\` | ${t.title} | ${t.outcome} | ${t.sources.map((s) => sourceById(s).title).join(", ")} |`);
  }

  L.push("", "## Ders sözleşmesi (her ders bunu karşılamak ZORUNDA)", "");
  L.push("| # | Kural | Gerekçe kaynağı |", "|---|-------|-----------------|");
  LESSON_SPEC.forEach((r, i) => {
    L.push(`| ${i + 1} | ${r.requirement} | ${r.from.map((f) => sourceById(f).title).join(", ")} |`);
  });
  L.push("");
  L.push("---");
  L.push("**Hub:** [[learn]] · **Yardım sitesi kaynakları:** [[REFERENCES]]");
  L.push("");
  return L.join("\n");
}
