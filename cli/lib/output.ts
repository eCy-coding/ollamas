// TTY-aware output helpers. Pure functions where possible → unit-testable.
// Honors NO_COLOR (https://no-color.org) and --json. Color only on a real TTY.

const CODES: Record<string, string> = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

export interface OutputCtx {
  color: boolean;
  json: boolean;
}

// Decide whether to emit ANSI color. NO_COLOR or non-TTY or --json => no color.
export function shouldColor(opts: { noColor?: boolean; isTTY?: boolean; json?: boolean }): boolean {
  if (opts.json) return false;
  if (opts.noColor) return false;
  return !!opts.isTTY;
}

export function resolveOutputCtx(env: NodeJS.ProcessEnv, isTTY: boolean, json: boolean): OutputCtx {
  return { color: shouldColor({ noColor: !!env.NO_COLOR, isTTY, json }), json };
}

export function c(code: keyof typeof CODES, s: string, enabled: boolean): string {
  if (!enabled) return s;
  return `${CODES[code]}${s}${CODES.reset}`;
}

// Render the doctor health report. JSON mode => raw; else compact human lines.
export function formatDoctor(report: DoctorReport, ctx: OutputCtx): string {
  if (ctx.json) return JSON.stringify(report, null, 2);
  const ok = (b: boolean) => c(b ? "green" : "red", b ? "● up" : "● down", ctx.color);
  const row = (label: string, comp: { ok: boolean; detail: string }) =>
    `  ${label.padEnd(8)} ${ok(comp.ok)}  ${c("dim", comp.detail, ctx.color)}`;
  const lines = [
    c("bold", "ollamas doctor", ctx.color),
    row("gateway", report.gateway),
    row("ollama", report.ollama),
    row("bridge", report.bridge),
    row("ready", report.ready),
    row("agent", report.agent),
    "",
    report.healthy
      ? c("green", "healthy", ctx.color)
      : c("yellow", "degraded — see down components above", ctx.color),
  ];
  return lines.join("\n");
}

export interface DoctorReport {
  ts: string;
  healthy: boolean;
  gateway: { ok: boolean; detail: string };
  ollama: { ok: boolean; detail: string };
  bridge: { ok: boolean; detail: string };
  ready: { ok: boolean; detail: string };
  agent: { ok: boolean; detail: string };
}

// One line per agent tool step: tool · ok · latency · trimmed result/diff hint.
export function formatStep(ev: { stepNum?: number; tool?: string; ok?: boolean; latency?: number; diff?: string; applied?: boolean }, ctx: OutputCtx): string {
  const mark = c(ev.ok ? "green" : "red", ev.ok ? "✓" : "✗", ctx.color);
  const lat = typeof ev.latency === "number" ? c("dim", `${ev.latency}ms`, ctx.color) : "";
  const tag = ev.diff ? c("yellow", ev.applied ? "(applied)" : "(diff)", ctx.color) : "";
  return `  ${mark} ${c("cyan", `[${ev.stepNum ?? "?"}] ${ev.tool ?? "?"}`, ctx.color)} ${lat} ${tag}`.trimEnd();
}

// Colorize a unified-diff string (+ green / − red) when color is enabled.
export function formatDiff(diff: string, ctx: OutputCtx): string {
  if (!diff) return "";
  if (!ctx.color) return diff;
  return diff
    .split("\n")
    .map((l) => (l.startsWith("+") ? c("green", l, true) : l.startsWith("-") ? c("red", l, true) : l))
    .join("\n");
}

// Final one-line footer after a streamed answer: source + speed.
export function streamFooter(meta: { source?: string; latencyMs?: number; tokensPerSec?: number }, ctx: OutputCtx): string {
  const parts: string[] = [];
  if (meta.source) parts.push(meta.source);
  if (typeof meta.latencyMs === "number") parts.push(`${meta.latencyMs}ms`);
  if (typeof meta.tokensPerSec === "number") parts.push(`${meta.tokensPerSec.toFixed(1)} tok/s`);
  return c("dim", `[${parts.join(" · ")}]`, ctx.color);
}
