// server/gemini-cli.ts — drive Google's Gemini CLI as a concurrent ollamas backend.
//
// The ProviderRouter "gemini-cli" provider spawns the external `gemini` binary headless
// (`--output-format json`) and returns the final answer. Gemini runs its OWN agent loop,
// so this returns plain text (NO tool_calls) → the ollamas ReAct loop treats it as a final
// reply and halts. Concurrency: N dispatched tasks each spawn an independent `gemini` process.
//
// Self-contained (no cli/ import — server is the lower layer): minimal spawn + json parse.
// The headless contract (json shape, exit codes) is documented in docs/GEMINI_CLI_RESEARCH.md.
import { spawn } from "node:child_process";

// Structural — matches ProviderMessage (role/content) without coupling to its module.
interface Msg { role: string; content?: unknown }

export interface GeminiCliResult { text: string; modelUsed: string; latencyMs: number }

// Flatten a ReAct history into ONE prompt: the system instruction + the readable transcript.
// Pure → unit-testable. Gemini is stateless per call, so the whole conversation is inlined.
export function flattenForGemini(messages: Msg[]): string {
  const list = Array.isArray(messages) ? messages : [];
  const sys = String(list.find((m) => m.role === "system")?.content ?? "");
  const convo = list
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")}`)
    .join("\n\n");
  return [sys, convo].filter(Boolean).join("\n\n");
}

// Extract the answer from a `--output-format json` body ({response,...}); fall back to raw.
// Pure, tolerant, never throws.
export function extractGeminiText(stdout: string): string {
  const t = (stdout || "").trim();
  if (!t) return "";
  try {
    const o = JSON.parse(t);
    if (o && typeof o === "object" && typeof (o as any).response === "string") return (o as any).response;
  } catch { /* not json → raw */ }
  return t;
}

// Run the gemini binary headless for one generation. Throws on a non-zero exit (so the
// ProviderRouter chain falls through to the next provider) with the stderr reason.
export async function generateViaGeminiCli(
  messages: Msg[],
  model?: string,
  signal?: AbortSignal,
  bin = "gemini",
): Promise<GeminiCliResult> {
  const prompt = flattenForGemini(messages);
  const args = ["--output-format", "json", ...(model ? ["--model", model] : []), prompt];
  const start = Date.now();
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    const done = (r: { code: number | null; stdout: string; stderr: string }) => { signal?.removeEventListener("abort", onAbort); resolve(r); };
    child.on("error", (e) => done({ code: null, stdout: out, stderr: err || String((e as any)?.message || e) }));
    child.on("close", (c) => done({ code: c, stdout: out, stderr: err }));
  });
  // Exit codes (headless contract): 0 ok · 1 api/general · 42 input · 53 turn-limit.
  if (code !== 0) {
    const reason = (stderr || stdout).trim().slice(0, 240) || "no output";
    throw new Error(`gemini-cli exit ${code === null ? "spawn-failed (binary not installed?)" : code}: ${reason}`);
  }
  return { text: extractGeminiText(stdout), modelUsed: model || "gemini (default)", latencyMs: Date.now() - start };
}

// Is the `gemini` binary installed? Cheap probe for /api/models + health.
export function geminiCliAvailable(bin = "gemini"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (c) => resolve(c === 0));
  });
}
