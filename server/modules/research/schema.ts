// O2 research module — wire types + input validation (honest 400 before any
// work). Mirrors server/modules/cookbook/schema.ts.
import type { Citation } from "../../research/report";
import type { SourceSummary } from "../../research/summarize";
import type { RoundRecord } from "../../research/engine";

export interface ResearchInput {
  question: string;
  deep: boolean;
}

/** Validate a POST /run body. Requires a non-empty question string. */
export function parseResearchInput(body: unknown): ResearchInput {
  const question = (body as { question?: unknown })?.question;
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error("field 'question' must be a non-empty string");
  }
  const deep = (body as { deep?: unknown })?.deep === true;
  return { question: question.trim(), deep };
}

export interface ResearchApiResult {
  runId: string;
  question: string;
  report: string;
  citations: Citation[];
  sources: SourceSummary[];
  rounds: RoundRecord[];
}

export interface ResearchRunListItem {
  id: string;
  question: string;
  created_at: string;
}
