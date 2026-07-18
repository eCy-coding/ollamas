// Brain write-path hygiene (S24) — secrets must never PERSIST in brain.db. The
// retain loop writes every user+assistant exchange and git-capture writes diffs'
// subjects, so a pasted API key would otherwise live in the operator's memory
// (and its embedding) forever, surviving into backups and exports too.
//
// Detection REUSES the choke-point rules (server/tool-interceptors.ts redactString:
// gitleaks/secretlint-adopted, high-precision) — one rule set for the whole repo,
// no drift. This module adds: hit accounting, an opt-in email mask, and the
// enforcement-mode contract for the ONE brain enforcement point (rememberOne —
// every write path funnels through it: retain, distill, capture, mirror, ingest,
// import, HTTP remember).
//   BRAIN_REDACT=enforce (default) → persist + embed the MASKED text
//   BRAIN_REDACT=report            → persist raw, log the hit count (migration aid)
//   BRAIN_REDACT=0                 → off
import { redactString } from "./tool-interceptors";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const MARKER = /\*\*\*REDACTED/g;

export type RedactMode = "enforce" | "report" | "off";

export function resolveRedactMode(env: { BRAIN_REDACT?: string } = process.env): RedactMode {
  const v = env.BRAIN_REDACT;
  if (v === "0" || v === "off") return "off";
  if (v === "report") return "report";
  return "enforce";
}

export interface BrainRedaction {
  /** Text to persist+embed under the resolved mode (masked only when enforcing). */
  text: string;
  /** Number of masked spans the detector found (0 = clean). */
  hits: number;
  mode: RedactMode;
}

/** Pure: detect+mask secrets in one memory content string. Never throws — a
 *  detector failure returns the raw text (availability over hygiene), because a
 *  broken regex must not take the whole write path down with it. */
export function redactForBrain(
  raw: string,
  env: { BRAIN_REDACT?: string; BRAIN_REDACT_EMAIL?: string } = process.env,
): BrainRedaction {
  const mode = resolveRedactMode(env);
  if (mode === "off" || !raw) return { text: raw, hits: 0, mode };
  try {
    let masked = redactString(raw);
    if (env.BRAIN_REDACT_EMAIL === "1") masked = masked.replace(EMAIL_RE, "***REDACTED:email***");
    const hits = (masked.match(MARKER)?.length ?? 0) - (raw.match(MARKER)?.length ?? 0);
    if (hits <= 0) return { text: raw, hits: 0, mode };
    return { text: mode === "enforce" ? masked : raw, hits, mode };
  } catch {
    return { text: raw, hits: 0, mode };
  }
}
