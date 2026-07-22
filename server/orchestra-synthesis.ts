// L39 — a task produces an ANSWER.
//
// WHY: the evidence note held three raw outputs and stopped there. The task was "disk doluluk
// durumu nedir" and the note said, in full: obsidian found nothing, ollamas recalled a commit
// about disk-survey.ts, eCym printed `df -h`. The number was sitting right there in the third
// block and nobody wrote the sentence. Three members gathered material; none drew a conclusion.
//
// Rather than write a synthesis engine, this reuses the one already in the building. askShared's
// `recall` is injectable (AskDeps.recall), so feeding it the STEP OUTPUTS as sources runs the
// whole panel — four experts, the quality veto, honest degradation, external scoring — over the
// task's own evidence. Everything fixed in L33/L34 applies here for free, and citations become
// role attribution: [mem:step:ecym] reads as "the machine said this".
import { askShared, type SharedDeps, type SharedAskResult } from "./brain-shared";
import type { StepResult, StepRole } from "./orchestra-tasks";

/** Ranking hint for the panel: the machine's raw output is the most direct evidence a task
 *  has, the brain's recall is background, the vault is context. Not a truth ordering —
 *  just which block usually carries the answer. */
const ROLE_WEIGHT: Record<StepRole, number> = { command: 1, recall: 0.9, vault: 0.8 };

export interface SynthesisSource {
  id: string; tier: string; content: string; distance: number; score: number; createdAt: number;
}

/**
 * Step results → sources the panel can cite. PURE.
 *
 * Only steps that actually produced something are included: a gated step ran nothing, and a
 * failed one has an error message, not evidence. Feeding either in would invite the panel to
 * "conclude" from an approval prompt.
 */
export function stepsAsSources(results: StepResult[], now = 0): SynthesisSource[] {
  return results
    .filter((r) => r.ok && !r.gated && r.output.trim())
    .map((r) => ({
      id: `step:${r.role}`,
      tier: "working",
      content: `[${r.role}] ${r.invocation}\n${r.output}`,
      distance: 0,
      score: ROLE_WEIGHT[r.role] ?? 0.5,
      createdAt: now,
    }));
}

/** The task's question restated for the panel, with the evidence contract spelled out.
 *  When `followupIds` is given the panel may ALSO name one catalog command to run next. */
export function synthesisQuestion(title: string, followupIds: string[] = []): string {
  const base = `GÖREV: ${title}\n\n`
    + `Yukarıdaki görevi yürüten üyelerin HAM çıktıları KAYNAK olarak verildi. `
    + `Görevin sorusunu SADECE bu kanıta dayanarak, tek paragrafta ve somut sayılarla cevapla. `
    // Measured: after a follow-up round delivered `node 184.7%`, the answer still said the
    // responsible process "could be assumed" — the data was in the evidence and went unused.
    + `KAYNAKLAR birden çok turdan gelebilir; HEPSİNİ kullan ve sorunun her parçasını `
    + `somut isim/sayı ile karşıla, "varsayılabilir/genellikle" gibi kaçamak kullanma. `
    + `Kanıtta cevap yoksa BİLGİ_YOK yaz.`;
  if (!followupIds.length) return base;
  // Only an ID from this list is accepted. Asking for a free-form command here would put an
  // unvetted string on a path to a real shell; a catalog id cannot express anything the
  // catalog has not already been reviewed for.
  // An optional directive gets under-used. Measured: asked "sistem yükü nedir ve hangi işlem
  // sorumlu", the panel answered the first half from `uptime` and hedged the second with
  // "genellikle CPU yoğunluğu yapan süreçlerdir" — while `ps_cpu` sat in the candidate list
  // and would have answered it exactly. The hedge IS the signal that the evidence fell short,
  // so the rule is tied to that instead of left to taste.
  return base
    + `\n\nKANIT görevin sorusunu TAM cevaplamıyorsa (bir kısmını tahmin/genelleme ile geçiştiriyorsan),`
    + ` son satıra MUTLAKA şunu ekle:\n`
    + `FOLLOWUP: <id>\n`
    + `Yalnız şu id'ler geçerlidir: ${followupIds.join(", ")}\n`
    + `Kanıt soruyu tam cevaplıyorsa FOLLOWUP satırını hiç yazma.`;
}

/**
 * Parse a `FOLLOWUP: <id>` line. PURE.
 *
 * An id outside `allowed` is dropped silently rather than passed along: a model naming a
 * command that is not in the catalog is exactly the case this design exists to refuse, and
 * treating it as an error would only tempt a caller into "handling" it.
 */
export function parseFollowup(answer: string, allowed: string[]): string | null {
  // Deliberately forgiving about SHAPE, strict about VALUE. The original demanded a line
  // containing exactly `FOLLOWUP: id`, which a model breaks by writing `**FOLLOWUP:** ps_cpu`,
  // or by ending the sentence with a period. Losing a valid signal to markdown emphasis is a
  // parser bug, not a model one — while an id outside `allowed` is still refused outright.
  const m = /FOLLOWUP\s*:?\s*\**\s*:?\s*([A-Za-z0-9_.-]+)/i.exec(String(answer ?? ""));
  if (!m) return null;
  const id = m[1].trim().replace(/[.,;:]+$/, "");
  return allowed.includes(id) ? id : null;
}

/** The FOLLOWUP directive is machinery, not part of the answer a human should read. */
export const stripFollowup = (answer: string): string =>
  String(answer ?? "")
    .replace(/^\s*[-*]?\s*\**\s*FOLLOWUP\s*:?\**.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * L44 — the dedicated follow-up decision.
 *
 * The in-band directive never fired. The panel's answers were normal and complete; every one
 * of them simply lacked the line. The cause is structural rather than a model quirk: the
 * directive is asked for in the USER message while askShared's SYSTEM message imposes a terse
 * contract ("SADECE… kısa ve net", "süsleme yapma"), and a model follows the system message.
 *
 * So the decision is asked separately, with its OWN system prompt and a one-word answer. That
 * removes all three suspects at once — no competing contract, no 1200-char truncation of a
 * trailing line, and an output too small to mis-parse. askShared is left untouched: its terse
 * contract exists for good reasons on the question-answering path.
 *
 * The decision is split in TWO. Asking one call to both judge completeness AND pick from 19
 * ids was measured and it is simply too much at once: prompt tuning moved the errors around
 * without removing them (a complete disk answer drew `df`, then `ps_tree`; a genuinely
 * incomplete one once produced the literal string "A"). Separating the judgement from the
 * selection made it exact — 12/12 correct across four cases, three runs each.
 *
 * The common case also got cheaper: a complete answer costs ONE small call, and the second is
 * only spent when there is actually something to select.
 */
export const COMPLETENESS_PROMPT =
  "Sen bir cevap denetçisisin. Tek işin: CEVAP, SORUNUN sorduğu HER ŞEYİ somut veriyle (sayı, isim, yol) söylüyor mu?\n"
  + "EKSIK say: sorulan bir parça hiç yok, ya da \"genellikle / tipik olarak / muhtemelen / çeşitli\" gibi bir genelleme somut verinin yerine geçmiş.\n"
  + "TAM say: sorulan her şey somut veriyle cevaplanmış.\n"
  + "SADECE tek kelime yaz: TAM veya EKSIK.";

export const PICK_PROMPT =
  "Sen bir komut seçicisin. Verilen EKSİĞİ kapatacak TEK komut id'sini seçersin.\n"
  + "SADECE listeden tek bir id yaz. Açıklama, cümle YAZMA.";

/** TAM/EKSIK verdict → is something still open? PURE. Anything unclear reads as complete. */
export function parseCompleteness(text: string): boolean {
  const t = String(text ?? "").trim().toUpperCase();
  // Turkish "EKSİK" folds to EKSIK; accept both, and require the word rather than a substring.
  return /\bEKS[İI]K\b/.test(t.replace(/İ/g, "I"));
}

/** One-word pick → a validated catalog id, or null. PURE. */
export function parseDecision(text: string, allowed: string[]): string | null {
  const first = String(text ?? "").trim().split(/\s+/)[0] ?? "";
  const id = first.replace(/^[`*"'\-]+|[`*"'.,;:]+$/g, "");
  if (!id || /^none$/i.test(id)) return null;
  return allowed.includes(id) ? id : null;
}

/**
 * Judge, then select. Returns null on anything unclear — a follow-up has to be earned, and
 * "the judge was ambiguous" is not a reason to run a command.
 *
 * `alreadyRun` ids are withheld from the picker: re-proposing the command that produced the
 * evidence is the most common wrong answer, and excluding it is more reliable than asking a
 * model not to.
 */
export async function decideFollowup(
  title: string, answer: string, allowed: string[],
  generate: (messages: { role: string; content: string }[]) => Promise<string>,
  alreadyRun: string[] = [],
): Promise<string | null> {
  const pool = allowed.filter((id) => !alreadyRun.includes(id));
  if (!pool.length || !answer.trim()) return null;
  try {
    const verdict = await generate([
      { role: "system", content: COMPLETENESS_PROMPT },
      { role: "user", content: `SORU: ${title}\n\nCEVAP:\n${answer}\n\nTek kelime:` },
    ]);
    if (!parseCompleteness(verdict)) return null; // complete → one round, no second call

    const pick = await generate([
      { role: "system", content: PICK_PROMPT },
      { role: "user", content: `SORU: ${title}\n\nEKSİK KALAN CEVAP:\n${answer}\n\nGEÇERLİ ID'LER:\n${pool.join(", ")}\n\nid:` },
    ]);
    return parseDecision(pick, pool);
  } catch {
    return null; // the judge being unavailable means one round, not a guessed command
  }
}

export interface SynthesisResult {
  answer: string;
  /** L42: a catalog id to run next, already validated against the catalog. */
  followup?: string | null;
  /** L44: which path produced it — the in-band directive, or the dedicated decision call. */
  followupVia?: "directive" | "decision";
  expert: string;
  scores?: Record<string, number>;
  veto?: SharedAskResult["veto"];
  degradedReasons?: Record<string, string>;
  /** True when the panel honestly reported it could not answer from the evidence. */
  abstained: boolean;
}

export type SynthesisDeps = Omit<SharedDeps, "recall" | "searchFacts" | "namespaces"> & {
  /** L44: the dedicated follow-up judge. Absent → in-band directive only (old behaviour). */
  decide?: (messages: { role: string; content: string }[]) => Promise<string>;
};

/**
 * Run the panel over a task's evidence. Returns null when there is nothing to synthesise —
 * every step gated or failed — because a conclusion drawn from no evidence is worse than none.
 *
 * Never throws: synthesis is the last stage of a background tick, and losing the raw evidence
 * because the summary step fell over would be the wrong trade.
 */
export async function synthesizeTask(
  title: string, results: StepResult[], deps: SynthesisDeps,
  followupIds: string[] = [], alreadyRun: string[] = [],
): Promise<SynthesisResult | null> {
  const sources = stepsAsSources(results);
  if (!sources.length) return null;

  try {
    const r = await askShared(synthesisQuestion(title, followupIds), {
      ...deps,
      namespaces: () => ["default"],
      // The evidence IS the retrieval. No store lookup: the panel must answer from what this
      // task actually observed, not from what the brain happens to remember about the words.
      recall: async () => sources as any,
      searchFacts: async () => [],
    } as SharedDeps);

    const raw = String(r.answer ?? "").trim();
    // Read the follow-up from ANY expert, winner first.
    //
    // Parsing only the winner put the decision through a popularity contest: an expert could
    // notice the evidence fell short and name a command, lose the vote on prose quality, and
    // the signal was discarded. Measured — asked "sistem yükü nedir ve hangi işlem sorumlu",
    // the winning answer hedged the second half with "genellikle CPU yoğunluğu yapan
    // süreçlerdir" while `ps_cpu` sat unused in the candidate list.
    //
    // Widening this adds no risk: the id is still validated against the catalog, and the
    // resulting step still goes through the same safety table as any other command.
    //
    // NOTE on truncation: expertAnswers is sliced to 1200 chars by askShared, so a directive on
    // the last line of a LOSING expert's long answer can be cut. The winner's `raw` is full, and
    // the decision call below does not depend on this path at all — so askShared is left
    // untouched rather than widened for a secondary route.
    let followup = followupIds.length
      ? parseFollowup(raw, followupIds)
        ?? Object.values(r.expertAnswers ?? {})
            .map((a) => parseFollowup(String(a), followupIds))
            .find((x): x is string => !!x)
        ?? null
      : null;
    let followupVia: SynthesisResult["followupVia"] = followup ? "directive" : undefined;
    const answer = stripFollowup(raw);

    // L44: nobody wrote the directive — ask directly, in a call built for exactly this question.
    if (!followup && followupIds.length && deps.decide && answer && !/BİLGİ_YOK|BILGI_YOK/.test(answer)) {
      followup = await decideFollowup(title, answer, followupIds, deps.decide, alreadyRun);
      if (followup) followupVia = "decision";
    }
    const abstained = !!r.abstained || !answer || /BİLGİ_YOK|BILGI_YOK/.test(answer);
    return {
      answer, expert: r.expert ?? "", scores: r.scores, veto: r.veto,
      degradedReasons: r.degradedReasons, abstained, followup, followupVia,
    };
  } catch {
    return null;
  }
}
