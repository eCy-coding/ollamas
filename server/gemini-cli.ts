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
import { cpus } from "node:os";

// Structural — matches ProviderMessage (role/content) without coupling to its module.
interface Msg { role: string; content?: unknown }

export interface GeminiCliResult { text: string; modelUsed: string; latencyMs: number; tokensPerSec?: number }

// E2 — pure counting semaphore: caps concurrent `gemini` spawns so N parallel dispatched
// tasks don't storm the machine. acquire() resolves when a slot is free; release() frees one.
export function makeSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => { active--; const next = queue.shift(); if (next) { active++; next(); } };
  const acquire = (): Promise<void> => new Promise((res) => {
    if (active < max) { active++; res(); } else queue.push(res);
  });
  return { acquire, release, get active() { return active; }, get waiting() { return queue.length; } };
}
// Cap = cores-2, clamped to [1,8]. The gemini binary is the real bottleneck; this just avoids a storm.
const SPAWN_CAP = Math.max(1, Math.min(8, (cpus()?.length || 4) - 2));
const spawnGate = makeSemaphore(SPAWN_CAP);

// E1 — TTL cache for the `gemini --version` availability probe (hot path: /api/models). 8s,
// mirrors ProviderRouter.probeFleet. null = never probed.
let availCache: { at: number; ok: boolean } | null = null;
const AVAIL_TTL_MS = 8000;

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
  apiKey?: string,
): Promise<GeminiCliResult> {
  const prompt = flattenForGemini(messages);
  const args = ["--output-format", "json", ...(model ? ["--model", model] : []), prompt];
  const start = Date.now();
  await spawnGate.acquire(); // E2 — bounded concurrency
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await new Promise((resolve) => {
      // GEMINI_CLI_TRUST_WORKSPACE: gemini-cli v0.49+ refuses headless runs in an "untrusted"
      // directory unless this is set → required for non-interactive automation. apiKey (from the
      // pool) makes the binary use a rotatable API key (per-key 1000/day × N) instead of the
      // shared OAuth free tier — the sustainable path.
      const env = {
        ...process.env,
        GEMINI_CLI_TRUST_WORKSPACE: process.env.GEMINI_CLI_TRUST_WORKSPACE || "true",
        ...(apiKey ? { GEMINI_API_KEY: apiKey } : {}),
      };
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env });
      let out = ""; let err = "";
      const onAbort = () => child.kill("SIGKILL");
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d) => { out += String(d); });
      child.stderr.on("data", (d) => { err += String(d); });
      const done = (r: { code: number | null; stdout: string; stderr: string }) => { signal?.removeEventListener("abort", onAbort); resolve(r); };
      child.on("error", (e) => done({ code: null, stdout: out, stderr: err || String((e as any)?.message || e) }));
      child.on("close", (c) => done({ code: c, stdout: out, stderr: err }));
    });
  } finally {
    spawnGate.release();
  }
  const { code, stdout, stderr } = result;
  // Exit codes (headless contract): 0 ok · 1 api/general · 42 input · 53 turn-limit.
  if (code !== 0) {
    const reason = (stderr || stdout).trim().slice(0, 240) || "no output";
    throw new Error(`gemini-cli exit ${code === null ? "spawn-failed (binary not installed?)" : code}: ${reason}`);
  }
  const text = extractGeminiText(stdout);
  const latencyMs = Date.now() - start;
  return { text, modelUsed: model || "gemini (default)", latencyMs, tokensPerSec: estimateTokensPerSec(text, latencyMs) };
}

// E3 — wall-clock tok/s estimate (~4 chars/token) so dispatch-bench/telemetry can rank
// gemini-cli (it doesn't report eval_count). Pure. 0 when no text/elapsed.
export function estimateTokensPerSec(text: string, latencyMs: number): number {
  if (!text || latencyMs <= 0) return 0;
  return Math.round(((text.length / 4) / (latencyMs / 1000)) * 10) / 10;
}

// Is the `gemini` binary installed? E1 — 8s TTL cache (hot path: /api/models).
export function geminiCliAvailable(bin = "gemini", nowMs = Date.now()): Promise<boolean> {
  if (availCache && nowMs - availCache.at < AVAIL_TTL_MS) return Promise.resolve(availCache.ok);
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    const settle = (ok: boolean) => { availCache = { at: nowMs, ok }; resolve(ok); };
    child.on("error", () => settle(false));
    child.on("close", (c) => settle(c === 0));
  });
}
