// Pure helpers for `ollamas agent watch`. No I/O — fully unit-testable.

export interface WatchEvent {
  id: number;   // SSE event id (message index)
  data: any;    // parsed ChatMessage or done envelope
}

export interface BackoffOpts {
  base?: number;   // initial delay ms (default 500)
  cap?: number;    // max delay ms (default 15000)
  jitter?: boolean; // add random jitter within [0, delay) (default true)
}

// Exponential backoff with cap + optional jitter. Pure → deterministic seed-able.
// attempt=0 → base; each step doubles until cap.
export function nextBackoff(attempt: number, opts: BackoffOpts = {}): number {
  const base = opts.base ?? 500;
  const cap = opts.cap ?? 15_000;
  const jitter = opts.jitter !== false; // default true
  const raw = Math.min(base * Math.pow(2, attempt), cap);
  if (!jitter) return raw;
  // Uniform jitter in [0, raw)
  return Math.floor(Math.random() * raw);
}

// Render a ChatMessage (or agent SSE event) for human display.
// role-aware: user=prompt prefix, assistant=answer, tool=tool output.
export function renderWatchEvent(msg: { role?: string; content?: string; type?: string; text?: string }): string {
  // SSE events from the events endpoint are ChatMessage-shaped: {role, content}
  const role = msg.role ?? msg.type ?? "unknown";
  const body = (msg.content ?? msg.text ?? "").trim();
  switch (role) {
    case "user":
      return `> ${body}`;
    case "assistant":
      return body;
    case "tool":
      return `[tool] ${body}`;
    case "system":
      return `[system] ${body}`;
    default:
      return `[${role}] ${body}`;
  }
}

// Parse SSE frames from the events endpoint. Each frame may have:
//   id: <idx>
//   event: done
//   data: <json>
// Returns parsed WatchEvents and leftover buffer.
export function parseWatchSSEBuffer(buffer: string): { events: WatchEvent[]; done: boolean; rest: string } {
  const events: WatchEvent[] = [];
  let done = false;
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let id = -1;
    let isEventDone = false;
    let dataStr = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("id:")) id = parseInt(line.slice(3).trim(), 10);
      else if (line.startsWith("event:") && line.slice(6).trim() === "done") isEventDone = true;
      else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
    }
    if (isEventDone) { done = true; break; }
    if (!dataStr) continue;
    try {
      events.push({ id, data: JSON.parse(dataStr) });
    } catch { /* ignore malformed */ }
  }
  return { events, done, rest };
}

// Build the session picker prompt string (pure, no readline).
export function buildPickerPrompt(sessions: { id: string; title?: string; updatedAt?: string }[]): string {
  const lines = sessions.map((s, i) => `  ${i + 1}) ${s.id.slice(0, 8)}  ${(s.title || "").slice(0, 40).padEnd(40)}  ${s.updatedAt || ""}`);
  return lines.join("\n");
}
