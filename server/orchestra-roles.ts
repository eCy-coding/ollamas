// L36 — roles, not clones.
//
// Until now every seat received the same retrieval context and the same prompt, and was asked
// for the same thing: prose. Four models writing four essays about one question is a PANEL.
// An orchestra requires each member to do what the others cannot.
//
// The three members and their genuinely distinct capabilities:
//
//   ollamas   the brain — semantic recall over 2000+ memories plus the fact graph. Only it
//             can answer from what the system remembers, with verifiable [mem:ID] citations.
//   eCym      the machine — a 220-command terminal catalog (98 safe / 122 gated) with trigger
//             phrases. Only it knows how to ASK THE MACHINE. Its output should be a COMMAND,
//             not an essay: asked about disk usage it should answer `df -h`, not describe df.
//   obsidian  the vault — 16 live MCP tools. Only it sees resolved backlinks, the tag index,
//             the active file, and only it can WRITE human-facing notes.
//
// This module is the capability contract. It is deliberately free of LLM calls: matching a
// question to a catalog command is string work, and doing it deterministically means eCym's
// contribution is reproducible and testable rather than a sampling accident.
import { readEcymCommands, type EcymCommand } from "./brain-obsidian-ecym";
import { vaultSearch, vaultRead, obsidianHealth, type VaultHit } from "./obsidian-rest";

export type RoleName = "ollamas" | "ecym" | "obsidian";

/** Turkish/ASCII fold — the catalog's triggers are written without diacritics ("calisma dizini"). */
export function fold(s: string): string {
  // Map Turkish letters BEFORE lowercasing. `"İ".toLowerCase()` is "i" + U+0307 (combining dot
  // above), so folding afterwards leaves the mark behind and the final cleanup turns it into a
  // space — "İşlem" became "i slem" and matched nothing. NFD + mark-strip catches any other
  // pre-decomposed input for the same reason.
  return String(s ?? "")
    .replace(/[İIı]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that carry no retrieval signal: Turkish question/function words plus the scaffolding
 * people put in task titles. Kept in FOLDED form, since that is what `fold` produces.
 */
const QUERY_NOISE = new Set([
  // question + function words
  "nedir", "nasil", "neden", "kim", "kimdir", "hangi", "kac", "kacta", "mi", "mu", "mi",
  "ne", "nerede", "nereden", "nereye", "var", "yok", "olan", "icin", "ile", "ve", "veya",
  "bir", "bu", "su", "o", "da", "de", "ki", "gibi", "daha", "cok", "az",
  // task scaffolding — "e2e kanıt görevi …" is framing, not subject
  "e2e", "kanit", "gorev", "gorevi", "test", "kontrol", "yap", "yapil", "cikar", "olustur",
  "getir", "bul", "goster", "raporu", "rapor", "durumu", "durum",
]);

/**
 * A task TITLE is a sentence; a search query is not.
 *
 * Measured: obsidian was handed "e2e kanıt görevi disk doluluk durumu nedir" verbatim and
 * returned no hits at all, burning 135ms — the member's whole contribution was dead because of
 * the query, not because the vault lacked the material. Keeping only content words fixes that.
 * Falls back to the folded title when everything would be stripped, so a title made entirely of
 * common words still searches for something rather than nothing.
 */
export function queryFor(title: string): string {
  const folded = fold(title);
  const kept = folded.split(" ").filter((w) => w.length > 2 && !QUERY_NOISE.has(w));
  return kept.length ? kept.join(" ") : folded;
}

export interface CommandMatch {
  command: EcymCommand;
  /** 0..1 — share of the trigger's words present in the question, longest trigger wins ties. */
  score: number;
  matchedTrigger: string;
}

/**
 * Match a question against the catalog's trigger phrases.
 *
 * Whole-phrase containment first (a trigger like "calisma dizini" is a phrase, not two words),
 * then per-word coverage so a longer question still finds its command. Single-word triggers
 * must match as a WORD, otherwise "ps" would fire on "pratikte" and every question would look
 * like a process listing.
 */
export function matchCommand(question: string, catalog: EcymCommand[]): CommandMatch | null {
  const q = fold(question);
  if (!q) return null;
  const qWords = new Set(q.split(" ").filter(Boolean));
  let best: CommandMatch | null = null;

  for (const c of catalog) {
    for (const raw of c.triggers ?? []) {
      const t = fold(raw);
      if (!t) continue;
      const tWords = t.split(" ").filter(Boolean);
      let score = 0;
      if (tWords.length === 1) {
        score = qWords.has(tWords[0]) ? 1 : 0;
      } else if (q.includes(t)) {
        score = 1;
      } else {
        const hit = tWords.filter((w) => qWords.has(w)).length;
        score = hit / tWords.length;
        // A partial phrase match must be substantial, else two stopwords would "match".
        if (score < 0.75) score = 0;
      }
      if (!score) continue;
      // Ties go to the more specific (longer) trigger.
      if (!best || score > best.score || (score === best.score && t.length > fold(best.matchedTrigger).length)) {
        best = { command: c, score, matchedTrigger: raw };
      }
    }
  }
  return best;
}

export interface EcymProposal {
  /** The command to run, verbatim. */
  cmd: string;
  /** Catalog id, or null when nothing matched (then the command is free-form and ALWAYS gated). */
  id: string | null;
  safe: boolean;
  desc: string;
  matchedTrigger?: string;
  score: number;
  /** Catalog template with an unfilled `{{placeholder}}` — a human must supply the argument. */
  needsArgument?: boolean;
}

/**
 * eCym's role output: a command, not prose.
 *
 * A catalog hit carries the catalog's own `safe` flag. No hit means the caller must fall back
 * to a free-form suggestion, and anything not in the vetted catalog is treated as unsafe by
 * construction — an unknown command has not been reviewed by anyone.
 */
export function ecymPropose(question: string, catalog = readEcymCommands()): EcymProposal | null {
  const m = matchCommand(question, catalog);
  if (!m) return null;
  const c = m.command;
  const cmd = c.arg && c.arg !== "yok" ? `${c.cmd} ${c.arg}` : c.cmd;
  // Some catalog entries are templates (`pgrep -il {{name}}`, `lsof -nP -i :{{port}}`). Several
  // are flagged safe, and they ARE safe once filled — but nothing here can fill them, and
  // running the literal placeholder is not the command anyone meant. Needing an argument the
  // matcher cannot supply makes it a decision for a human, so it drops to gated.
  const templated = /\{\{[^}]+\}\}/.test(cmd);
  return {
    cmd, id: c.id, safe: !!c.safe && !templated,
    desc: c.desc ?? "", matchedTrigger: m.matchedTrigger, score: m.score,
    ...(templated ? { needsArgument: true } : {}),
  };
}

/** A free-form command that did not come from the catalog is never auto-run. */
export const freeFormProposal = (cmd: string): EcymProposal =>
  ({ cmd, id: null, safe: false, desc: "katalog dışı (incelenmemiş)", score: 0 });

/**
 * Is this EXACT command a vetted, safe catalog entry?
 *
 * Used at the point of execution to re-derive the verdict instead of trusting the plan that
 * produced it. Matching is on the resolved command string, so a caller cannot smuggle
 * something through by claiming a catalog id it does not correspond to.
 */
export function isCatalogSafeCommand(cmd: string, catalog = readEcymCommands()): boolean {
  const target = String(cmd ?? "").trim();
  if (!target || /\{\{[^}]+\}\}/.test(target)) return false;
  return catalog.some((c) => {
    if (!(c.safe === true || String(c.safe).toLowerCase() === "true")) return false;
    const resolved = c.arg && c.arg !== "yok" ? `${c.cmd} ${c.arg}` : c.cmd;
    return String(resolved).trim() === target;
  });
}

export interface VaultFinding {
  path: string;
  score: number;
  excerpt: string;
  /** Resolved by Obsidian's link index — the filesystem cannot produce these. */
  backlinks: string[];
  tags: string[];
}

export interface VaultContribution {
  ok: boolean;
  findings: VaultFinding[];
  /** Present when the vault could not contribute — never a fabricated empty result. */
  reason?: string;
}

/**
 * obsidian's role output: what the LIVE vault knows. Not a mirror read off disk — the value is
 * precisely the things only a running Obsidian has, above all resolved backlinks.
 *
 * Degrades honestly: a closed app yields ok:false with a reason, never an empty list dressed
 * up as "nothing found".
 */
export async function obsidianContribute(question: string, limit = 3): Promise<VaultContribution> {
  const health = await obsidianHealth();
  if (!health.ok) return { ok: false, findings: [], reason: health.error ?? "offline" };

  // Search with content words, not the whole sentence — see queryFor.
  const hits: VaultHit[] = await vaultSearch(queryFor(question), limit);
  const findings = await Promise.all(hits.map(async (h) => {
    const note = await vaultRead(h.path);
    return {
      path: h.path,
      score: h.score,
      excerpt: h.context || (note?.content ?? "").slice(0, 200),
      backlinks: note?.backlinks ?? [],
      tags: note?.tags ?? [],
    };
  }));
  return { ok: true, findings };
}

export interface RoleCard { name: RoleName; title: string; capability: string; unique: string }

/** What each member is FOR — the vault hub renders this, so the contract has one home. */
export const ROLE_CARDS: RoleCard[] = [
  { name: "ollamas", title: "🔵 ollamas — beyin",
    capability: "sqlite-vec anlamsal recall + fact-graf, [mem:ID] atıflı sentez",
    unique: "sistemin HATIRLADIĞINI doğrulanabilir atıfla veren tek üye" },
  { name: "ecym", title: "🟢 eCym — makine",
    capability: "220 komutluk terminal kataloğu (98 safe / 122 gated), tetikleyici eşleme",
    unique: "MAKİNEYE nasıl sorulacağını bilen tek üye — düzyazı değil, komut üretir" },
  { name: "obsidian", title: "🟠 obsidian — kasa",
    capability: "16 canlı MCP aracı: arama, okuma, backlink/etiket indeksi, not YAZMA",
    unique: "çözümlenmiş backlink'leri gören ve insana dönük not yazabilen tek üye" },
];
