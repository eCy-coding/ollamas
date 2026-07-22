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

/** The task's question restated for the panel, with the evidence contract spelled out. */
export function synthesisQuestion(title: string): string {
  return `GÖREV: ${title}\n\n`
    + `Yukarıdaki görevi yürüten üyelerin HAM çıktıları KAYNAK olarak verildi. `
    + `Görevin sorusunu SADECE bu kanıta dayanarak, tek paragrafta ve somut sayılarla cevapla. `
    + `Kanıtta cevap yoksa BİLGİ_YOK yaz.`;
}

export interface SynthesisResult {
  answer: string;
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
): Promise<SynthesisResult | null> {
  const sources = stepsAsSources(results);
  if (!sources.length) return null;

  try {
    const r = await askShared(synthesisQuestion(title), {
      ...deps,
      namespaces: () => ["default"],
      // The evidence IS the retrieval. No store lookup: the panel must answer from what this
      // task actually observed, not from what the brain happens to remember about the words.
      recall: async () => sources as any,
      searchFacts: async () => [],
    } as SharedDeps);

    const answer = String(r.answer ?? "").trim();
    const abstained = !!r.abstained || !answer || /BİLGİ_YOK|BILGI_YOK/.test(answer);
    return {
      answer, expert: r.expert ?? "", scores: r.scores, veto: r.veto,
      degradedReasons: r.degradedReasons, abstained,
    };
  } catch {
    return null;
  }
}
