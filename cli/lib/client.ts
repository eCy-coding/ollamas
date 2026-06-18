// Thin gateway client. The CLI is a HTTP/MCP client ONLY — it never imports
// ToolRegistry. Every tool side effect goes through the gateway's single
// choke-point (AGENTS.md §4). This file holds no dispatch logic.
import type { DoctorReport } from "./output";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamMeta {
  source?: string;
  latencyMs?: number;
  tokensPerSec?: number;
}

// Split an accumulating SSE buffer into complete events + remainder.
// Pure → unit-testable without a socket. Each event is the parsed `data:` JSON.
export function parseSSEBuffer(buffer: string): { events: any[]; rest: string } {
  const events: any[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
  return { events, rest };
}

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async health(timeoutMs = 8000): Promise<any> {
    const r = await fetch(`${this.baseUrl}/api/health`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`gateway /api/health → ${r.status}`);
    return r.json();
  }

  // Stream a one-shot generation. Calls onChunk per token; resolves with final meta.
  async generateStream(
    messages: ChatMessage[],
    opts: { provider?: string; model?: string; temperature?: number },
    onChunk: (text: string) => void,
  ): Promise<StreamMeta> {
    const r = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...opts, messages, stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`gateway /api/generate → ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let meta: StreamMeta = {};
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) {
        if (ev.error) throw new Error(String(ev.error));
        if (typeof ev.chunk === "string") onChunk(ev.chunk);
        if (ev.done) meta = { source: ev.source, latencyMs: ev.latencyMs, tokensPerSec: ev.tokensPerSec };
      }
    }
    return meta;
  }
}

// Probe ollama + bridge directly for the doctor command. Gateway already
// reports ollama, but probing the source is more honest about a degraded stack.
export async function buildDoctorReport(
  client: GatewayClient,
  ollamaHost: string,
  nowIso: string,
): Promise<DoctorReport> {
  const gateway = await safeProbe(() => client.health());
  const ollama = await safeProbe(async () => {
    const r = await fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
  const bridge = await safeProbe(async () => {
    const r = await fetch("http://127.0.0.1:7345/health", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

  return {
    ts: nowIso,
    healthy: gateway.ok && ollama.ok,
    gateway: { ok: gateway.ok, detail: gateway.ok ? `mode=${gateway.value?.mode ?? "?"}` : gateway.error },
    ollama: { ok: ollama.ok, detail: ollama.ok ? `v${ollama.value?.version ?? "?"}` : ollama.error },
    bridge: { ok: bridge.ok, detail: bridge.ok ? `terminals=${countOf(bridge.value?.terminals)}` : "not running (macOS-only)" },
  };
}

// Collapse an unknown terminals payload (array | object | scalar) to a count.
function countOf(v: unknown): number | string {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return v == null ? "?" : String(v);
}

async function safeProbe<T>(fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error: string }> {
  try {
    return { ok: true, value: await fn(), error: "" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
