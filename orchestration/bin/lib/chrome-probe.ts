// chrome-probe (pure) — classify whether ONE model's dispatch run actually opened Google Chrome.
// IO-free → unit-tested. The CLI (bin/chrome-probe.ts) does the sequential dispatch + file writing.
//
// Why: the operator wants to hand every model the SAME task ("open Google Chrome") one-by-one and learn
// which models are capable. Opening Chrome is done via the privileged `macos_terminal` tool (or the safe
// `run_command`) running `open -a "Google Chrome"`. A model is "capable" only when it drove a shell tool
// successfully AND asserted a DONE/OK verdict AND wasn't a demo/no-tool run. This module encodes that
// judgment deterministically so the capability matrix is evidence-based, not guessed.

export type ChromeProvider = "ollama-local" | "ollama-cloud";

// Shell-running tools that can execute `open -a "Google Chrome"`. macos_terminal = privileged (visible
// terminal); run_command = safe (sandboxed). Either counts as an opener attempt.
export const SHELL_TOOLS = ["macos_terminal", "run_command"] as const;

export interface DispatchStep { n?: number; tool: string; ok: boolean; out?: string }
export interface DispatchReport {
  model?: string;
  steps?: DispatchStep[];
  messages?: string[];
  errors?: string[];
  demoSuspected?: boolean;
  verdict?: string;
}

export interface ChromeClassification {
  calledOpener: boolean;   // model invoked a shell tool at all (attempted the task)
  openerOk: boolean;       // a shell-tool step succeeded (ok === true)
  verdict: string;         // DONE | OK | BLOCKED | INCOMPLETE (from the run)
  capable: boolean;        // the model actually opened Chrome (see rule below)
  proof: string;           // short evidence line (final message or first successful shell output)
}

export interface ChromeProbeRow extends ChromeClassification {
  model: string;
  provider: ChromeProvider;
}

/** Provider for a model tag: cloud tags (…-cloud / …:cloud) go to ollama-cloud, everything else local. */
export function providerFor(model: string): ChromeProvider {
  return /-cloud\b|:cloud\b|cloud$/.test(model) ? "ollama-cloud" : "ollama-local";
}

/** A step that opened (or tried to open) Chrome: a shell-running tool that SUCCEEDED. The probe's only
 *  task is open-Chrome, so a successful shell call is the opener. `out` text is used for proof, not the
 *  capability decision (pgrep/open emit little or no matchable text). */
export function isOpenerStep(step: DispatchStep | undefined | null): boolean {
  return !!step && (SHELL_TOOLS as readonly string[]).includes(step.tool) && step.ok === true;
}

/** Does a text blob look Chrome-related? Used only to enrich the proof line. */
export function looksLikeChrome(text: string | undefined): boolean {
  return !!text && /google chrome|open\s+-a|(?:^|\W)chrome(?:\W|$)/i.test(text);
}

/** Classify one dispatch report into a Chrome-open capability verdict. Deterministic, IO-free.
 *  capable = a shell-tool step succeeded AND the run's verdict is DONE/OK AND it wasn't a demo run. */
export function classifyChromeRun(report: DispatchReport): ChromeClassification {
  const steps = report.steps ?? [];
  const calledOpener = steps.some((s) => (SHELL_TOOLS as readonly string[]).includes(s.tool));
  const openerOk = steps.some(isOpenerStep);
  const verdict = report.verdict ?? "INCOMPLETE";
  const demo = report.demoSuspected === true;
  const capable = openerOk && (verdict === "DONE" || verdict === "OK") && !demo;

  const finalMsg = (report.messages ?? []).filter((m) => m && m.trim()).pop() ?? "";
  const okShellOut = steps.find((s) => isOpenerStep(s) && (s.out ?? "").trim())?.out ?? "";
  const errLine = (report.errors ?? []).join(" | ");
  const proof = (finalMsg || okShellOut || errLine || (demo ? "demo/no-tool run" : "no output"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return { calledOpener, openerOk, verdict, capable, proof };
}

/** Build a full row (model + provider + classification) for one report. */
export function buildRow(model: string, report: DispatchReport): ChromeProbeRow {
  return { model, provider: providerFor(model), ...classifyChromeRun(report) };
}

const yn = (b: boolean) => (b ? "✅" : "—");

/** Render the capability matrix as Markdown: one row per model, ordered as given (sequential run order). */
export function renderChromeProbe(rows: ChromeProbeRow[], ts: string): string {
  const capable = rows.filter((r) => r.capable);
  const L: string[] = [
    `# CHROME_PROBE.md — "open Google Chrome" capability matrix (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/chrome-probe.ts\` · ${ts}. Each model was handed the SAME task —`,
    `> open Google Chrome via a terminal command — one-by-one (sequential; single-GPU truth). "Capable"`,
    `> = a shell tool ran successfully AND the run reached a DONE/OK verdict (not a demo/no-tool reply).`,
    ``,
    `## Result: ${capable.length}/${rows.length} models opened Chrome`,
    ``,
    `| # | Model | Provider | Called shell | Shell ok | Verdict | **Capable** | Proof |`,
    `|---|-------|----------|--------------|----------|---------|-------------|-------|`,
    ...rows.map((r, i) =>
      `| ${i + 1} | \`${r.model}\` | ${r.provider} | ${yn(r.calledOpener)} | ${yn(r.openerOk)} | ${r.verdict} | ${r.capable ? "**✅ YES**" : "❌ no"} | ${r.proof.replace(/\|/g, "\\|").slice(0, 90)} |`
    ),
    ``,
    `## Capable models (${capable.length})`,
    ...(capable.length ? capable.map((r) => `- \`${r.model}\` (${r.provider})`) : ["- (none)"]),
    ``,
    `## Ethics`,
    `> Opening Chrome runs on the operator's OWN Mac and was explicitly requested — the operator's request`,
    `> IS the gate for the privileged \`macos_terminal\` tier. Bounded (per-model timeout, sequential, no`,
    `> loop). No mass targeting, no other host. \`open -a\` is idempotent (focuses if already open).`,
  ];
  return L.join("\n");
}
