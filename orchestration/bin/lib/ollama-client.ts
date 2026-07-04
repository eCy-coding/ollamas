// ollama-client — the minimal zero-dep helper to run ONE chat turn against a local ollama model. None existed
// in the repo (all inference went through the server). Used by the alignment conformance benchmark to A/B a
// base model vs its "-ca" aligned variant directly, with temperature=0 for the most reproducible comparison.

export interface ChatOpts {
  temperature?: number;   // default 0 (deterministic eval)
  num_ctx?: number;
  host?: string;          // default 127.0.0.1:11434
  timeoutMs?: number;
}

export interface ChatResult { text: string; ms: number }

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

/** One non-streaming chat turn. `system` is sent as messages[0] when non-empty; pass "" to let an aligned
 *  variant use its baked-in Modelfile SYSTEM prompt. Returns the assistant text (raw, including any <think>). */
export async function chatOnce(model: string, system: string, user: string, opts: ChatOpts = {}): Promise<ChatResult> {
  const host = opts.host || DEFAULT_HOST;
  const messages: { role: string; content: string }[] = [];
  if (system && system.trim()) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  const body = {
    model,
    messages,
    stream: false,
    options: { temperature: opts.temperature ?? 0, num_ctx: opts.num_ctx ?? 8192 },
  };
  const t0 = Date.now();
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw new Error(`ollama /api/chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return { text: j?.message?.content ?? "", ms: Date.now() - t0 };
}
