// council (pure) — lane-analysis prompt building + deterministic finding parsing + synthesis.
//
// The CLI (bin/council.ts) does the IO (gather lane context, dispatch models via
// POST /api/ai/generate, run oracle). This module is IO-free so every transform is unit-tested.
//
// Protocol: each analyst model answers a lane-analysis prompt in a STRICT line format so parsing
// is deterministic (no fuzzy NLP). Lines the model emits:
//   LANG: <languages / stacks the lane needs work in>
//   TASK: <one concrete coding task to advance the lane>   (repeatable)
//   RISK: <a bug / risk / debt, if any>                    (repeatable)
// Anything else (prose, <think> traces) is ignored.

export interface LaneContext {
  lane: string;
  files: string[];        // representative file paths in the lane
  loc: number;            // total lines of code (rough)
  langs: string[];        // detected languages (ext-based)
  excerpt: string;        // a few key file heads, truncated
}

export interface Finding {
  lane: string;
  model: string;
  kind: "LANG" | "TASK" | "RISK";
  text: string;
}

export interface LaneResult {
  lane: string;
  model: string;
  ok: boolean;            // model responded (non-empty)
  findings: Finding[];
  tokPerSec?: number;
  ms?: number;
  error?: string;
}

/** Build the strict-format analysis prompt for one lane + seat. */
export function buildLanePrompt(ctx: LaneContext): string {
  const files = ctx.files.slice(0, 40).join("\n");
  return [
    `You are analysing the "${ctx.lane}" lane of the ollamas project (a zero-dependency TypeScript`,
    `local-LLM coding-agent + MCP gateway). Goal: determine WHICH programming-language work and`,
    `WHAT concrete coding is needed to advance this lane.`,
    ``,
    `Lane facts: ~${ctx.loc} LOC, languages: ${ctx.langs.join(", ") || "unknown"}.`,
    `Files:`,
    files,
    ``,
    ctx.excerpt ? `Key excerpts:\n${ctx.excerpt}\n` : "",
    `Answer ONLY in this strict line format (no prose, no markdown, no code fences):`,
    `LANG: <languages/stacks that need work here>`,
    `TASK: <one concrete, specific coding task to advance this lane>`,
    `TASK: <another concrete task>`,
    `RISK: <a concrete bug, risk, or technical debt — omit the line if none>`,
    ``,
    `Be specific to THIS lane and to real code. Max 6 TASK lines.`,
  ].filter((l) => l !== undefined).join("\n");
}

/** Parse a model response into structured findings (deterministic; strips <think> + fences). */
export function parseFindings(lane: string, model: string, response: string): Finding[] {
  if (!response) return [];
  let s = String(response)
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ");
  const out: Finding[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/^[\s>*\-#]+/, "").trim();
    const m = /^(LANG|TASK|RISK)\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const kind = m[1].toUpperCase() as Finding["kind"];
    const text = m[2].trim().replace(/\s+/g, " ").slice(0, 240);
    if (text) out.push({ lane, model, kind, text });
  }
  return out;
}

/** Per-lane consensus vote: how many responding seats agree there is actionable work here. */
export interface LaneVote {
  lane: string;
  participating: number;  // seats that responded (ok) for this lane
  agreeing: number;       // seats that produced ≥1 TASK/RISK (i.e. "there is work")
  confidence: number;     // agreeing / participating (0 when no participants)
  decision: "EXECUTE" | "HOLD";
}

/** Weighted-majority quorum threshold (JUstdoit STEP 2): >0.6 responding seats agree → EXECUTE. */
export const COUNCIL_QUORUM = 0.6;

export interface CouncilSummary {
  lanes: string[];
  totalFindings: number;
  byLane: { lane: string; tasks: number; risks: number; langs: string[]; models: string[] }[];
  respondedModels: string[];
  silentLanes: string[];  // lanes where NO model produced a finding (surfaced, not hidden)
  votes: LaneVote[];      // per-lane consensus tally
  decision: "EXECUTE" | "HOLD"; // global: EXECUTE if any lane clears quorum, else HOLD (Orchestrator override-safe)
}

/**
 * Per-lane weighted vote. A seat "agrees there is work" when it produced ≥1 TASK/RISK finding. A lane clears
 * quorum when the agreeing fraction of RESPONDING seats exceeds COUNCIL_QUORUM. No participants → HOLD (a tie
 * or an all-silent lane defaults to HOLD, i.e. the Chief Orchestrator's safe override — never act on silence).
 */
export function tallyVotes(results: LaneResult[]): LaneVote[] {
  const rs = Array.isArray(results) ? results : [];
  const lanes = [...new Set(rs.map((r) => r.lane))];
  return lanes.map((lane) => {
    const forLane = rs.filter((r) => r.lane === lane && r.ok);
    const participating = forLane.length;
    const agreeing = forLane.filter((r) => r.findings.some((f) => f.kind === "TASK" || f.kind === "RISK")).length;
    const confidence = participating > 0 ? agreeing / participating : 0;
    return { lane, participating, agreeing, confidence, decision: confidence > COUNCIL_QUORUM ? "EXECUTE" : "HOLD" };
  });
}

/** Aggregate lane results into a synthesis summary + consensus decision. */
export function summarizeCouncil(results: LaneResult[]): CouncilSummary {
  const rs = Array.isArray(results) ? results : [];
  const lanes = [...new Set(rs.map((r) => r.lane))];
  const byLane = lanes.map((lane) => {
    const forLane = rs.filter((r) => r.lane === lane);
    const findings = forLane.flatMap((r) => r.findings);
    const langs = [...new Set(findings.filter((f) => f.kind === "LANG").map((f) => f.text))];
    return {
      lane,
      tasks: findings.filter((f) => f.kind === "TASK").length,
      risks: findings.filter((f) => f.kind === "RISK").length,
      langs,
      models: [...new Set(forLane.filter((r) => r.ok).map((r) => r.model))],
    };
  });
  const totalFindings = rs.reduce((n, r) => n + r.findings.length, 0);
  const respondedModels = [...new Set(rs.filter((r) => r.ok).map((r) => r.model))];
  const silentLanes = byLane.filter((l) => l.tasks + l.risks === 0).map((l) => l.lane);
  const votes = tallyVotes(rs);
  const decision: "EXECUTE" | "HOLD" = votes.some((v) => v.decision === "EXECUTE") ? "EXECUTE" : "HOLD";
  return { lanes, totalFindings, byLane, respondedModels, silentLanes, votes, decision };
}

/** Extract oracle-checkable claims from findings (arithmetic/logic/ordering only). RISK/TASK prose
 *  is largely UNDECIDABLE by design — we only forward claims the deterministic oracle can adjudicate. */
export function checkableClaims(findings: Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    // a finding is oracle-checkable only if it states an arithmetic/logic proposition
    if (/[0-9].*[=<>].*[0-9]/.test(f.text) || /\b(and|or|not|iff|implies)\b/i.test(f.text)) {
      out.push(f.text);
    }
  }
  return [...new Set(out)];
}
