// `ollamas top` — live gateway observability (v8). Thin client: polls the open
// `/metrics` (Prometheus) + `/api/saas/usage/timeseries`, tails the local
// seyir-defteri.jsonl, renders a zero-dep terminal dashboard. The render core is
// pure (socket/disk-less testable); the --watch loop + ANSI escapes + fs tail are
// the I/O shell. Full-frame repaint @ interval (k9s/docker-stats model); SIGINT
// MUST restore the terminal (show cursor + leave alt-screen) or it corrupts.
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GatewayClient, type AgentSession } from "../lib/client";
import { loadConfig } from "../lib/config";
import { parsePromText, histogramStats, type Metric, type Sample } from "../lib/metrics";
import { resolveOutputCtx, c, formatTable, sparkline, compactNum, renderPanes, type Pane, type OutputCtx } from "../lib/output";

const HELP = `ollamas top — live gateway metrics dashboard

  top [--watch] [--interval <s>] [--no-sessions] [--json]

  (snapshot by default; --watch repaints every <s> seconds, default 2)
  wide terminals (>=100 cols) render side-by-side panes; narrow -> vertical.
  /metrics needs no auth; usage + sessions panels need a tenant key.
  --no-sessions skips the sessions network call. seyir tail reads
  ~/.llm-mission-control/seyir-defteri.jsonl on THIS host.
flags: --json (snapshot data), --help`;

// ANSI control sequences (inlined from sindresorhus/ansi-escapes, MIT).
const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR = "\x1b[2J";

// Pure: the sequence that restores a sane terminal after --watch. Exported so the
// teardown contract is unit-testable (must show the cursor + leave alt-screen).
export function cleanupSequence(): string {
  return CURSOR_SHOW + ALT_OFF;
}

const SEYIR_FILE = join(homedir(), ".llm-mission-control", "seyir-defteri.jsonl");

export interface ToolCall {
  tool: string;
  tier: string;
  ok: string;
  count: number;
}
export interface Snapshot {
  ts: string;
  gateway: string;
  totalRequests: number;
  latency: { count: number; avg: number; p50: number; p90: number };
  toolCalls: ToolCall[];
  reqRate?: number; // req/s (watch only)
  reqRateHistory?: number[]; // sparkline series (watch only)
  usageSeries?: { day: string; calls: number; tokens: number }[];
  usageError?: string;
  seyir?: string[]; // last raw jsonl lines
  sessions?: AgentSession[]; // recent agent sessions (cockpit pane, v16)
}

// Pure: assemble a Snapshot from a raw /metrics body + optional extras.
export function buildSnapshot(
  metricsText: string,
  opts: {
    gateway: string;
    ts: string;
    reqRate?: number;
    reqRateHistory?: number[];
    usageSeries?: { day: string; calls: number; tokens: number }[];
    usageError?: string;
    seyir?: string[];
    sessions?: AgentSession[];
  },
): Snapshot {
  const metrics = parsePromText(metricsText);
  const latency = histogramStats(metrics, "http_request_duration_ms");
  const toolMetric = metrics.find((m: Metric) => m.name === "mcp_tool_calls_total");
  const toolCalls: ToolCall[] = (toolMetric?.samples || [])
    .filter((s): s is Sample => "value" in s)
    .map((s) => ({ tool: s.labels.tool ?? "?", tier: s.labels.tier ?? "?", ok: s.labels.ok ?? "?", count: s.value }))
    .sort((a, b) => b.count - a.count);
  return {
    ts: opts.ts,
    gateway: opts.gateway,
    totalRequests: latency.count,
    latency,
    toolCalls,
    reqRate: opts.reqRate,
    reqRateHistory: opts.reqRateHistory,
    usageSeries: opts.usageSeries,
    usageError: opts.usageError,
    seyir: opts.seyir,
    sessions: opts.sessions,
  };
}

// Pure: req/s between two counter reads. Guards a counter reset (cur<prev → 0)
// and a zero/negative time delta. Returns 0 when there's no prior sample.
export function reqRateDelta(prev: { count: number; ts: number } | null, cur: { count: number; ts: number }): number {
  if (!prev) return 0;
  const dt = (cur.ts - prev.ts) / 1000;
  if (dt <= 0) return 0;
  const dc = cur.count - prev.count;
  if (dc < 0) return 0; // counter reset (restart)
  return dc / dt;
}

// Minimum terminal width to switch from the vertical list to side-by-side panes.
const PANE_MIN = 100;

// Pure: render the dashboard frame. `width` is injected (0 → vertical fallback, the
// pre-v16 layout). ctx.json is handled by the caller (raw data).
export function renderDashboard(s: Snapshot, ctx: OutputCtx, width = 0): string {
  if (width >= PANE_MIN) return renderDashboardWide(s, ctx, width);
  const dim = (t: string) => c("dim", t, ctx.color);
  const bold = (t: string) => c("bold", t, ctx.color);
  const lines: string[] = [];

  lines.push(`${bold("ollamas top")}  ${c("cyan", s.gateway, ctx.color)}  ${dim(s.ts)}`);
  lines.push("");

  const rate = s.reqRate === undefined ? "—" : `${s.reqRate.toFixed(1)}`;
  const spark = s.reqRateHistory && s.reqRateHistory.length ? "  " + sparkline(s.reqRateHistory) : "";
  lines.push(`${bold("requests")}  ${compactNum(s.totalRequests)} total   ${rate} req/s${spark}`);
  lines.push(
    `${bold("latency ")}  avg ${fmtMs(s.latency.avg)}   ${dim("~p50")} ${fmtMs(s.latency.p50)}   ${dim("~p90")} ${fmtMs(s.latency.p90)}`,
  );

  if (s.usageError) {
    lines.push(`${bold("usage   ")}  ${dim(s.usageError)}`);
  } else if (s.usageSeries && s.usageSeries.length) {
    const calls = s.usageSeries.map((d) => d.calls);
    const tokens = s.usageSeries.reduce((a, d) => a + d.tokens, 0);
    lines.push(`${bold("usage   ")}  ${compactNum(calls.reduce((a, b) => a + b, 0))} calls  ${sparkline(calls)}  ${compactNum(tokens)} tokens`);
  }

  lines.push("");
  if (s.toolCalls.length) {
    lines.push(bold("mcp tool calls"));
    lines.push(
      formatTable(
        ["tool", "tier", "ok", "calls"],
        s.toolCalls.slice(0, 12).map((t) => [t.tool, t.tier, t.ok, compactNum(t.count)]),
        ctx,
      ),
    );
  } else {
    lines.push(dim("no mcp tool calls yet"));
  }

  if (s.seyir && s.seyir.length) {
    lines.push("");
    lines.push(bold("logbook (tail)"));
    for (const raw of s.seyir) lines.push("  " + dim(seyirLine(raw)));
  }
  return lines.join("\n");
}

// Pure: the wide (≥PANE_MIN cols) layout — metric panes side-by-side, then usage +
// logbook full-width below. Reuses renderPanes (output.ts).
function renderDashboardWide(s: Snapshot, ctx: OutputCtx, width: number): string {
  const dim = (t: string) => c("dim", t, ctx.color);
  const bold = (t: string) => c("bold", t, ctx.color);
  const lines: string[] = [];
  lines.push(`${bold("ollamas top")}  ${c("cyan", s.gateway, ctx.color)}  ${dim(s.ts)}`);
  lines.push("");

  const rate = s.reqRate === undefined ? "—" : s.reqRate.toFixed(1);
  const panes: Pane[] = [
    {
      title: "requests",
      lines: [`${compactNum(s.totalRequests)} total`, `${rate} req/s`, ...(s.reqRateHistory && s.reqRateHistory.length ? [sparkline(s.reqRateHistory)] : [])],
    },
    { title: "latency", lines: [`avg ${fmtMs(s.latency.avg)}`, `~p50 ${fmtMs(s.latency.p50)}`, `~p90 ${fmtMs(s.latency.p90)}`] },
    {
      title: "tool calls",
      lines: s.toolCalls.length ? s.toolCalls.slice(0, 8).map((t) => `${t.tool} ${compactNum(t.count)}`) : ["—"],
    },
  ];
  if (s.sessions && s.sessions.length) {
    panes.push({
      title: "sessions",
      lines: s.sessions.slice(0, 8).map((x) => `${(x.id || "").slice(0, 8)} ${(x.title || "").slice(0, 16)}`),
    });
  }
  lines.push(renderPanes(panes, width, ctx));

  if (s.usageError) {
    lines.push("", `${bold("usage")}  ${dim(s.usageError)}`);
  } else if (s.usageSeries && s.usageSeries.length) {
    const calls = s.usageSeries.map((d) => d.calls);
    const tokens = s.usageSeries.reduce((a, d) => a + d.tokens, 0);
    lines.push("", `${bold("usage")}  ${compactNum(calls.reduce((a, b) => a + b, 0))} calls  ${sparkline(calls)}  ${compactNum(tokens)} tokens`);
  }
  if (s.seyir && s.seyir.length) {
    lines.push("", bold("logbook (tail)"));
    for (const raw of s.seyir) lines.push("  " + dim(seyirLine(raw)));
  }
  return lines.join("\n");
}

function fmtMs(n: number): string {
  return `${Math.round(n)}ms`;
}

// Compact one jsonl logbook line → "HH:MM:SS event …". Tolerant of non-JSON.
function seyirLine(raw: string): string {
  try {
    const o = JSON.parse(raw);
    const t = typeof o.ts === "string" ? o.ts.slice(11, 19) : "";
    const ev = o.event || o.action || o.msg || Object.keys(o).filter((k) => k !== "ts")[0] || "";
    return `${t} ${typeof ev === "string" ? ev : JSON.stringify(ev)}`.trim();
  } catch {
    return raw.slice(0, 80);
  }
}

// I/O: tail the last n lines of the local seyir-defteri.jsonl (absent → undefined).
function readSeyirTail(n: number): string[] | undefined {
  try {
    const lines = readFileSync(SEYIR_FILE, "utf8").split("\n").filter(Boolean);
    return lines.slice(-n);
  } catch {
    return undefined;
  }
}

export async function runTop(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      watch: { type: "boolean", short: "w" },
      interval: { type: "string" },
      "no-sessions": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey);
  const intervalMs = Math.max(1, Number(values.interval) || 2) * 1000;

  // One fetch → Snapshot. Usage is best-effort (needs a key); metrics is the core.
  const sample = async (reqRate?: number, history?: number[]): Promise<{ snap: Snapshot; count: number }> => {
    const text = await client.getMetrics();
    let usageSeries: { day: string; calls: number; tokens: number }[] | undefined;
    let usageError: string | undefined;
    try {
      usageSeries = (await client.getUsageTimeseries()).series;
    } catch (e: any) {
      usageError = String(e?.message || e).split("\n").pop()?.trim();
    }
    // Sessions pane is best-effort (a tenant key may be required); a failure or
    // --no-sessions just omits the pane — the cockpit still renders.
    let sessions: AgentSession[] | undefined;
    if (!values["no-sessions"]) {
      try {
        sessions = await client.listSessions();
      } catch {
        /* omit the pane */
      }
    }
    const snap = buildSnapshot(text, {
      gateway: cfg.gateway,
      ts: new Date().toISOString(),
      reqRate,
      reqRateHistory: history,
      usageSeries,
      usageError,
      seyir: readSeyirTail(5),
      sessions,
    });
    return { snap, count: snap.latency.count };
  };

  // --- snapshot mode (default) ---
  if (!values.watch) {
    try {
      const { snap } = await sample();
      process.stdout.write((ctx.json ? JSON.stringify(snap, null, 2) : renderDashboard(snap, ctx, process.stdout.columns ?? 0)) + "\n");
      return 0;
    } catch (e: any) {
      process.stderr.write(c("red", `top: ${String(e?.message || e)}`, ctx.color) + "\n");
      return 1;
    }
  }

  // --- watch mode (TTY only) ---
  if (!process.stdout.isTTY) {
    process.stderr.write("top --watch needs a TTY — emitting a single snapshot instead\n");
    const { snap } = await sample();
    process.stdout.write((ctx.json ? JSON.stringify(snap, null, 2) : renderDashboard(snap, ctx, process.stdout.columns ?? 0)) + "\n");
    return 0;
  }

  let prev: { count: number; ts: number } | null = null;
  const history: number[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let tearingDown = false;

  const cleanup = () => {
    if (tearingDown) return;
    tearingDown = true;
    if (timer) clearInterval(timer);
    process.stdout.write(cleanupSequence()); // show cursor + leave alt-screen
  };

  let ticking = false;
  const tick = async () => {
    if (ticking) return; // skip overlapping ticks: a slow gateway poll (> interval) would
    ticking = true;      // otherwise interleave prev/history writes + tear the frame.
    try {
      const now = Date.now();
      const text = await client.getMetrics();
      const count = histogramStats(parsePromText(text), "http_request_duration_ms").count;
      const rate = reqRateDelta(prev, { count, ts: now });
      prev = { count, ts: now };
      if (prev) {
        history.push(rate);
        if (history.length > 60) history.shift();
      }
      // Usage refreshed inside sample(); cheap enough at the watch interval here.
      const { snap } = await sample(history.length ? rate : undefined, history.length ? history : undefined);
      process.stdout.write(CURSOR_HOME + CLEAR + renderDashboard(snap, ctx, process.stdout.columns ?? 0) + "\n");
    } catch (e: any) {
      process.stdout.write(CURSOR_HOME + CLEAR + c("red", `top: ${String(e?.message || e)}`, ctx.color) + "\n");
    } finally {
      ticking = false;
    }
  };

  process.stdout.write(ALT_ON + CURSOR_HIDE);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  await tick();
  return await new Promise<number>(() => {
    timer = setInterval(tick, intervalMs);
  }); // resolves never — process exits via signal cleanup
}
