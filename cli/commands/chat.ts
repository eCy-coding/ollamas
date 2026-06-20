// `ollamas chat` — one-shot or interactive REPL against the gateway.
// One-shot:    ollamas chat "why is the sky blue"
// Piped:       echo "prompt" | ollamas chat
// Interactive: ollamas chat            (reads from a TTY, /exit to quit)
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { GatewayClient, type ChatMessage } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, streamFooter, c } from "../lib/output";
import { readStdin } from "../lib/io";

const HELP = `ollamas chat [prompt] — one-shot or interactive REPL

  ollamas chat "why is the sky blue"
  echo "prompt" | ollamas chat
  ollamas chat                       (TTY REPL, /exit to quit)

options:
  -m, --model <m>     -p, --provider <p>     -t, --temperature <n>
  --timeout <ms>      --json      --help`;

// A 401 from the gateway means SAAS enforcement is on — point the user at the fix.
function withHint(msg: string): string {
  return /\b401\b/.test(msg)
    ? `${msg}\n  hint: gateway requires auth — set OLLAMAS_API_KEY or 'ollamas config apiKey <key>'`
    : msg;
}

export async function runChat(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      model: { type: "string", short: "m" },
      provider: { type: "string", short: "p" },
      temperature: { type: "string", short: "t" },
      timeout: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey);
  const opts = {
    model: (values.model as string) || cfg.model,
    provider: (values.provider as string) || cfg.provider,
    temperature: values.temperature ? Number(values.temperature) : undefined,
    timeoutMs: values.timeout ? Number(values.timeout) : undefined,
  };
  const json = !!values.json;
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, json);

  let prompt = positionals.join(" ").trim();
  // No positional + piped stdin → read the pipe as the prompt (G2).
  if (!prompt && !process.stdin.isTTY) prompt = await readStdin();
  if (prompt) {
    return askOnce(client, opts, prompt, ctx);
  }

  // No prompt and a TTY → interactive REPL.
  if (!process.stdin.isTTY) {
    process.stderr.write("chat: no prompt given\n");
    return 2;
  }
  return repl(client, opts, ctx);
}

async function askOnce(
  client: GatewayClient,
  opts: { model?: string; provider?: string; temperature?: number; timeoutMs?: number },
  prompt: string,
  ctx: ReturnType<typeof resolveOutputCtx>,
): Promise<number> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  try {
    if (ctx.json) {
      let text = "";
      const meta = await client.generateStream(messages, opts, (chunk) => (text += chunk));
      process.stdout.write(JSON.stringify({ text, ...meta }, null, 2) + "\n");
    } else {
      const meta = await client.generateStream(messages, opts, (chunk) => process.stdout.write(chunk));
      process.stdout.write("\n" + streamFooter(meta, ctx) + "\n");
    }
    return 0;
  } catch (e: any) {
    process.stderr.write(c("red", `chat error: ${withHint(String(e?.message || e))}`, ctx.color) + "\n");
    return 1;
  }
}

async function repl(
  client: GatewayClient,
  opts: { model?: string; provider?: string; temperature?: number; timeoutMs?: number },
  ctx: ReturnType<typeof resolveOutputCtx>,
): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: ChatMessage[] = [];
  process.stdout.write(c("dim", "ollamas chat — /exit to quit\n", ctx.color));

  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
  for (;;) {
    const line = (await ask(c("cyan", "› ", ctx.color))).trim();
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    history.push({ role: "user", content: line });
    try {
      let text = "";
      const meta = await client.generateStream(history, opts, (chunk) => {
        text += chunk;
        process.stdout.write(chunk);
      });
      history.push({ role: "assistant", content: text });
      process.stdout.write("\n" + streamFooter(meta, ctx) + "\n");
    } catch (e: any) {
      process.stdout.write(c("red", `error: ${withHint(String(e?.message || e))}`, ctx.color) + "\n");
    }
  }
  rl.close();
  return 0;
}
