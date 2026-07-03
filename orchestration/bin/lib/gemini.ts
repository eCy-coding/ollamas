// gemini.ts (pure) — adapter for the Gemini CLI as a first-class fleet vendor. IO-free → unit-tested; the
// dispatch (shelling `gemini`) lives in fleet-agent.
//
// Why: the orchestra dispatched only ollama (local/cloud). Gemini CLI (0.49.0) is installed + account-authed,
// so it can be a PROPOSE-only worker: `--approval-mode plan` is READ-ONLY (no file mutation — the conductor
// applies), `-o json` gives a parseable `{session_id, response, stats}`, `--skip-trust` runs headless. The
// only live failure was a transient 503 "high demand" on the default model → handled by backoff + a `flash`
// fallback in the dispatcher. This module builds the args, parses the JSON, and classifies overload.

/** A gemini model tag (routes to the gemini-cli provider instead of ollama). */
export function isGeminiModel(tag: string): boolean {
  return /^gemini[-.\d]/i.test(tag || "");
}

/** Headless, read-only gemini invocation args. `plan` = read-only approval mode (PROPOSE-safe). */
export function geminiArgs(prompt: string, model: string, opts: { plan?: boolean } = {}): string[] {
  const args = ["-p", prompt];
  if (model) args.push("-m", model);
  args.push("--approval-mode", opts.plan === false ? "default" : "plan", "-o", "json", "--skip-trust");
  return args;
}

/** Parse `gemini -o json` stdout → {text, ok}. Tolerates leading noise by scanning to the first `{`.
 *  Extracts `.response` (the model's text). Empty/unparseable → ok:false. */
export function parseGeminiJson(stdout: string): { text: string; ok: boolean } {
  const s = stdout || "";
  const i = s.indexOf("{");
  if (i < 0) return { text: "", ok: false };
  try {
    const j = JSON.parse(s.slice(i));
    const text = String(j?.response ?? j?.text ?? j?.output ?? "").trim();
    return { text, ok: text.length > 0 };
  } catch {
    return { text: "", ok: false };
  }
}

/** TRANSIENT vendor overload — Gemini returns 503 / UNAVAILABLE / "high demand" under momentary load. Retry
 *  with backoff (it clears in seconds). NOT quota exhaustion (see isGeminiQuotaExhausted). */
export function isGeminiOverload(text: string): boolean {
  return /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(text || "");
}

/** TERMINAL daily-quota exhaustion — 429 / RESOURCE_EXHAUSTED / "exhausted…quota". Retrying does NOT help (the
 *  free-tier daily cap resets in hours), so the dispatcher must FAIL FAST instead of burning backoff attempts. */
export function isGeminiQuotaExhausted(text: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|exhausted.{0,20}quota|exceeded your current quota|daily quota/i.test(text || "");
}
