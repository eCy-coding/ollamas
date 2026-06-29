// Pure council-calibration scoring. A "council" = several local models each attempting
// the same auto-verifiable tasks; we score combination policies (single / best-of-N /
// majority) to find the cheapest combination that reaches the max correctness rate.

export interface CouncilResult { model: string; taskId: string; correct: boolean; unavailable?: boolean }
export interface PerModel { model: string; correct: number; total: number; rate: number; }
export interface CouncilScore {
  perModel: PerModel[];
  singleBest: { model: string; rate: number } | null;
  bestOfN: number;   // fraction of tasks ANY model got right
  majority: number;  // fraction of tasks where >= half the models got it
  recommended: { policy: "single" | "best-of-n" | "majority"; detail: string };
  unavailable: string[]; // members that never ran (e.g. gemini-cli binary absent) — excluded from scoring
}

// Normalize a model response then test whether the ground-truth answer is present.
// Strips <think>...</think> reasoning blocks, ``` code fences, and surrounding whitespace,
// then matches the answer as a standalone token/substring (case-insensitive, trimmed).
export function checkAnswer(response: string, answer: string): boolean {
  if (response == null || answer == null) return false;
  let s = String(response);
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, " ");   // drop reasoning trace
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*|```/gi, " ")); // unwrap fences (keep inner)
  s = s.replace(/[`*_>#]/g, " ").trim();
  const a = String(answer).trim();
  if (!a) return false;
  // exact-ish: the answer appears as a contiguous run (so "-1" matches but not inside "31")
  // use word-ish boundaries around non-alnum-delimited answer
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.-])${esc}([^\\w.-]|$)`).test(" " + s + " ");
}

export function scoreCouncil(results: CouncilResult[]): CouncilScore {
  const raw = Array.isArray(results) ? results : [];
  // A member whose results are all `unavailable` never ran (e.g. gemini-cli binary absent) —
  // exclude it so it is neither a misleading 0% nor a drag on the union/majority.
  const unavailable = [...new Set(raw.filter((r) => r.unavailable).map((r) => r.model))]
    .filter((m) => !raw.some((r) => r.model === m && !r.unavailable));
  const rs = raw.filter((r) => !r.unavailable);
  const models = [...new Set(rs.map((r) => r.model))];
  const tasks = [...new Set(rs.map((r) => r.taskId))];
  const perModel: PerModel[] = models.map((m) => {
    const mine = rs.filter((r) => r.model === m);
    const correct = mine.filter((r) => r.correct).length;
    return { model: m, correct, total: mine.length, rate: mine.length ? correct / mine.length : 0 };
  }).sort((a, b) => b.rate - a.rate);
  const singleBest = perModel[0] ? { model: perModel[0].model, rate: perModel[0].rate } : null;
  // per-task: did ANY / a MAJORITY of models get it?
  let anyCount = 0, majCount = 0;
  for (const t of tasks) {
    const forTask = rs.filter((r) => r.taskId === t);
    const got = forTask.filter((r) => r.correct).length;
    if (got > 0) anyCount++;
    if (forTask.length > 0 && got * 2 >= forTask.length) majCount++;
  }
  const bestOfN = tasks.length ? anyCount / tasks.length : 0;
  const majority = tasks.length ? majCount / tasks.length : 0;
  const sb = singleBest?.rate ?? 0;
  const maxRate = Math.max(sb, bestOfN, majority);
  // cheapest policy reaching the max: prefer single (1x cost) when it ties (ensembleGain NONE).
  let recommended: CouncilScore["recommended"];
  if (sb >= maxRate) recommended = { policy: "single", detail: `${singleBest?.model ?? "?"} @ ${Math.round(sb * 100)}% (no ensemble cost)` };
  else if (majority >= maxRate) recommended = { policy: "majority", detail: `majority-vote @ ${Math.round(majority * 100)}%` };
  else recommended = { policy: "best-of-n", detail: `best-of-${models.length} @ ${Math.round(bestOfN * 100)}%` };
  return { perModel, singleBest, bestOfN, majority, recommended, unavailable };
}
