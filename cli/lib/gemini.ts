// cli/lib/gemini.ts — pure core + thin IO for the Gemini CLI bridge.
//
// ollamas drives Google's Gemini CLI (`@google/gemini-cli`) as a subprocess: it builds
// the argv, runs `gemini` headless (--output-format json|stream-json), and normalizes the
// result. Choke-point safe (N-012): this shells out to the external `gemini` binary, it
// never imports server/tool-registry. Zero-dep: only node:child_process built-ins.
//
// Research: docs/GEMINI_CLI_RESEARCH.md (headless contract, exit codes, auth modes).
import { spawn, execFile } from "node:child_process";

export interface GeminiRunOpts {
  prompt: string;
  model?: string;
  /** "json" → one object; "stream-json" → JSONL events; undefined → plain text. */
  format?: "json" | "stream-json";
  /** Auto-approve ALL tool calls (sandboxed). Security: trusted input only. */
  yolo?: boolean;
  /** Explicit approval mode (mutually exclusive with yolo per the CLI). */
  approvalMode?: "default" | "auto_edit" | "yolo" | "plan";
  includeDirs?: string[];
}

// Map a `gemini` process exit code to a typed verdict. Exit codes are part of the
// headless contract: 0 ok · 1 general/API · 42 input error · 53 turn-limit exceeded.
export type GeminiExitKind = "success" | "apiError" | "inputError" | "turnLimit" | "unknown";
export function mapExitCode(code: number | null): { ok: boolean; kind: GeminiExitKind } {
  switch (code) {
    case 0: return { ok: true, kind: "success" };
    case 1: return { ok: false, kind: "apiError" };
    case 42: return { ok: false, kind: "inputError" };
    case 53: return { ok: false, kind: "turnLimit" };
    default: return { ok: false, kind: "unknown" };
  }
}

// Human-readable hint per exit kind (CLI surfaces this to the user).
export function exitHint(kind: GeminiExitKind): string {
  switch (kind) {
    case "success": return "ok";
    case "apiError": return "general or API error — check auth (GEMINI_API_KEY / OAuth / Vertex) and connectivity";
    case "inputError": return "input error — invalid prompt or arguments";
    case "turnLimit": return "turn limit exceeded — the agent hit its step budget";
    default: return "unknown exit";
  }
}

// Pure: build the gemini argv from options. Positional prompt (the `-p` flag is being
// deprecated toward positional). `--yolo` and `--approval-mode` are mutually exclusive,
// so yolo maps to `--approval-mode=yolo`.
export function buildGeminiArgs(opts: GeminiRunOpts): string[] {
  const args: string[] = [];
  if (opts.model) args.push("--model", opts.model);
  if (opts.format) args.push("--output-format", opts.format);
  if (opts.yolo) args.push("--approval-mode", "yolo");
  else if (opts.approvalMode) args.push("--approval-mode", opts.approvalMode);
  for (const d of opts.includeDirs ?? []) args.push("--include-directories", d);
  // Prompt last, positional (kept as the final token so flags never swallow it).
  args.push(opts.prompt);
  return args;
}

export interface GeminiJson {
  response: string;
  stats?: unknown;
  error?: { message?: string; [k: string]: unknown };
}

// Pure + tolerant: parse the `--output-format json` body. Returns null when the text is
// not the expected object (caller falls back to raw stdout). Never throws.
export function parseGeminiJson(stdout: string): GeminiJson | null {
  const t = (stdout || "").trim();
  if (!t) return null;
  let v: unknown;
  try { v = JSON.parse(t); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const response = typeof o.response === "string" ? o.response : "";
  const out: GeminiJson = { response };
  if ("stats" in o) out.stats = o.stats;
  if (o.error && typeof o.error === "object") out.error = o.error as GeminiJson["error"];
  return out;
}

// Pure: fold a stream-json (JSONL) transcript into a final {response} + the event list.
// Event types: init | message | tool_use | tool_result | error | result.
export function foldStreamJson(jsonl: string): { response: string; events: Array<Record<string, unknown>>; toolCalls: number } {
  const events: Array<Record<string, unknown>> = [];
  let response = "";
  let toolCalls = 0;
  for (const line of (jsonl || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let ev: unknown;
    try { ev = JSON.parse(s); } catch { continue; }
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    events.push(e);
    if (e.type === "tool_use") toolCalls++;
    // `result` carries the final aggregated answer; `message` chunks accumulate.
    if (e.type === "result" && typeof e.response === "string") response = e.response;
    else if (e.type === "message" && typeof e.text === "string" && !response) response = e.text;
  }
  return { response, events, toolCalls };
}

// Resolve which auth mode the environment selects (for status/preflight reporting).
export function detectAuthMode(env: NodeJS.ProcessEnv = process.env): { mode: string; detail: string } {
  if (env.GOOGLE_GENAI_USE_VERTEXAI === "true" || env.GOOGLE_GENAI_USE_VERTEXAI === "1") {
    return { mode: "vertex", detail: `project=${env.GOOGLE_CLOUD_PROJECT ?? "?"} location=${env.GOOGLE_CLOUD_LOCATION ?? "?"}` };
  }
  if (env.GEMINI_API_KEY) return { mode: "api-key", detail: "GEMINI_API_KEY set" };
  if (env.GOOGLE_API_KEY) return { mode: "api-key", detail: "GOOGLE_API_KEY set" };
  return { mode: "oauth", detail: "Sign in with Google (~/.gemini/oauth_creds.json) — free tier 60/min, 1000/day" };
}

// ── thin IO ───────────────────────────────────────────────────────────────────────

// Is the external `gemini` binary on PATH? Resolves its version, never throws.
export function detectGemini(bin = "gemini"): Promise<{ present: boolean; version?: string }> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve({ present: false });
      resolve({ present: true, version: String(stdout || "").trim() });
    });
  });
}

export interface GeminiResult { code: number | null; stdout: string; stderr: string }

// Run `gemini` headless, capturing stdout/stderr. For --output-format json the whole body
// is buffered; for stream-json the caller can pass onChunk to forward JSONL live.
export function spawnGemini(
  opts: GeminiRunOpts,
  io: { bin?: string; timeoutMs?: number; onChunk?: (s: string) => void; env?: NodeJS.ProcessEnv } = {},
): Promise<GeminiResult> {
  const args = buildGeminiArgs(opts);
  return new Promise((resolve) => {
    // gemini-cli v0.49+ blocks headless runs in an "untrusted" directory unless
    // GEMINI_CLI_TRUST_WORKSPACE is set → required for non-interactive automation.
    const baseEnv = io.env ?? process.env;
    const env = { ...baseEnv, GEMINI_CLI_TRUST_WORKSPACE: baseEnv.GEMINI_CLI_TRUST_WORKSPACE || "true" };
    const child = spawn(io.bin ?? "gemini", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = io.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), io.timeoutMs) : null;
    child.stdout.on("data", (d) => { const s = String(d); stdout += s; io.onChunk?.(s); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => { if (timer) clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr || String(e?.message || e) }); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
