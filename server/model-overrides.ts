// V7 M-038 — per-model settings (num_ctx / temperature / keep_alive / system prompt).
// Pure merge logic only (no I/O): providers.ts applies these against the persisted
// db.data.modelOverrides map; server.ts sanitizes the HTTP body through here.

export interface ModelOverride {
  /** ollama options.num_ctx — context window tokens. */
  numCtx?: number;
  /** ollama options.temperature (0..2). */
  temperature?: number;
  /** ollama top-level keep_alive: a duration like "10m", "0" (unload now), "-1" (forever). */
  keepAlive?: string;
  /** System prompt prepended as the first role:"system" message when the conversation has none. */
  system?: string;
}

// keep_alive forms ollama accepts: signed integer (seconds; -1 = forever) or a duration like "30m"/"1h".
const KEEP_ALIVE_RE = /^-?\d+(\.\d+)?(ns|us|µs|ms|s|m|h)?$/;

/** Validate an untrusted HTTP body field-by-field. Returns null when nothing valid
 *  remains — the route treats that as "clear the override for this model". */
export function sanitizeModelOverride(raw: unknown): ModelOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: ModelOverride = {};
  const numCtx = Number(r.numCtx);
  if (r.numCtx != null && Number.isFinite(numCtx) && numCtx > 0) out.numCtx = Math.floor(numCtx);
  const temperature = Number(r.temperature);
  if (r.temperature != null && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) {
    out.temperature = temperature;
  }
  if (typeof r.keepAlive === "string" && KEEP_ALIVE_RE.test(r.keepAlive.trim())) out.keepAlive = r.keepAlive.trim();
  if (typeof r.system === "string" && r.system.trim()) out.system = r.system.trim().slice(0, 8000);
  return Object.keys(out).length ? out : null;
}

/** Precedence: explicit per-request value > per-model override > global default.
 *  numCtx uses || (0/undefined both fall through, matching the existing router line);
 *  temperature uses ?? so an explicit 0 is honored. */
export function resolveModelTuning(
  config: { numCtx?: number; temperature?: number },
  ov: ModelOverride | undefined,
  dbNumCtx?: number,
): { numCtx: number; temperature: number } {
  return {
    numCtx: config.numCtx || ov?.numCtx || dbNumCtx || 8192,
    temperature: config.temperature ?? ov?.temperature ?? 0.7,
  };
}

/** keep_alive precedence: per-model override > OLLAMA_KEEP_ALIVE env > "30m" (today's default). */
export function resolveKeepAlive(ov: ModelOverride | undefined, envDefault?: string): string {
  return ov?.keepAlive ?? envDefault ?? "30m";
}

/** Prepend the override system prompt as the first message — ONLY when the conversation
 *  carries no system message of its own (an explicit conversation system always wins). */
export function withSystemOverride<T extends { role: string; content: string }>(
  messages: T[],
  system?: string,
): T[] {
  const msgs = messages || [];
  if (!system) return msgs;
  if (msgs.some((m) => m.role === "system")) return msgs;
  return [{ role: "system", content: system } as T, ...msgs];
}
