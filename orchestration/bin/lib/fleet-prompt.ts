// fleet-prompt (pure) — the PROPOSE-only worker task prompts, shared by every dispatch backend. IO-free →
// unit-tested. Extracted from fleet-agent so the Gemini path (gemini-run --propose, geminiDispatch) reuses
// the exact same FOCUS map + prompt shape instead of duplicating it.
//
// Two prompt flavors:
//  - streamTaskPrompt: for tool-using agents (ollama) — instructs the model to read_file the target itself.
//  - geminiGroundedPrompt: INLINES a bounded window of the target file so the model copies EXACT lines into
//    the SEARCH block (deterministic → resolvable). Proven live: Gemini flash returns a clean apply-ready SR
//    when the content is inlined (no dependency on the model's own file-read, no hallucinated SEARCH).

/** Narrowed single-file focus per stream (docs/CODE_PLAN.md P1). Small scope = weak models finish. */
export const FOCUS: Record<string, string> = {
  "typescript-core": "server/analyzer.ts — fix tool-implementation validation (entryPoint existence check)",
  "errors-resilience": "server/agent-events.ts — add SSE stream error handling + timeout",
  "concurrency-safety": "server/host-bridge.ts — guard concurrent MCP client connections",
  "mjs-migration": "scripts/agent-dispatch.mjs — add a .ts type-def / migration shim",
  "shell-harden": "start.sh — add set -euo pipefail + required-env guard",
  "test-coverage": "cli/lib/client.ts — add a unit test for HTTP request handling",
};

/** The per-stream target file (before the " — " description). Reading it DIRECTLY beats list_tree. */
export function focusFile(stream: string): string {
  const f = FOCUS[stream] ?? "";
  return f.split(/\s+[—-]\s+/)[0].trim(); // "start.sh — add …" → "start.sh"
}

/** The SEARCH/REPLACE proposal shape lines (shared tail of every prompt). */
function srShapeLines(target: string): string[] {
  return [
    `## Plan: <1-line plan of the change>`,
    `## Change: <one concrete high-value change to ${target || "the target file"}>`,
    `## Edit:`,
    `### file: ${target || "<workspace-relative path>"}`,
    `<<<<<<< SEARCH`,
    `<paste the exact existing lines to replace, copied verbatim>`,
    `=======`,
    `<the replacement lines>`,
    `>>>>>>> REPLACE`,
    `## Test: <the test that proves it>`,
    `## Next: <precompute — the 1-line NEXT step for this stream after this change lands>`,
    `Then end with: VERDICT: DONE. Keep the SEARCH minimal + unique. Evidence over prose.`,
  ];
}

/** Prompt for a tool-using agent (ollama): the model reads the target file itself. */
export function streamTaskPrompt(stream: string): string {
  const target = focusFile(stream);
  const goal = FOCUS[stream] ?? "one concrete high-value change for this stream";
  const readLine = target
    ? `The agent WORKSPACE is the ollamas repo. Call read_file "${target}" DIRECTLY (do NOT call list_tree — it floods context). Read that ONE file, then propose.`
    : `The agent WORKSPACE is the ollamas repo. read_file the single most relevant workspace-relative file for this stream, then propose (avoid list_tree — it floods context).`;
  return [
    `You are a PROPOSE-only worker for the ollamas project, stream "${stream}". Goal: ${goal}.`,
    readLine,
    `NEVER call write_file or write_host_file — the conductor applies your edit. Do NOT edit any file yourself.`,
    `Your FINAL MESSAGE must BE the proposal in this exact shape (nothing else — do NOT describe the repo).`,
    `Express the change as a SEARCH/REPLACE block: the SEARCH must be an EXACT, VERBATIM copy of lines from the`,
    `file you read (so it applies deterministically — do NOT use line numbers or a unified diff):`,
    ...srShapeLines(target),
  ].join("\n");
}

/** Grounded prompt (generic, explicit goal): the target file's content is inlined (bounded to `maxLines`) so
 *  the model copies EXACT lines into SEARCH — deterministic + resolvable. Used by the 100-task catalog and
 *  the Gemini vendor alike. `goalText` is the concrete change to make on `target`. */
export function groundedPrompt(goalText: string, target: string, fileContent: string, opts: { maxLines?: number } = {}): string {
  const maxLines = opts.maxLines ?? 400;
  const lines = (fileContent ?? "").split("\n");
  const window = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") + "\n… (truncated)" : (fileContent ?? "");
  return [
    `You are a PROPOSE-only worker for the ollamas project. Task: ${goalText || "one concrete high-value change"}.`,
    `Below is the EXACT current content of ${target}. Propose ONE small, high-value, behavior-preserving`,
    `additive change toward that task. Do NOT write any file — output ONLY the proposal in this exact shape:`,
    ...srShapeLines(target),
    `The SEARCH block MUST be an EXACT, VERBATIM copy of lines from the content below (no line numbers).`,
    ``,
    `--- BEGIN ${target} ---`,
    window,
    `--- END ${target} ---`,
  ].join("\n");
}

/** Stream-flavored grounded prompt (goal from the FOCUS map). Thin wrapper over groundedPrompt. */
export function geminiGroundedPrompt(stream: string, target: string, fileContent: string, opts: { maxLines?: number } = {}): string {
  return groundedPrompt(FOCUS[stream] ?? "one concrete high-value change for this stream", target, fileContent, opts);
}
