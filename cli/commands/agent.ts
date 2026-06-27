// `ollamas agent` — drive the gateway's ReAct agent loop from the terminal.
//   ollamas agent "refactor X and run tests"     interactive (prompts on writes)
//   ollamas agent --yolo "..."                    auto-apply writes, no prompts
//   ollamas agent sessions                        list persisted sessions
//   ollamas agent rm <id>                         delete a session
//   ollamas agent watch [id]                      live-tail a running session (Ctrl-C = detach)
// The agent runs entirely server-side through the single choke-point; this
// command only streams events and relays write approvals.
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { GatewayClient, type ChatMessage, type AgentEvent, type AgentOpts } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, streamFooter, formatStep, formatDiff, c, type OutputCtx } from "../lib/output";
import { readStdin, confirm } from "../lib/io";
import { nextBackoff, renderWatchEvent, buildPickerPrompt } from "../lib/watch";

const HELP = `ollamas agent [task] — drive the ReAct agent loop

  ollamas agent "fix the failing test and re-run it"
  echo "task" | ollamas agent
  ollamas agent sessions | rm <id>
  ollamas agent watch [id]              live-tail a session (Ctrl-C = detach, NOT kill)

options:
  -m, --model <m>      override model           -p, --provider <p>  override provider
  -s, --session <id>   resume a session, or 'new' to create one
      --max-steps <n>  ReAct step cap (default 8)
      --yolo           auto-apply writes (no approval prompt)
      --safe           prompt before each write (default)
      --timeout <ms>   per-round stream timeout (default 300000)
      --json           emit events as JSON lines
      --help           this message

watch options:
      --follow         keep tailing after catching up (default true)
      --since <idx>    start from event index (default: all)
      --replay         replay from beginning (after=-1)
      --json           emit raw JSON lines per event (no drop/coalesce)`;

const MAX_APPROVAL_ROUNDS = 12;

export async function runAgent(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      model: { type: "string", short: "m" },
      provider: { type: "string", short: "p" },
      session: { type: "string", short: "s" },
      "max-steps": { type: "string" },
      yolo: { type: "boolean" },
      safe: { type: "boolean" },
      timeout: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
      follow: { type: "boolean" },
      since: { type: "string" },
      replay: { type: "boolean" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey);
  const json = !!values.json;
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, json);

  // Sub-actions: `agent sessions`, `agent rm <id>`, `agent watch [id]`.
  const sub = positionals[0];
  if (sub === "sessions") return listSessions(client, ctx);
  if (sub === "rm") return removeSession(client, positionals[1], ctx);
  if (sub === "watch") return watchSession(client, positionals[1], values, ctx);

  // Otherwise: run a task. Prompt from positionals or piped stdin (G2).
  let prompt = positionals.join(" ").trim();
  if (!prompt && !process.stdin.isTTY) prompt = await readStdin();
  if (!prompt) {
    process.stderr.write("agent: no task given\n" + HELP + "\n");
    return 2;
  }

  let sessionId = values.session as string | undefined;
  if (sessionId === "new") {
    const s = await client.createSession({ title: prompt.slice(0, 40), providerId: cfg.provider, modelId: cfg.model });
    sessionId = s.id;
    process.stdout.write(c("dim", `session created: ${sessionId}`, ctx.color) + "\n");
  }

  const opts: AgentOpts = {
    provider: (values.provider as string) || cfg.provider,
    model: (values.model as string) || cfg.model,
    maxSteps: values["max-steps"] ? Number(values["max-steps"]) : 8,
    autoApply: !!values.yolo, // --safe / default => false => approval prompts
    sessionId,
    timeoutMs: values.timeout ? Number(values.timeout) : undefined,
  };

  return runLoop(client, opts, prompt, ctx);
}

async function runLoop(
  client: GatewayClient,
  opts: AgentOpts,
  prompt: string,
  ctx: OutputCtx,
): Promise<number> {
  let messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const onEvent = (ev: AgentEvent) => renderEvent(ev, ctx);

  try {
    for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
      const res = await client.agentStream(messages, opts, onEvent);
      if (res.status !== "paused" || !res.pending) return 0;

      // A write is awaiting approval.
      if (!ctx.json && process.stdout.isTTY) {
        process.stdout.write("\n" + c("yellow", `proposed write: ${res.pending.path}`, ctx.color) + "\n");
        if (res.pending.diff) process.stdout.write(formatDiff(res.pending.diff, ctx) + "\n");
      }
      const approved = await confirm(c("yellow", "apply this write? [y/N] ", ctx.color));
      if (!approved) {
        process.stdout.write(c("dim", "write rejected — agent halted", ctx.color) + "\n");
        return 0;
      }
      await client.approveWrite(res.pending.path, res.pending.content);
      process.stdout.write(c("green", `applied: ${res.pending.path}`, ctx.color) + "\n");
      messages = [...res.history, { role: "user", content: `Approved and wrote ${res.pending.path}. Continue.` }];
    }
    process.stdout.write(c("yellow", "agent: approval round cap reached", ctx.color) + "\n");
    return 0;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const hint = /\b401\b/.test(msg) ? "\n  hint: set OLLAMAS_API_KEY (gateway requires auth)" : "";
    process.stderr.write(c("red", `agent error: ${msg}${hint}`, ctx.color) + "\n");
    return 1;
  }
}

// Render one SSE event. JSON mode emits one JSON object per line.
function renderEvent(ev: AgentEvent, ctx: OutputCtx): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify(ev) + "\n");
    return;
  }
  switch (ev.type) {
    case "thought":
      if (ev.text) process.stdout.write(c("dim", `· ${ev.text}`, ctx.color) + "\n");
      break;
    case "message":
      if (ev.text) process.stdout.write(ev.text + "\n");
      break;
    case "step":
      process.stdout.write(formatStep(ev, ctx) + "\n");
      break;
    case "paused":
      // handled by runLoop (approval); nothing extra to print here
      break;
    case "done":
      process.stdout.write((ev.text ? ev.text + "\n" : "") + streamFooter({ source: `agent:${ev.status}` }, ctx) + "\n");
      break;
    case "error":
      process.stdout.write(c("red", `error: ${ev.message}`, ctx.color) + "\n");
      break;
  }
}

async function listSessions(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const sessions = await client.listSessions();
  if (ctx.json) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + "\n");
    return 0;
  }
  if (!sessions.length) {
    process.stdout.write(c("dim", "no agent sessions", ctx.color) + "\n");
    return 0;
  }
  for (const s of sessions) {
    process.stdout.write(
      `${c("cyan", s.id.slice(0, 8), ctx.color)}  ${(s.title || "").padEnd(42).slice(0, 42)}  ${c("dim", s.updatedAt || "", ctx.color)}\n`,
    );
  }
  return 0;
}

async function removeSession(client: GatewayClient, id: string | undefined, ctx: OutputCtx): Promise<number> {
  if (!id) {
    process.stderr.write("agent rm: missing <id>\n");
    return 2;
  }
  await client.deleteSession(id);
  process.stdout.write(c("green", `deleted session ${id}`, ctx.color) + "\n");
  return 0;
}

async function watchSession(
  client: GatewayClient,
  id: string | undefined,
  flags: Record<string, any>,
  ctx: OutputCtx,
): Promise<number> {
  // Resolve session id — picker when omitted and TTY available.
  let sessionId = id;
  if (!sessionId) {
    const sessions = await client.listSessions();
    if (!sessions.length) {
      process.stderr.write("watch: no sessions found\n");
      return 1;
    }
    if (sessions.length === 1) {
      sessionId = sessions[0].id;
    } else if (process.stdin.isTTY) {
      // Numbered picker via readline
      process.stdout.write(buildPickerPrompt(sessions) + "\n");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = await new Promise<string>((res) => rl.question("select session [1]: ", res));
      rl.close();
      const idx = (parseInt(ans.trim() || "1", 10) || 1) - 1;
      if (idx < 0 || idx >= sessions.length) {
        process.stderr.write("watch: invalid selection\n");
        return 2;
      }
      sessionId = sessions[idx].id;
    } else {
      process.stderr.write("watch: specify a session id\n");
      return 2;
    }
  }

  const follow = flags.follow !== false; // default true (--no-follow to disable)
  const replay = !!flags.replay;
  const sinceFlag = flags.since !== undefined ? parseInt(flags.since, 10) : undefined;
  // --replay → after=-1 (all), --since N → after=N, else start from -1 (all by default)
  let after = replay ? -1 : (sinceFlag ?? -1);

  // Ctrl-C → detach (SIGINT). AbortController signals the fetch; the server run
  // continues uninterrupted. DETACH ≠ KILL is the critical invariant.
  const ac = new AbortController();
  process.once("SIGINT", () => {
    process.stdout.write(c("dim", "\ndetached (session still running)", ctx.color) + "\n");
    ac.abort();
  });

  if (!ctx.json) {
    process.stdout.write(c("dim", `watching session ${sessionId} (Ctrl-C to detach)`, ctx.color) + "\n");
  }

  let attempt = 0;
  for (;;) {
    try {
      await client.watchSession(
        sessionId,
        { after },
        (ev) => {
          // Track last-seen id for reconnect resume
          if (ev.id >= 0) after = ev.id;
          if (ctx.json) {
            process.stdout.write(JSON.stringify(ev.data) + "\n");
          } else {
            const line = renderWatchEvent(ev.data);
            if (line) process.stdout.write(line + "\n");
          }
        },
        ac.signal,
      );
      // Stream ended cleanly (event:done)
      if (!ctx.json) process.stdout.write(c("dim", "session complete", ctx.color) + "\n");
      return 0;
    } catch (e: any) {
      if (ac.signal.aborted) return 0; // user detached
      if (!follow) {
        process.stderr.write(c("red", `watch error: ${e?.message}`, ctx.color) + "\n");
        return 1;
      }
      // Reconnect with exponential backoff using last-seen after idx
      const delay = nextBackoff(attempt++, { base: 500, cap: 15_000 });
      if (!ctx.json) {
        process.stderr.write(c("dim", `disconnected — reconnecting in ${delay}ms (attempt ${attempt})`, ctx.color) + "\n");
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
