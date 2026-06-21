// Colab-style ergonomic client (v1.11) — zero-dependency, isomorphic (browser or
// Node ≥18, uses global fetch). Mirrors `google.colab.ai` over the ollamas
// `/api/ai/*` HTTP surface so external consumers get the same two-function feel.
//
//   const ai = createAiClient("http://localhost:3000");
//   await ai.listModels();
//   await ai.generateText("What is the capital of France?");
//   for await (const chunk of ai.generateTextStream("Tell me a story.")) process.stdout.write(chunk);

export interface AiClientOptions {
  model?: string;
  temperature?: number;
}

export interface AiClient {
  listModels(): Promise<string[]>;
  generateText(prompt: string, opts?: AiClientOptions): Promise<string>;
  generateTextStream(prompt: string, opts?: AiClientOptions): AsyncGenerator<string>;
}

export function createAiClient(baseUrl: string, token?: string): AiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  async function listModels(): Promise<string[]> {
    const res = await fetch(`${base}/api/ai/models`, { headers });
    if (!res.ok) throw new Error(`listModels failed: HTTP ${res.status}`);
    return res.json();
  }

  async function generateText(prompt: string, opts: AiClientOptions = {}): Promise<string> {
    const res = await fetch(`${base}/api/ai/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, model: opts.model, temperature: opts.temperature }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.error || `generateText failed: HTTP ${res.status}`);
    }
    const data: any = await res.json();
    return data.text;
  }

  async function* generateTextStream(prompt: string, opts: AiClientOptions = {}): AsyncGenerator<string> {
    const res = await fetch(`${base}/api/ai/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, model: opts.model, temperature: opts.temperature, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`generateTextStream failed: HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; keep the trailing partial.
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const evt of events) {
        const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(5).trim());
        if (payload.error) throw new Error(payload.error);
        if (payload.done) return;
        if (payload.chunk) yield payload.chunk;
      }
    }
  }

  return { listModels, generateText, generateTextStream };
}
