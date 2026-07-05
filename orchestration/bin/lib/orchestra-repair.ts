/**
 * orchestration/bin/lib/orchestra-repair.ts — PURE helpers for the conductor's REPAIR phase (JUstdoit STEP 4).
 *
 * The conductor turns a REPAIR into a real, gated, applied fix by acting as a normal fleet worker: it grounds
 * the local model on a stream's focus file, gets a SEARCH/REPLACE proposal, and writes it to the fleet
 * work-dir as `<stream>.orchestra/PROPOSAL.md` — which `fleet-apply.ts --apply` then triages + gates exactly
 * like any gemini/claude proposal. These pure fns pick the stream + format the proposal header (no IO here).
 */

/** Order candidate streams: any the task text explicitly names first (user intent), then the rest (stable). */
export function orderStreams(task: string | null | undefined, streams: string[]): string[] {
  const t = (task ?? "").toLowerCase();
  const named = streams.filter((s) => t.includes(s.toLowerCase()));
  const rest = streams.filter((s) => !named.includes(s));
  return [...named, ...rest];
}

/** The fleet slot the conductor writes under (mirrors gemini-run's `<stream>.gemini`). */
export const ORCHESTRA_SLOT = "orchestra";

/** PROPOSAL.md header line `fleet-apply` parses for the model (`# <stream> · <slot> · <model>`). */
export function proposalHeader(stream: string, model: string): string {
  return `# ${stream} · ${ORCHESTRA_SLOT} · ${model}`;
}

/** The `<stream>.<slot>` token passed to `fleet-apply.ts --apply`. */
export function applyToken(stream: string): string {
  return `${stream}.${ORCHESTRA_SLOT}`;
}
