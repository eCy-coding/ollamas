// chrome-probe (pure) — classify whether ONE model's dispatch run actually opened Google Chrome.
// IO-free → unit-tested. The CLI (bin/chrome-probe.ts) does the sequential dispatch + file writing.
//
// Why: the operator wants to hand every model the SAME task ("open Google Chrome") one-by-one and learn
// which models are capable. Opening Chrome is done via the privileged `macos_terminal` tool (or the safe
// `run_command`) running `open -a "Google Chrome"`. A model is "capable" only when it drove a shell tool
// successfully AND asserted a DONE/OK verdict AND wasn't a demo/no-tool run. This module encodes that
// judgment deterministically so the capability matrix is evidence-based, not guessed.

import { isGeminiModel } from "./gemini";

export type ChromeProvider = "ollama-local" | "ollama-cloud" | "gemini-cli";

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

/** Provider for a model tag: gemini tags → gemini-cli; cloud tags (…-cloud / …:cloud) → ollama-cloud;
 *  everything else → ollama-local. */
export function providerFor(model: string): ChromeProvider {
  if (isGeminiModel(model)) return "gemini-cli";
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

// ── shortcuts task (vO34): score whether a model named the real Chrome dev/AI keyboard shortcuts ──────
//
// The operator's follow-up task is "find the keyboard shortcuts an AI/developer uses to drive Chrome".
// A model's answer is scored against this canonical macOS Chrome ground-truth: how many real shortcuts
// did it name? Extraction + normalization + scoring are pure so they're unit-tested; the CLI feeds the
// model's full textual output (report.messages joined) in.

export interface ChromeShortcut { combo: string; purpose: string }

/** Canonical macOS Chrome shortcuts a developer/AI uses to drive the browser. Combos are already in the
 *  normalizeShortcut canonical form ("Cmd+Opt+I") so scoring compares like-for-like. */
export const CHROME_SHORTCUTS: ChromeShortcut[] = [
  { combo: "Cmd+L", purpose: "focus the address bar (omnibox)" },
  { combo: "Cmd+T", purpose: "open a new tab" },
  { combo: "Cmd+W", purpose: "close the current tab" },
  { combo: "Cmd+Shift+T", purpose: "reopen the last closed tab" },
  { combo: "Cmd+R", purpose: "reload the page" },
  { combo: "Cmd+Shift+R", purpose: "hard reload (bypass cache)" },
  { combo: "Cmd+Opt+I", purpose: "open DevTools" },
  { combo: "Cmd+Opt+J", purpose: "open the JavaScript console" },
  { combo: "Cmd+Opt+C", purpose: "inspect element (element picker)" },
  { combo: "Cmd+Opt+U", purpose: "view page source" },
  { combo: "Cmd+F", purpose: "find in page" },
  { combo: "Cmd+Shift+N", purpose: "open an incognito window" },
  { combo: "Cmd+[", purpose: "go back" },
  { combo: "Cmd+]", purpose: "go forward" },
];

const MOD_MAP: Record<string, string> = {
  cmd: "Cmd", command: "Cmd", "⌘": "Cmd", meta: "Cmd", super: "Cmd",
  opt: "Opt", option: "Opt", alt: "Opt", "⌥": "Opt",
  shift: "Shift", "⇧": "Shift",
  ctrl: "Ctrl", control: "Ctrl", "⌃": "Ctrl",
};
const MOD_ORDER = ["Cmd", "Ctrl", "Opt", "Shift"]; // canonical modifier order

/** Canonicalize one shortcut string ("⌘⌥I", "Command+Option+I", "cmd + opt + i") → "Cmd+Opt+I".
 *  Returns "" when no recognizable key is present. */
export function normalizeShortcut(raw: string): string {
  if (!raw) return "";
  // Split glued glyph form (⌘⌥I) and delimited form (Cmd+Opt+I / cmd-opt-i) into tokens.
  const glyphSplit = raw.replace(/([⌘⌥⇧⌃])/g, " $1 ");
  const tokens = glyphSplit.split(/[\s+\-]+/).map((t) => t.trim()).filter(Boolean);
  const mods: string[] = [];
  let key = "";
  for (const tok of tokens) {
    const m = MOD_MAP[tok.toLowerCase()];
    if (m) { if (!mods.includes(m)) mods.push(m); continue; }
    // A key is a single alphanumeric or a bracket/punct like [ ] , . / that Chrome uses.
    if (/^[A-Za-z0-9]$/.test(tok)) key = tok.toUpperCase();
    else if (/^[[\],./;'`\\=-]$/.test(tok)) key = tok;
  }
  if (!key || !mods.length) return "";
  mods.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...mods, key].join("+");
}

// Matches shortcut-ish spans: at least one modifier (glyph or word) followed by a key, in glued or
// delimited form. Case-insensitive; the modifier word list mirrors MOD_MAP.
const SHORTCUT_RE =
  /(?:(?:⌘|⌥|⇧|⌃)+\s*[A-Za-z0-9[\],./;'`\\=-])|(?:(?:cmd|command|ctrl|control|opt|option|alt|shift)(?:\s*[+\-]\s*(?:cmd|command|ctrl|control|opt|option|alt|shift))*\s*[+\-]\s*[A-Za-z0-9[\],./;'`\\=-])/gi;

/** Extract all shortcut combos named anywhere in a text, returned in canonical form (deduped). */
export function extractShortcuts(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(SHORTCUT_RE)) {
    const norm = normalizeShortcut(m[0]);
    if (norm) out.add(norm);
  }
  return [...out];
}

export interface ShortcutScore { named: string[]; hits: string[]; hitCount: number; total: number }

/** Score a model's textual answer against the CHROME_SHORTCUTS ground-truth. `hits` = ground-truth combos
 *  the model correctly named; `named` = everything shortcut-shaped it produced (for transparency). */
export function scoreShortcuts(text: string): ShortcutScore {
  const named = extractShortcuts(text);
  const truth = new Set(CHROME_SHORTCUTS.map((s) => s.combo));
  const hits = named.filter((c) => truth.has(c));
  return { named, hits, hitCount: hits.length, total: CHROME_SHORTCUTS.length };
}

export interface ChromeShortcutRow extends ChromeProbeRow {
  shortcutHits: number;
  shortcutTotal: number;
  namedSample: string; // comma-joined canonical combos the model named (capped)
}

/** Build a shortcuts-task row: the open-Chrome capability (reused) + the shortcut score from full text. */
export function buildShortcutRow(model: string, report: DispatchReport, fullText: string): ChromeShortcutRow {
  const base = buildRow(model, report);
  const score = scoreShortcuts(fullText);
  return { ...base, shortcutHits: score.hitCount, shortcutTotal: score.total, namedSample: score.hits.join(", ").slice(0, 80) };
}

/** Render the shortcuts capability+knowledge matrix: which models opened Chrome AND named real shortcuts. */
export function renderShortcutsProbe(rows: ChromeShortcutRow[], ts: string): string {
  const opened = rows.filter((r) => r.capable);
  const knew = rows.filter((r) => r.shortcutHits > 0);
  const L: string[] = [
    `# CHROME_SHORTCUTS.md — "find the dev/AI keyboard shortcuts to drive Chrome" probe (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/chrome-probe.ts --task shortcuts\` · ${ts}. Each model was handed the`,
    `> SAME task one-by-one (sequential; single-GPU truth): open Google Chrome AND list the keyboard`,
    `> shortcuts a developer/AI uses to control it. "Opened" = a shell tool ran + DONE/OK (not a demo).`,
    `> "Shortcuts" = how many of the ${CHROME_SHORTCUTS.length} canonical Chrome shortcuts it correctly named.`,
    ``,
    `## Result: ${opened.length}/${rows.length} opened Chrome · ${knew.length}/${rows.length} named ≥1 real shortcut`,
    ``,
    `| # | Model | Provider | Opened | Verdict | Shortcuts (hit/total) | Named (canonical) |`,
    `|---|-------|----------|--------|---------|-----------------------|-------------------|`,
    ...rows.map((r, i) =>
      `| ${i + 1} | \`${r.model}\` | ${r.provider} | ${r.capable ? "✅" : "❌"} | ${r.verdict} | ${r.shortcutHits}/${r.shortcutTotal} | ${(r.namedSample || "—").replace(/\|/g, "\\|")} |`
    ),
    ``,
    `## Ground-truth shortcuts (${CHROME_SHORTCUTS.length})`,
    ...CHROME_SHORTCUTS.map((s) => `- \`${s.combo}\` — ${s.purpose}`),
    ``,
    `## Ethics`,
    `> Same bound as /chrome-probe: opening Chrome is on the operator's OWN Mac and explicitly requested`,
    `> (the request IS the gate for the privileged \`macos_terminal\` tier). The task only LISTS shortcuts`,
    `> (knowledge) + opens Chrome — it injects no keystrokes. Bounded (per-model timeout, sequential).`,
  ];
  return L.join("\n");
}
