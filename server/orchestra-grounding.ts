// L45 — a synthesis that ignores its own evidence is not an answer.
//
// Measured live: a follow-up round returned `ps -A -o %cpu` with `node 184.7% · next-server
// 98.1%` sitting right there, and the synthesis still said the responsible process "could be
// assumed" (sorumlu olduğu varsayılabilir) and mislabelled the load averages. The number was
// in the evidence and went unused. Modern RAG evaluation has a name for exactly this —
// groundedness — and it penalises verbose hedging and answers that talk around the question.
//
// This is a deterministic guardrail, not another model asked "is this good?". It checks two
// things a grounded answer must satisfy: it does not hedge, and it actually reuses the concrete
// tokens (numbers, process names) the evidence contains. When it fails, the caller re-asks once
// with a strict prompt; if it still fails, the note says so honestly rather than pretending.
import type { SynthesisSource } from "./orchestra-synthesis";
import { citationIds } from "./brain-answer-score";

/**
 * Turkish hedging that stands in for evidence — the "talked around the question" signal.
 *
 * Matched against the FOLDED (ASCII) answer, not the raw one: `\b` in JS regex is ASCII-only,
 * so `\bçeşitli` never matched because `ç` is not a `\w` char and there is no word boundary
 * before it. Fold first, then the plain-ASCII pattern works on inflected diacritic forms too.
 */
const HEDGE = /(varsayil|varsayab|genellikle|muhtemelen|tipik olarak|olasilikla|sanirim|tahmin|cesitli|baz[i] (uygulama|surec|islem)|olabilir(?! mi))/;

/** ASCII-fold Turkish so hedge/token matching is diacritic-insensitive. */
export function fold(s: string): string {
  return String(s ?? "")
    .replace(/[İIı]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * The concrete tokens a grounded answer should reuse: numbers (with %, decimals) and the
 * distinctive lowercase-word / path names in the evidence. Pulled from the sources so the
 * check adapts to whatever the commands actually returned, rather than a fixed vocabulary.
 */
export function evidenceTokens(sources: SynthesisSource[]): { numbers: string[]; names: string[] } {
  const text = sources.map((s) => s.content).join("\n");
  // Numbers that carry meaning: 184.7, 98.1, %70, 926 — two+ digits or any decimal/percent.
  const numbers = [...new Set((text.match(/\d+[.,]\d+|\d{2,}|%\s?\d+/g) ?? []).map((n) => n.replace(/\s/g, "")))];
  // Distinctive names: process/binary/path-ish tokens, length ≥ 4, not pure digits.
  const names = [...new Set(
    (fold(text).match(/[a-z][a-z0-9._/-]{3,}/g) ?? [])
      .filter((w) => !/^\d/.test(w) && !STOP.has(w)),
  )];
  return { numbers, names };
}

// Words too common to prove grounding — they appear in any answer.
const STOP = new Set([
  "step", "command", "recall", "vault", "mem", "http", "https", "orchestra", "sistem", "gore",
  "kaynak", "veri", "deger", "islem", "surec", "kullan", "gosterir", "yukar",
  // shell/table scaffolding that appears in command output but proves nothing about the answer
  "head", "comm", "pid", "cpu", "%cpu", "ppid", "user", "size", "used", "avail", "filesystem",
  "mounted", "capacity", "iused", "ifree", "load", "average", "-n", "grep", "sort",
]);

export interface Grounding {
  /** 0..1 — how much of the RELEVANT evidence's concrete tokens the answer reuses. */
  score: number;
  hedged: boolean;
  /** At least some relevant evidence token (numeric mode) or a citation (citation mode) is present. */
  citesEvidence: boolean;
  /**
   * Which yardstick was applied. A machine task is graded on the command's numbers; a
   * vault/recall task has no numbers of its own, so it is graded on whether it cites a source.
   */
  mode: "numeric" | "citation";
  /** The verdict: the answer talks around the evidence rather than using it. */
  weak: boolean;
}

/**
 * Grade one synthesised answer against the evidence it was given. PURE.
 *
 * L49 — score the RELEVANT source, not vault noise. Measured: "hangi dizindeyim" answered
 * correctly with the pwd path, but the grader also pulled numbers out of the vault step (a
 * sprint board full of dates) and, finding the answer did not repeat those, marked it weak. A
 * correct answer was then withheld from the brain. Only the chunk that actually answers a task
 * supports it: when a command ran, its output IS the answer, so grounding is measured against
 * the command sources alone. Vault/recall tokens can still ADD to the score (a bonus) but can
 * never drag it down.
 *
 * L50 — a vault/recall task has no numbers of its own to reuse. "felsefede özgür irade" cannot
 * be grounded in a figure; forcing a numeric yardstick marked every such answer weak. With no
 * command source, grounding switches to CITATION: an answer that cites a source ([mem:...]) and
 * does not hedge is grounded. Hedging is caught in both modes.
 */
export function gradeGrounding(answer: string, sources: SynthesisSource[]): Grounding {
  const a = String(answer ?? "");
  const foldedA = fold(a);
  const hedged = HEDGE.test(foldedA);

  const commandSources = sources.filter((s) => s.id === "step:command" || /(^|:)command(:|$)/.test(s.id));

  // ── citation mode: no command ran, so there are no task-numbers to reuse ──────────────────
  if (!commandSources.length) {
    const cites = citationIds(a).length > 0;
    return { score: cites ? 1 : 0, hedged, citesEvidence: cites, mode: "citation", weak: hedged || !cites };
  }

  // ── numeric mode: grade against the COMMAND output; other sources only reinforce ──────────
  const relevant = evidenceTokens(commandSources);
  const supporting = evidenceTokens(sources); // full set, for the bonus only

  const numHit = relevant.numbers.filter((n) => a.includes(n)).length;
  const nameHit = relevant.names.filter((n) => foldedA.includes(n)).length;
  const total = relevant.numbers.length + Math.min(relevant.names.length, 8);
  let hits = numHit + Math.min(nameHit, 8);
  // Bonus: a token from a non-command source the answer also used (never lowers the score).
  const extra = new Set([...supporting.numbers, ...supporting.names]);
  for (const n of relevant.numbers) extra.delete(n);
  for (const n of relevant.names) extra.delete(n);
  const bonus = [...extra].filter((t) => (/^\d/.test(t) ? a.includes(t) : foldedA.includes(t))).length;
  hits += Math.min(bonus, 3);

  const score = total > 0 ? Number((Math.min(hits, total + 3) / total).toFixed(3)) : (a.trim() ? 1 : 0);
  // Cites evidence = used a relevant token; numbers preferred when the command produced any.
  const citesEvidence = relevant.numbers.length ? numHit > 0 : nameHit > 0 || total === 0;

  return { score, hedged, citesEvidence, mode: "numeric", weak: hedged || !citesEvidence };
}

/**
 * The re-ask prompt. Its own system message, so it never inherits askShared's terse contract
 * (which is what suppressed grounding in the first place). Strict: use the evidence's numbers,
 * no hedging, cite every claim.
 */
export const REGROUND_PROMPT =
  "Sen bir cevap düzelticisin. Önceki cevap KANIT'taki somut verileri kullanmadı.\n"
  + "Kurallar:\n"
  + "- SADECE KAYNAK'taki somut sayıları ve isimleri kullan (ör. süreç adı, %CPU, GB).\n"
  + "- \"varsayılabilir / genellikle / muhtemelen / çeşitli süreçler\" gibi KAÇAMAK YASAK.\n"
  + "- Her iddiadan sonra [mem:step:command] gibi kaynak belirt.\n"
  + "- Sorunun her parçasını somut veriyle karşıla.\n"
  + "- Kanıtta gerçekten yoksa: BİLGİ_YOK.";

/** The strict re-ask, as a message pair. */
export function regroundMessages(title: string, sources: SynthesisSource[]): { role: string; content: string }[] {
  const evidence = sources.map((s) => `[${s.id}]\n${s.content}`).join("\n\n");
  return [
    { role: "system", content: REGROUND_PROMPT },
    { role: "user", content: `GÖREV: ${title}\n\nKAYNAK:\n${evidence}\n\nSomut, atıflı cevap:` },
  ];
}
