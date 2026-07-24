// Log normalisation (pure) — 45 jobs' output made readable in one stream.
//
// WHY THIS EXISTS
// v5 made the background visible; it did not make it legible. The supervisor piped `tail -F`
// through a `[label]` prefix, and the real lines on this machine look like this:
//
//   2026-07-24 13:20:57  cc-verify: PASS=24  FAIL=1  SKIP=0
//   2026-07-24 10:32:25,421 INFO gateway.run: Cron ticker started (interval=60s)
//   WARNING gateway.run: No messaging platforms enabled.
//   2026-07-24T10:32:12.122+03:00 [plugins] bonjour: advertised gateway fqdn=…
//
// Four timestamp shapes, some lines with none, severity sometimes a word and sometimes
// absent, the origin sometimes `[tag]` and sometimes `module.function:`. Interleaved from 45
// jobs that is unreadable, which is what the operator actually complained about.
//
// So every line is reduced to `{ts, source, level, message}` and rendered at fixed width.
// Parsing is pure and tested against the real shapes above — a formatter that guesses wrong
// is worse than raw text, because it makes noise look structured.
export type Level = "error" | "warn" | "info" | "debug";

export interface LogLine {
  /** `HH:MM:SS` local, or "" when the line carried no timestamp. */
  time: string;
  /** Job label the line came from (supplied by the caller — the file it was tailing). */
  job: string;
  /** Component inside the job, when the line names one (`gateway.run`, `plugins`, `cc-verify`). */
  source: string;
  level: Level;
  message: string;
  /** True when severity was not stated and had to default. Rendered so it is never mistaken. */
  levelInferred: boolean;
  /** The untouched input, kept so nothing is lost by formatting. */
  raw: string;
}

/** Strip ANSI colour/cursor sequences — progress bars otherwise arrive as line noise. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? "").replace(/\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

const TS_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // ISO-8601 with offset or Z: 2026-07-24T10:32:12.122+03:00
  [/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*/, (m) => m[2]],
  // Python logging: 2026-07-24 10:32:25,421
  [/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\s*/, (m) => m[2]],
  // Bare clock: 10:32:25
  [/^(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\s*/, (m) => m[1]],
  // syslog style: Jul 24 10:32:25
  [/^[A-Z][a-z]{2}\s+\d{1,2}\s+(\d{2}:\d{2}:\d{2})\s*/, (m) => m[1]],
];

const LEVEL_WORDS: Array<[RegExp, Level]> = [
  [/\b(ERROR|ERR|FATAL|CRITICAL|EXCEPTION|Traceback|HATA)\b/i, "error"],
  [/\b(WARN|WARNING|UYARI)\b/i, "warn"],
  [/\b(DEBUG|TRACE)\b/i, "debug"],
  [/\b(INFO|NOTICE|BİLGİ)\b/i, "info"],
];

/**
 * Severity, in order of trust: an explicit word, then a counted failure, then default.
 *
 * `FAIL=0` must NOT read as an error — the gates in this repo print their score on every
 * run, and treating a green gate as a failure would paint the whole stream red. Only a
 * non-zero count counts.
 */
export function detectLevel(text: string): { level: Level; inferred: boolean } {
  for (const [re, lv] of LEVEL_WORDS) if (re.test(text)) return { level: lv, inferred: false };
  const fail = text.match(/\bFAIL[=:\s]+(\d+)/i);
  if (fail) return { level: Number(fail[1]) > 0 ? "error" : "info", inferred: false };
  if (/\b(failed|başarısız|refused|denied|timeout|zaman aşımı)\b/i.test(text)) {
    return { level: "error", inferred: false };
  }
  // Nothing stated. Default to info AND say so — never manufacture a severity.
  return { level: "info", inferred: true };
}

/** `[tag]` or a leading `module.fn:` prefix names the component; both are consumed. */
function extractSource(text: string): { source: string; rest: string } {
  const bracket = text.match(/^\[([^\]]{1,24})\]\s*/);
  if (bracket) return { source: bracket[1], rest: text.slice(bracket[0].length) };
  const dotted = text.match(/^([A-Za-z][\w.-]{1,28})\s*:\s+/);
  if (dotted && /[.\-]/.test(dotted[1])) return { source: dotted[1], rest: text.slice(dotted[0].length) };
  return { source: "", rest: text };
}

export function parseLine(line: string, job: string): LogLine | null {
  const raw = String(line ?? "");
  let text = stripAnsi(raw).trim();
  if (!text) return null;

  let time = "";
  for (const [re, pick] of TS_PATTERNS) {
    const m = text.match(re);
    if (m) {
      time = pick(m);
      text = text.slice(m[0].length);
      break;
    }
  }

  // Level words often sit before the component (`INFO gateway.run: …`); detect on the whole
  // remainder, then drop a leading standalone level token so it is not repeated in the message.
  const { level, inferred } = detectLevel(text);
  text = text.replace(/^(ERROR|ERR|FATAL|CRITICAL|WARN|WARNING|INFO|NOTICE|DEBUG|TRACE)\b[:\s]+/i, "");

  const { source, rest } = extractSource(text);
  return { time, job, source, level, message: rest.trim(), levelInferred: inferred, raw };
}

const LEVEL_TR: Record<Level, string> = { error: "HATA", warn: "UYARI", info: "BİLGİ", debug: "AYRINTI" };
const LEVEL_ANSI: Record<Level, string> = { error: "[31m", warn: "[33m", info: "[90m", debug: "[90m" };

export interface RenderOptions {
  colour?: boolean;
  jobWidth?: number;
  width?: number;
}

/**
 * One fixed-width line: `HH:MM:SS │ job │ SEVİYE │ message`.
 *
 * The severity is always written as a WORD, not only as a colour. Colour is unavailable in a
 * piped log, invisible to a colour-blind reader, and lost on copy-paste into a report — a
 * stream where red is the only marker of failure is not readable, it is decorated.
 */
export function renderLine(l: LogLine | null, o: RenderOptions = {}): string {
  if (!l) return "";
  const colour = o.colour !== false;
  const jw = o.jobWidth ?? 20;
  const width = o.width ?? 120;
  const job = (l.job.length > jw ? `${l.job.slice(0, jw - 1)}…` : l.job).padEnd(jw);
  const lvl = (LEVEL_TR[l.level] + (l.levelInferred ? "?" : "")).padEnd(8);
  const src = l.source ? `${l.source}: ` : "";
  // Placeholder is EXACTLY 8 characters. A 9-char stand-in shifted every timestamp-less line
  // one column right, which is precisely the misalignment this formatter exists to remove.
  const head = `${(l.time || "--:--:--").padEnd(8)} │ ${job} │ ${lvl}│ `;
  // Clamp to the width contract. An earlier `Math.max(20, …)` floor guaranteed a minimum body
  // and thereby broke the maximum — a 60-column render came back 64 wide.
  const body = `${src}${l.message}`.slice(0, Math.max(0, width - head.length));
  return colour ? `${LEVEL_ANSI[l.level]}${head}${body}[0m` : `${head}${body}`;
}

export interface FoldState {
  lastKey: string;
  count: number;
}

/**
 * Fold consecutive identical lines into `… ×N`.
 *
 * Folded, not dropped: a job repeating the same error 200 times is telling you something,
 * and hiding the repetition would turn a loud failure into a quiet one. The count is the
 * information; the 199 duplicate lines are not.
 */
export function fold(l: LogLine | null, st: FoldState): { emit: string | null; state: FoldState } {
  if (!l) return { emit: null, state: st };
  const key = `${l.job}|${l.level}|${l.message}`;
  if (key === st.lastKey) return { emit: null, state: { lastKey: key, count: st.count + 1 } };
  const suffix = st.count > 1 ? `  ×${st.count}` : "";
  return { emit: suffix || null, state: { lastKey: key, count: 1 } };
}

/** Lines worth nobody's attention: separators, spinners, empty frames. */
export function isNoise(line: string): boolean {
  const t = stripAnsi(line).trim();
  if (!t) return true;
  if (/^[-=_*·.]{3,}$/.test(t)) return true;
  if (/^[⠀-⣿⠁⠂⠄⡀⢀⠠⠐⠈|/\\-]+$/.test(t)) return true;   // spinner frames
  if (/^\d+%(\s|$)/.test(t) && t.length < 12) return true;         // bare progress
  return false;
}

export const LEVELS: Level[] = ["error", "warn", "info", "debug"];

/** `--only error,warn` → a predicate. Unknown names are ignored rather than silently empty. */
export function levelFilter(only: string | undefined): (l: Level) => boolean {
  if (!only) return () => true;
  const want = new Set(only.split(",").map((s) => s.trim().toLowerCase()).filter((s) => LEVELS.includes(s as Level)));
  return want.size ? (l: Level) => want.has(l) : () => true;
}

/** Column header so the operator knows what they are reading. */
export function header(jobWidth = 20): string[] {
  return [
    `${"saat".padEnd(8)} │ ${"iş".padEnd(jobWidth)} │ ${"seviye".padEnd(8)}│ mesaj`,
    `${"─".repeat(8)}─┼─${"─".repeat(jobWidth)}─┼─${"─".repeat(8)}┼${"─".repeat(40)}`,
  ];
}
