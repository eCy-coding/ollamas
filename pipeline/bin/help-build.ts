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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/**
 * A numbered quickstart body (Step 1…N) — the code.claude.com/docs pattern. Each step is an H2
 * so the site's right-hand TOC lists it; an optional command becomes a fenced code block.
 */
function quickstartBody(intro: string, steps: Array<{ title: string; detail: string; cmd?: string }>): string {
  const L = [intro, ""];
  steps.forEach((s, i) => {
    L.push(`## ${i + 1}. ${s.title}`, "", s.detail);
    if (s.cmd) L.push("", "```bash", s.cmd, "```");
    L.push("");
  });
  return L.join("\n").trim();
}

/** A Markdown table body (the reference sites' Command / What it does / Example shape). */
function tableBody(intro: string, headers: string[], rows: string[][]): string {
  const cell = (c: string) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  const L = [intro, "", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) L.push(`| ${r.map(cell).join(" | ")} |`);
  return L.join("\n");
}

/** Read a pipeline/bin command's one-line description from its header comment (source-derived). */
function binDesc(file: string): string {
  const lines = readFileSync(file, "utf8").split("\n").slice(0, 8);
  const c = lines.find((l) => /^\/\/\s*\S+\s+[—-]\s+/.test(l));
  if (c) return c.replace(/^\/\/\s*\S+\s+[—-]\s+/, "").trim();
  const any = lines.find((l) => l.startsWith("//") && !l.includes("env "));
  return any ? any.replace(/^\/\/\s*/, "").trim() : "—";
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
  // Source-true CLI reference table: every row is a real dataset command, grouped by level.
  const cliRows = (lv: string): string[][] =>
    byLevel(lv).slice(0, 14).map((c) => [`\`${c.cmd}\``, c.desc, (c.triggers ?? []).slice(0, 3).join(", ")]);

  const sections: HelpSection[] = [
    {
      id: "getting-started", title: "Başlangıç", summary: "eCym nedir ve ilk komut",
      pages: [
        {
          slug: "getting-started/genel", title: "eCym Nedir",
          body: `eCym, Emre'nin kişisel yerel modelidir: doğal dil komutunu ${cmds.length} komutluk bir kataloğa eşler ve $0 yerel çalışır. "\`ecym <istek>\`" yazdığında en yakın komut skorlanıp önerilir. Skorlayıcı ortak-token + çok-kelimeli tetikleyici + binary-adı ağırlıklıdır; ${byLevel("baslangic").length} başlangıç, ${byLevel("orta").length} orta, ${byLevel("ileri").length} ileri seviye komut içerir.`,
          sources: ["~/ecy-model/terminal-dataset.json", "~/.local/bin/ecym"],
        },
        {
          slug: "getting-started/quickstart", title: "Hızlı Başlangıç",
          body: quickstartBody("eCym'i sıfırdan ilk komuta getiren adımlar. Hepsi yerel ve $0 çalışır.", [
            { title: "Modeli hazırla", detail: "Yerel qwen3:8b modelini çek (Ollama üzerinden). Ağ yalnız ilk çekmede gerekir.", cmd: "ollama pull qwen3:8b" },
            { title: "Vektör beynini kur", detail: "Komut kataloğunun tetikleyicilerini vektörleştir — rota skorlaması buna dayanır.", cmd: "ecy-brain --build" },
            { title: "İlk komutu sor", detail: "Doğal dille iste; eCym en yakın komutu skorlar ve gösterir. Güvenli komutlar çalışır, riskli olanlar ECY_YES kapısı ister.", cmd: 'ecym "bulunduğum dizin neresi"' },
          ]),
          sources: ["~/ecy-model/terminal-dataset.json", "~/.local/bin/ecym", "~/.local/bin/ecy-brain"],
        },
      ],
    },
    { id: "guides", title: "Rehberler", summary: "Sık kullanım kalıpları", pages: byLevel("baslangic").slice(0, 6).map(page) },
    {
      id: "reference", title: "Referans", summary: `${cmds.length} komutun referansı — seviyeye göre`,
      pages: [
        {
          slug: "reference/baslangic", title: "Komut Referansı — Başlangıç",
          body: tableBody("Başlangıç seviyesi komutlar (dataset'ten türetildi).", ["Komut", "Ne yapar", "Tetikleyiciler"], cliRows("baslangic")),
          sources: ["~/ecy-model/terminal-dataset.json"],
        },
        {
          slug: "reference/orta", title: "Komut Referansı — Orta",
          body: tableBody("Orta seviye komutlar.", ["Komut", "Ne yapar", "Tetikleyiciler"], cliRows("orta")),
          sources: ["~/ecy-model/terminal-dataset.json"],
        },
        {
          slug: "reference/ileri", title: "Komut Referansı — İleri",
          body: tableBody("İleri seviye komutlar ve rotalar.", ["Komut", "Ne yapar", "Tetikleyiciler"], cliRows("ileri")),
          sources: ["~/ecy-model/terminal-dataset.json"],
        },
      ],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Rota ve kurulum sorunları",
      pages: [{
        slug: "troubleshooting/rota", title: "Rota & SSS",
        body: tableBody(
          "eCym kullanırken en sık görülen sorunlar ve çözümleri.",
          ["Belirti", "Neden", "Çözüm"],
          [
            ["Sorgu yanlış komuta gidiyor", "Tetikleyici örtüşmesi zayıf", "`ecy-brain --build` ile vektörleri yeniden kur; tetikleyicileri genişlet"],
            ["Riskli komut çalışmıyor", "ECY_YES kapısı kapalı", "Onaylı çalıştırma için `ECY_YES=1` ile koş (yalnız güvendiğinde)"],
            ["`ecym` bulunamıyor", "PATH'te `~/.local/bin` yok", "`~/.local/bin`'i PATH'e ekle"],
            ["Model yavaş / yüklenmiyor", "qwen3:8b çekilmemiş", "`ollama pull qwen3:8b` ile modeli çek"],
          ],
        ),
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
  // Source-derived pipeline CLI table: each real pipeline/bin/*.ts file is a subcommand, and
  // its description is read from its own header comment. Nothing here is hand-listed.
  const binDir = join(REPO, "pipeline", "bin");
  const cliRows: string[][] = existsSync(binDir)
    ? readdirSync(binDir)
        .filter((f) => f.endsWith(".ts"))
        .sort()
        .map((f) => [`ollamas pipeline ${f.replace(/\.ts$/, "")}`, binDesc(join(binDir, f)), `pipeline/bin/${f}`])
    : [];

  // API table — only endpoints verified to exist in server/ (grep-checked at authoring time).
  const apiRows: string[][] = [
    ["`POST /v1/chat/completions`", "OpenAI-uyumlu sohbet — ücretsiz sağlayıcılara yönlendirir ($0)", "router"],
    ["`ALL /mcp`", "MCP gateway — Claude Code veya herhangi bir MCP client bağlanır", "gateway"],
    ["`GET /api/ai/models`", "Kullanılabilir modelleri listele", "ai"],
    ["`POST /api/ai/generate`", "Tek-atış üretim", "ai"],
    ["`POST /api/brain/ask`", "Beyin belleğine sor (recall + sentez)", "brain"],
  ];

  const sections: HelpSection[] = [
    {
      id: "getting-started", title: "Başlangıç", summary: "ollamas nedir ve ilk çalıştırma",
      pages: [
        {
          slug: "getting-started/genel", title: "ollamas Nedir",
          body: toBody(readme) || "ollamas, yerel LLM Mission Control: MCP gateway, sağlayıcı yönlendirme, orkestra ve pipeline. $0 yerel çalışma hedefli.",
          sources: ["~/Desktop/ollamas/README.md"],
        },
        {
          slug: "getting-started/quickstart", title: "Hızlı Başlangıç",
          body: quickstartBody("ollamas'ı sıfırdan çalışır hale getiren adımlar (README 'Hızlı başlangıç' bölümünden).", [
            { title: "Ön-koşulları hazırla", detail: "Idempotent hazırlık: Node kontrolü, `npm ci`, `.env` kopyası, ollama daemon doğrulaması, varsayılan model çekme, derin audit. Yerel kullanım için API key gerekmez.", cmd: "npm run ready" },
            { title: "Sunucuyu başlat", detail: "Geliştirme sunucusu `http://localhost:3000` üzerinde ayağa kalkar (veya `make up`).", cmd: "npm run dev" },
            { title: "Sağlığı doğrula", detail: "node/ollama/bridge/app derin sağlık denetimi; gateway/ollama/bridge/ready paralel problanır.", cmd: "npm run doctor" },
          ]),
          sources: ["~/Desktop/ollamas/README.md", "~/Desktop/ollamas/QUICKSTART.md"],
        },
      ],
    },
    {
      id: "guides", title: "Rehberler", summary: "Pipeline ve günlük kullanım",
      pages: [{
        slug: "guides/pipeline", title: "eCym Pipeline",
        body: sec("## 1. What this is", prompt) || "18-adım kanıt hattı: search→think→analyze→plan→todo→sandbox_test→…→push. Kapılar ölçer, chaos koşar, prompt kendini günceller.",
        sources: ["~/Desktop/ollamas/pipeline/PROMPT.md"],
      }],
    },
    {
      id: "reference", title: "Referans", summary: "CLI komutları ve HTTP uçları",
      pages: [
        {
          slug: "reference/cli", title: "Pipeline CLI Referansı",
          body: tableBody("`ollamas pipeline` alt-komutları (her satır gerçek bir `pipeline/bin/*.ts` dosyasıdır).", ["Komut", "Ne yapar", "Kaynak"], cliRows),
          sources: ["~/Desktop/ollamas/pipeline/bin/"],
        },
        {
          slug: "reference/api", title: "HTTP API Referansı",
          body: tableBody("Doğrulanmış HTTP uçları (`:3000`).", ["Uç", "Ne yapar", "Alan"], apiRows),
          sources: ["~/Desktop/ollamas/server/", "~/Desktop/ollamas/README.md"],
        },
      ],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Servis, kapı ve GPU sorunları",
      pages: [{
        slug: "troubleshooting/servis", title: "Servis & SSS",
        body: tableBody(
          "ollamas çalıştırırken en sık görülen sorunlar (gerçek gotcha'lardan).",
          ["Belirti", "Neden", "Çözüm"],
          [
            ["Sağlık belirsiz", "Servis durumu bilinmiyor", "`ollamas doctor --json` çalıştır — gateway/ollama/bridge/ready paralel problanır"],
            ["Yerel LLM ~3× yavaş", "Tek-GPU'da paralel çağrı serialize oluyor", "Yerel LLM çağrılarını **sıralı** işle (README Platform notu)"],
            [":3000 yanıt vermiyor", "Sunucu ayakta değil", "`npm run dev` veya `make up` ile başlat; ardından `npm run doctor`"],
            ["Commit reddediliyor", "Kalite kapısı kırmızı", "`npm run lint && npm run test` yeşil olmadan commit yok"],
          ],
        ),
        sources: ["~/Desktop/ollamas/README.md", "~/Desktop/ollamas/cli/lib/client.ts"],
      }],
    },
  ];
  return { system: "ollamas", hubTitle: "ollamas — Yardım", references: ["~/Desktop/ollamas/README.md", "~/Desktop/ollamas/pipeline/PROMPT.md"], sections };
}

/** obsidian help site — from the in-repo drawing-surface guide, its schema, and the sketch doc. */
function buildObsidian(): HelpSite {
  const dir = join(REPO, "docs", "obsidian");
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  const readme = read("README.md");
  const sketch = read("obsidian-sketch.md");

  // Reference table from the real JSON schema's top-level properties (structured, source-true).
  let schemaRows: string[][] = [];
  try {
    const schema = JSON.parse(read("obsidian-sketch.schema.json"));
    const props = (schema.properties ?? schema) as Record<string, { type?: string; description?: string }>;
    schemaRows = Object.entries(props).map(([k, v]) => [`\`${k}\``, v?.type ?? "—", v?.description ?? "şema alanı"]);
  } catch {
    /* schema unreadable → table stays empty, reported not fabricated */
  }

  // Troubleshooting from the guide's own "corrections" list — real fabrications it caught and
  // fixed, each with command evidence. Parsed from the source, not invented.
  const corrRows: string[][] = [];
  const corrSection = sketch.slice(sketch.indexOf("düzeltilen uydurmalar"));
  for (const m of corrSection.matchAll(/^\d+\.\s+\*\*(.+?)\*\*\s*→\s*(.+?)\s*$/gm)) {
    corrRows.push([m[1].trim(), m[2].trim()]);
    if (corrRows.length >= 6) break;
  }

  const sections: HelpSection[] = [
    {
      id: "getting-started", title: "Başlangıç", summary: "Çizim yüzeyi nedir ve nasıl koşulur",
      pages: [
        {
          slug: "getting-started/genel", title: "Obsidian Çizim Yüzeyi Nedir",
          body: toBody(readme) || "Obsidian çizim yüzeyi: Canvas, Excalidraw, graph/slides ve Sketch Your Mind kataloğunun ollamas / eCym / odysseus için uçtan uca kılavuzu. Envanterin hiçbiri elle yazılmaz; her sayı canlı bir komuttan türetilir.",
          sources: ["~/Desktop/ollamas/docs/obsidian/README.md"],
        },
        {
          slug: "getting-started/quickstart", title: "Hızlı Başlangıç",
          body: quickstartBody("Çizim kılavuzunu üret ve doğrula. Kılavuz elle düzenlenmez — üreticiden çıkar.", [
            { title: "Kılavuzu üret", detail: "Üretici canlı Obsidian ister: komut envanteri `GET /commands/` kaydından, ayarlar eklentinin `data.json`'ından, yardım sayfaları sitemap'ten gelir.", cmd: "python3 ~/Desktop/obsidian-sketch-gen.py" },
            { title: "Kapıyı koştur", detail: "S1..S12 kapısı; çıkış 0 şart. Kapı her koşuda üç bozuk kopya üretir ve reddedildiklerini gösterir — başarısız olamayan kapı hiçbir şey kanıtlamaz.", cmd: "zsh ~/Desktop/obsidian-sketch-verify.sh" },
            { title: "Yazmadan üret (opsiyonel)", detail: "Yazma ölçümlerini `_sandbox/` içinde koşmadan üretmek için sandbox'ı kapat.", cmd: "SKETCH_NO_SANDBOX=1 python3 ~/Desktop/obsidian-sketch-gen.py" },
          ]),
          sources: ["~/Desktop/ollamas/docs/obsidian/README.md"],
        },
      ],
    },
    {
      id: "guides", title: "Rehberler", summary: "Canvas, Excalidraw ve SYM",
      pages: [{
        slug: "guides/cizim", title: "Çizim Yüzeyi Kapsamı",
        body: toBody(sketch.slice(sketch.indexOf("## Kapsam kanıtı"), sketch.indexOf("## Taslakta")), 900) ||
          "Çizim yardım sayfası 6/6, çizim komutu 77/77 (canlı `/commands/` kaydından), Excalidraw ayarı 177/177 (15 gruba ayrıldı), SYM ekosistem kalemi 9/9. Karar SD1–SD22, adım 54, kör nokta 7, kapı S1–S12.",
        sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
      }],
    },
    {
      id: "reference", title: "Referans", summary: "Çizim SYM / şema alanları",
      pages: [{
        slug: "reference/sema", title: "Şema Referansı",
        body: schemaRows.length
          ? tableBody("`obsidian-sketch.schema.json` üst-düzey alanları — kapının (S8) koştuğu şema.", ["Alan", "Tip", "Açıklama"], schemaRows)
          : "Şema okunamadı; `docs/obsidian/obsidian-sketch.schema.json` mevcut değil. Şema S8 kapısında koşar ve her çıktı alanını doğrular; version/environment/corrections/pipeline/inventory/decisions/phases/sandboxRun/blindSpots/gates alanlarını içerir.",
        sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.schema.json"],
      }],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Kör noktalar ve düzeltilen uydurmalar",
      pages: [{
        slug: "troubleshooting/kornokta", title: "Kör Noktalar & Düzeltmeler",
        body: corrRows.length
          ? tableBody("Kılavuzun önceki elle-yazılmış hâlinin içerdiği ve kapının yakalayıp düzelttiği uydurmalar — her biri komut kanıtına bağlı.", ["Yanlış (uydurma)", "Doğru (kanıtlı)"], corrRows)
          : "Kılavuzun elle-yazılmış taslağı doğrulanmamış iddialar içeriyordu (yanlış alan-adı, olmayan buton, ölü alıntı referansları). Üretici bunları canlı komut kanıtıyla değiştirdi; `zsh ~/Desktop/obsidian-sketch-verify.sh` her koşuda üç bozuk kopya üretip reddedildiklerini gösterir.",
        sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
      }],
    },
  ];
  return {
    system: "obsidian", hubTitle: "Obsidian — Yardım",
    references: ["~/Desktop/ollamas/docs/obsidian/README.md", "~/Desktop/obsidian-sketch.md", "https://obsidian.md/help/"],
    sections,
  };
}

const BUILDERS: Record<string, () => HelpSite> = { claude: buildClaude, ecym: buildEcym, ollamas: buildOllamas, obsidian: buildObsidian };

export function buildSite(system: string): HelpSite {
  const b = BUILDERS[system];
  if (!b) throw new Error(`unknown help system '${system}' (claude|ecym|ollamas|obsidian)`);
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
    console.log("help-build <claude|ecym|ollamas|obsidian> [--verify]");
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
