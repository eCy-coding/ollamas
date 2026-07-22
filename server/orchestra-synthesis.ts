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
  const m = /^\s*FOLLOWUP:\s*([A-Za-z0-9_.\-]+)\s*$/m.exec(String(answer ?? ""));
  if (!m) return null;
  const id = m[1].trim();
  return allowed.includes(id) ? id : null;
}

/** The FOLLOWUP directive is machinery, not part of the answer a human should read. */
export const stripFollowup = (answer: string): string =>
  String(answer ?? "").replace(/^\s*FOLLOWUP:.*$/gm, "").trim();

export interface SynthesisResult {
  answer: string;
  /** L42: a catalog id the panel asked to run next, already validated against the catalog. */
  followup?: string | null;
  expert: string;
  scores?: Record<string, number>;
  veto?: SharedAskResult["veto"];
  degradedReasons?: Record<string, string>;
  /** True when the panel honestly reported it could not answer from the evidence. */
  abstained: boolean;
}

export type SynthesisDeps = Omit<SharedDeps, "recall" | "searchFacts" | "namespaces">;

/**
 * Run the panel over a task's evidence. Returns null when there is nothing to synthesise —
 * every step gated or failed — because a conclusion drawn from no evidence is worse than none.
 *
 * Never throws: synthesis is the last stage of a background tick, and losing the raw evidence
 * because the summary step fell over would be the wrong trade.
 */
export async function synthesizeTask(
  title: string, results: StepResult[], deps: SynthesisDeps,
  followupIds: string[] = [],
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
    const followup = followupIds.length
      ? parseFollowup(raw, followupIds)
        ?? Object.values(r.expertAnswers ?? {})
            .map((a) => parseFollowup(String(a), followupIds))
            .find((x): x is string => !!x)
        ?? null
      : null;
    const answer = stripFollowup(raw);
    const abstained = !!r.abstained || !answer || /BİLGİ_YOK|BILGI_YOK/.test(answer);
    return {
      answer, expert: r.expert ?? "", scores: r.scores, veto: r.veto,
      degradedReasons: r.degradedReasons, abstained, followup,
    };
  } catch {
    return null;
  }
}
