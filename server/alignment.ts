// alignment (pure resolver + thin load) — runtime wiring for the Constitutional-Alignment "-ca" model variants.
//
// The align harness (orchestration/bin/align.ts) builds "<base>-ca" variants + writes ALIGNMENT_SELECTION.json.
// Until now they were BUILD ARTIFACTS ONLY — nothing at runtime used them. This maps a requested local model
// tag to its aligned variant, but only under three gates so the default is a pure no-op:
//   1. env-gated   — off unless OLLAMAS_ALIGN is truthy (default behaviour is unchanged).
//   2. regression-gated — only a variant whose conformance regression check passed is ever substituted.
//   3. existence-gated  — if the caller supplies the set of installed tags and the variant isn't there, keep
//                          the base (never dispatch a model tag that ollama doesn't have).
// IO-free core → unit-tested; the thin JSON load is separated.

import { readFileSync } from "node:fs";

export interface AlignmentSelection { map: Record<string, string> }

/** True when the alignment wiring is enabled via env (default OFF). */
export function alignmentEnabled(env: Record<string, string | undefined>): boolean {
  const v = (env.OLLAMAS_ALIGN ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Build the base→aligned map from ALIGNMENT_SELECTION.json, including ONLY regression-clean variants. */
export function parseAlignmentSelection(json: unknown): AlignmentSelection {
  const map: Record<string, string> = {};
  const variants = (json as any)?.variants;
  if (Array.isArray(variants)) {
    for (const v of variants) {
      if (v && typeof v.base === "string" && typeof v.aligned === "string" && v.regression?.ok === true) {
        map[v.base] = v.aligned;
      }
    }
  }
  return { map };
}

/** Resolve a requested model to its aligned variant, honoring all three gates. Pure. `have` (optional) is the
 *  set of installed ollama tags; a variant absent from it falls back to the base. Tolerates a ":latest" suffix. */
export function resolveAlignedModel(
  model: string,
  sel: AlignmentSelection,
  opts: { enabled: boolean; have?: Set<string> },
): string {
  if (!opts.enabled) return model;
  const aligned = sel.map[model];
  if (!aligned) return model;
  if (opts.have && !(opts.have.has(aligned) || opts.have.has(`${aligned}:latest`))) return model;
  return aligned;
}

/** Load + parse ALIGNMENT_SELECTION.json; a missing/corrupt file yields an empty (no-op) selection. */
export function loadAlignmentSelection(path: string): AlignmentSelection {
  try { return parseAlignmentSelection(JSON.parse(readFileSync(path, "utf8"))); }
  catch { return { map: {} }; }
}
