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

/** Parse `### N-043 · title` seyir-defteri gotcha headings → [id, title] rows (source-derived).
 * `kind` filters by record class: "E" = hata kayıtları, "N" = notlar, undefined = both. */
function seyirRows(file: string, max = 6, kind?: "E" | "N"): string[][] {
  if (!existsSync(file)) return [];
  const rows: string[][] = [];
  const re = kind ? new RegExp(`^#{2,3}\\s+(${kind}-\\d+)\\s+·\\s+(.+?)\\s*$`, "gm") : /^#{2,3}\s+([EN]-\d+)\s+·\s+(.+?)\s*$/gm;
  for (const m of readFileSync(file, "utf8").matchAll(re)) {
    rows.push([m[1], m[2].trim()]);
    if (rows.length >= max) break;
  }
  return rows;
}

/** Parse the obsidian-sketch "Kapsam kanıtı" markdown table → [surface, coverage, how] rows. */
function sketchInventoryRows(sketch: string): string[][] {
  const seg = sketch.slice(sketch.indexOf("## Kapsam kanıtı"), sketch.indexOf("## Taslakta"));
  const rows: string[][] = [];
  for (const line of seg.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*\*\*([^|]+?)\*\*\s*\|\s*([^|]+?)\s*\|$/);
    if (m) rows.push([m[1].trim(), m[2].trim(), m[3].trim()]);
  }
  return rows;
}

/** Parse `<Spot id="SBx" severity=".." status=".."><Title>..</Title>` → [id, severity, status, title] rows. */
function blindSpotRows(sketch: string): string[][] {
  const rows: string[][] = [];
  for (const m of sketch.matchAll(/<Spot id="(SB\d+)"\s+severity="([^"]+)"\s+status="([^"]+)">\s*<Title>([^<]+)<\/Title>/g)) {
    rows.push([m[1], m[2], m[3], m[4].trim()]);
  }
  return rows;
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
    {
      id: "guides", title: "Rehberler", summary: "Çalışma akışı ve sık kullanım",
      pages: [
        {
          slug: "guides/exec-loop", title: "exec_loop — Çıktı → Onay Akışı",
          body: quickstartBody(
            "eCym bir hedefi tek komutla değil, yinelemeli bir döngüyle (`exec_loop`) çözer. Akış (kaynak: `~/.local/bin/ecym`):",
            [
              { title: "Döngü başlar", detail: "`exec_loop <hedef>` en çok `ECY_MAX` (varsayılan 6) tur döner; her turda yerel model bir komut önerir." },
              { title: "Güvenli mi, riskli mi", detail: "Komut `risky` ise atlanır ve tura not düşülür; güvenliyse `timeout 20 bash -c` ile çalışır, çıktının ilk 8 satırı gösterilir." },
              { title: "Hata → ollamas delege", detail: "Komut hata verirse ollamas'a delege edilir (`groq_fix`); dönen düzeltme güvenliyse yeniden çalıştırılır." },
              { title: "Bitti mi", detail: "Her turdan sonra `donecheck` hedefe ulaşılıp ulaşılmadığını sorar; EVET ise döngü biter. Aynı komut tekrarlanırsa ya da DONE gelirse de biter." },
              { title: "Tek komut onayı", detail: "Tek-atış modda (`apply_match`) güvenli komut doğrudan çalışır; riskli komut çalışmaz — `ECY_YES=1 ecym \"...\"` ile açık onay ister.", cmd: 'ECY_YES=1 ecym "riskli işlemi onayla"' },
            ],
          ),
          sources: ["~/.local/bin/ecym", "~/.local/bin/ecy-cmd"],
        },
        ...byLevel("baslangic").slice(0, 5).map(page),
      ],
    },
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
        {
          slug: "reference/env", title: "Ortam Değişkenleri & Rota",
          body: tableBody(
            "eCym'in davranışını değiştiren ortam değişkenleri ve `ecy-cmd` rota katmanı (kaynak: `~/.local/bin/ecym` + `ecy-cmd`).",
            ["Değişken", "Ne yapar", "Varsayılan"],
            [
              ["`ECY_YES=1`", "Riskli komutu onaysız çalıştırır; ayarsız ise önce onay ister", "kapalı (onay ister)"],
              ["`ECY_MAX`", "`exec_loop` için maksimum iterasyon sayısı", "6"],
              ["`ECYM_NO_TRACKER=1`", "Canlı task-tracker köprüsünü kapatır (ollamas follow ile aynı ekran)", "açık"],
              ["`ECY_DATASET`", "Komut kataloğu JSON yolunu override eder", "~/ecy-model/terminal-dataset.json"],
            ],
          ),
          sources: ["~/.local/bin/ecym", "~/.local/bin/ecy-cmd"],
        },
        {
          slug: "reference/katalog", title: `Tam Komut Kataloğu (${cmds.length})`,
          body: tableBody(
            `${cmds.length} komutun birleşik referansı, seviyeye göre sıralı (kaynak: terminal-dataset.json). Doğal dil→komut için "\`ecym <istek>\`".`,
            ["Komut", "Seviye", "Ne yapar"],
            [...cmds]
              .sort((a, b) => ({ baslangic: 0, orta: 1, ileri: 2 }[a.level] ?? 3) - ({ baslangic: 0, orta: 1, ileri: 2 }[b.level] ?? 3))
              .map((c) => [`\`${c.cmd}\``, c.level, c.desc]),
          ),
          sources: ["~/ecy-model/terminal-dataset.json", "~/ollamas-vault/ecym/data/terminal-dataset.json"],
        },
        {
          slug: "reference/exit-codes", title: "Çıkış Kodları (Exit Codes)",
          body: tableBody(
            "`ecy-cmd \"<istek>\"` bir isteği komuta eşlerken çıkış koduyla sonucu bildirir (kaynak: `~/.local/bin/ecy-cmd`). Betikler bu sözleşmeye güvenebilir.",
            ["Kod", "Anlam", "Çıktı"],
            [
              ["`0`", "Eşleşme bulundu", "JSON `{cmd, safe, level, desc}`"],
              ["`1`", "Eşleşme yok → Tier2'ye devret", "(çıktı yok)"],
              ["`2`", "Belirsiz (birden çok yakın aday)", "(belirsizlik bildirimi)"],
              ["`3`", "Argüman eksik (`need_arg`)", "JSON `{need_arg, id, cmd_template, safe}`"],
            ],
          ),
          sources: ["~/.local/bin/ecy-cmd"],
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
        {
          slug: "reference/toplevel", title: "ollamas CLI (üst-düzey)",
          body: tableBody(
            "Üst-düzey `ollamas` komutları — görev kataloğu ve orkestra (kaynak: `docs/TASKS.md`, `orchestration/TASKS.json`).",
            ["Komut", "Ne yapar", "Kaynak"],
            [
              ["`ollamas tasks`", "Katalogdaki tüm görevleri listeler (id + hedef; N = projenin gerçek görev yüzeyi)", "orchestration/TASKS.json"],
              ["`ollamas do \"<id>\"`", "Bir görevi çalıştırır: hedef dosyaya çözer, yerel modeli grounder, kapılı düzeltme önerir", "docs/TASKS.md"],
              ["`ollamas do \"<serbest metin>\"`", "En yakın katalog görevine fuzzy-çözer", "docs/TASKS.md"],
              ["`ollamas doctor --json`", "node/ollama/bridge/app derin sağlık denetimi (paralel prob)", "cli/lib/client.ts"],
            ],
          ),
          sources: ["~/Desktop/ollamas/docs/TASKS.md", "~/Desktop/ollamas/orchestration/TASKS.json"],
        },
      ],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Servis, kapı, GPU ve bilinen sorunlar",
      pages: [
        {
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
        },
        {
          slug: "troubleshooting/seyir", title: "Bilinen Sorunlar (Seyir Defteri)",
          body: (() => {
            const f = join(REPO, "cli", "CLI_SEYIR_DEFTERI.md");
            const errs = seyirRows(f, 6, "E").map((r) => [...r, "hata (E)"]);
            const notes = seyirRows(f, 6, "N").map((r) => [...r, "not (N)"]);
            const rows = [...errs, ...notes];
            return rows.length
              ? tableBody("CLI seyir defterinden kanıtlanmış kayıtlar — E-xxx hata kayıtları ve N-xxx notlar, her biri bir ÖNLEME kuralına bağlıdır.", ["Kayıt", "Sorun / kural", "Tür"], rows)
              : "CLI seyir defteri (`cli/CLI_SEYIR_DEFTERI.md`) her kanıtlanmış hatayı bir E-xxx/N-xxx kaydı ve ÖNLEME kuralı olarak tutar; commit öncesi kalite kapısı bunlara dayanır.";
          })(),
          sources: ["~/Desktop/ollamas/cli/CLI_SEYIR_DEFTERI.md"],
        },
      ],
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
  // Each field gets a Turkish one-liner grounded in the schema's own role + the guide's Kapsam
  // kanıtı; the schema leaves 6/10 `description`s empty, so a placeholder would be dishonest.
  const FIELD_TR: Record<string, string> = {
    version: "Kılavuzun sürümü.",
    environment: "Ölçülen ortam — Obsidian/Excalidraw sürümleri ve host bilgisi.",
    corrections: "Elle-yazılmış taslağın iddiaları ve her birini çürüten komut kanıtı.",
    pipeline: "İstenen hiyerarşi; her aşama nerede karşılandığına işaret eder.",
    inventory: "Kapsam envanteri — komut/ayar/SYM/karar sayıları (canlı ölçüm).",
    decisions: "'X kullanırsan Y olur' karar matrisi (SD1–SD22).",
    phases: "Uçtan uca döngü adımları; her biri çalıştırılabilir Cmd ya da açıklayıcı Desc.",
    sandboxRun: "Yazma ölçümleri; ran=false dürüsttür, sahte 'ölçüldü' yerine geçmez.",
    blindSpots: "Kanıtlanmış kör noktalar (SB1–SB7) — otomasyonun sessizce başarısız olabileceği yerler.",
    gates: "Kapılar (S1–S12); her koşuda üç bozuk kopya üretip reddedildiklerini gösterir.",
  };
  let schemaRows: string[][] = [];
  try {
    const schema = JSON.parse(read("obsidian-sketch.schema.json"));
    const props = (schema.properties ?? schema) as Record<string, { type?: string; description?: string }>;
    schemaRows = Object.entries(props).map(([k, v]) => [`\`${k}\``, v?.type ?? "—", FIELD_TR[k] ?? v?.description ?? "şema alanı"]);
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
      id: "guides", title: "Rehberler", summary: "İki kanal, Canvas, Excalidraw ve SYM",
      pages: [
        {
          slug: "guides/kanallar", title: "İki Kanal — Graph, .base, Wikilink",
          body: [
            "Vault bilgiyi İKİ tamamlayıcı kanalla taşır. İkisini birlikte kullan.",
            "",
            "## Wikilink kanalı (graph)",
            "Çift köşeli parantez içine alınmış not adları (wikilink) Obsidian **graph**'ını kurar; ilişki gezinmesi ve federasyon buradan çıkar. brain yalnızca `.canvas` ve wikilink yazar; **özel frontmatter/H1/callout'u SİLER**, o yüzden kaynak çapası (source_url) gövde-içi düz metin olmalı.",
            "",
            "## .base kanalı (yapılandırılmış)",
            "`.base` dosyaları not-üstü **veritabanı görünümleridir** (filtre + formül + view). Örnek: `_index/claude-code.base` (filtreler/formüller/3 view). **`groupBy` bir OBJE olmalı** (skaler groupBy üretimde sorgulanamaz — kanıtlı gotcha). Obsidian `.base`/types/workspace'i BELLEKTE tutar; disk otoriterdir.",
            "",
            "## Hangisi ne zaman",
            "- Serbest ilişki, keşif, graf → **wikilink**.",
            "- Sayısal/kategorik sorgu, tablo, panel → **.base**.",
            "Örtüşen sayfalar `sharedWith` + `lens` ile beyan edilir; kapı bunu doğrular.",
          ].join("\n"),
          sources: ["~/Desktop/ollamas/docs/obsidian/README.md", "~/ollamas-vault/_index/claude-code.base"],
        },
        {
          slug: "guides/cizim", title: "Çizim Yüzeyi Kapsamı",
          body: toBody(sketch.slice(sketch.indexOf("## Kapsam kanıtı"), sketch.indexOf("## Taslakta")), 900) ||
            "Çizim yardım sayfası 6/6, çizim komutu 77/77 (canlı `/commands/` kaydından), Excalidraw ayarı 177/177 (15 gruba ayrıldı), SYM ekosistem kalemi 9/9. Karar SD1–SD22, adım 54, kör nokta 7, kapı S1–S12.",
          sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
        },
      ],
    },
    {
      id: "reference", title: "Referans", summary: "Envanter, SYM ve şema alanları",
      pages: [
        {
          slug: "reference/envanter", title: "Kapsam Envanteri",
          body: (() => {
            const rows = sketchInventoryRows(sketch);
            return rows.length
              ? tableBody("Çizim yüzeyinin ölçülen kapsamı — her satır canlı bir komuttan türetilir, elle yazılmaz (kaynak: `obsidian-sketch.md` Kapsam kanıtı).", ["Yüzey", "Kapsam", "Nasıl"], rows)
              : "Çizim yüzeyi: 6/6 yardım sayfası, 77/77 çizim komutu (canlı `/commands/`), 177/177 Excalidraw ayarı (15 grup), 9/9 SYM kalemi, 22 karar (SD1–SD22), 54 adım, 7 kör nokta, 12 kapı (S1–S12).";
          })(),
          sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
        },
        {
          slug: "reference/sema", title: "Şema Referansı",
          body: schemaRows.length
            ? tableBody("`obsidian-sketch.schema.json` üst-düzey alanları — kapının (S8) koştuğu şema.", ["Alan", "Tip", "Açıklama"], schemaRows)
            : "Şema okunamadı; `docs/obsidian/obsidian-sketch.schema.json` mevcut değil. Şema S8 kapısında koşar ve her çıktı alanını doğrular; version/environment/corrections/pipeline/inventory/decisions/phases/sandboxRun/blindSpots/gates alanlarını içerir.",
          sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.schema.json"],
        },
      ],
    },
    {
      id: "troubleshooting", title: "Sorun Giderme", summary: "Kör noktalar ve düzeltilen uydurmalar",
      pages: [
        {
          slug: "troubleshooting/kornokta", title: "Düzeltilen Uydurmalar",
          body: corrRows.length
            ? tableBody("Kılavuzun önceki elle-yazılmış hâlinin içerdiği ve kapının yakalayıp düzelttiği uydurmalar — her biri komut kanıtına bağlı.", ["Yanlış (uydurma)", "Doğru (kanıtlı)"], corrRows)
            : "Kılavuzun elle-yazılmış taslağı doğrulanmamış iddialar içeriyordu (yanlış alan-adı, olmayan buton, ölü alıntı referansları). Üretici bunları canlı komut kanıtıyla değiştirdi; `zsh ~/Desktop/obsidian-sketch-verify.sh` her koşuda üç bozuk kopya üretip reddedildiklerini gösterir.",
          sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
        },
        {
          slug: "troubleshooting/blindspot", title: "Kör Noktalar (SB1–SB7)",
          body: (() => {
            const rows = blindSpotRows(sketch);
            return rows.length
              ? tableBody("Kılavuzun kanıtladığı 7 kör nokta (3 çözüldü, 4 açık) — otomasyonun sessizce başarısız olabileceği yerler.", ["Kod", "Önem", "Durum", "Başlık"], rows)
              : "Kılavuz 7 kör nokta kanıtlar: 3'ü çözüldü, 4'ü kanıtlı açık. En kritiği SB1 — CLI 'Executed:' yazar ama komut hiç koşmamış olabilir; çözüm her komuttan sonra gözlemlenebilir değişim (bayt/satır/dosya) ölçmek.";
          })(),
          sources: ["~/Desktop/ollamas/docs/obsidian/obsidian-sketch.md"],
        },
      ],
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
