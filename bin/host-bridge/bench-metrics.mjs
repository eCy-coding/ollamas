// bench-metrics — pure, side-effect-free tok/s extraction for the cross-platform
// benchmark (scripts domain v4). Kept separate from benchmark.mjs so the math is
// unit-testable with fixtures (no network, no fs).
//
// Adopted from the proven Ollama-metrics pattern in MinhNgyuen/llm-benchmark
// (MIT License, https://github.com/MinhNgyuen/llm-benchmark): Ollama's
// /api/generate (stream:false) returns nanosecond timers + token counts, and
// throughput is count / (duration_ns * 1e-9). We split prompt-eval vs response
// the same way it does.
import os from "node:os";

const NS_PER_SEC = 1e9;

// tok/s from a token count and a nanosecond duration. Guards div-by-zero and
// missing fields (Ollama omits prompt_eval_* on a fully cached prompt).
export function tokensPerSecond(count, durationNs) {
  if (!count || !durationNs || durationNs <= 0) return null;
  return count / (durationNs / NS_PER_SEC);
}

// Pull prompt/response throughput out of a raw Ollama /api/generate response.
// Returns nulls (not throws) when a field is absent so callers can fall back.
export function extractOllamaMetrics(resp) {
  const r = resp || {};
  const promptTokens = r.prompt_eval_count ?? null;
  const responseTokens = r.eval_count ?? null;
  const promptTps = tokensPerSecond(r.prompt_eval_count, r.prompt_eval_duration);
  const responseTps = tokensPerSecond(r.eval_count, r.eval_duration);
  // total throughput = all generated tokens over the wall portion Ollama timed.
  const totalTokens =
    (promptTokens || 0) + (responseTokens || 0) || null;
  const totalDurationNs = r.total_duration ?? null;
  const totalTps = tokensPerSecond(totalTokens, totalDurationNs);
  return {
    promptTokens,
    responseTokens,
    promptTps: round1(promptTps),
    responseTps: round1(responseTps),
    totalTps: round1(totalTps),
  };
}

function round1(n) {
  return n == null ? null : +n.toFixed(1);
}

// --platform macos|ios  (default macos). Unknown value -> macos with no throw;
// the bench prints what it picked.
export function parsePlatformArg(argv) {
  const i = argv.indexOf("--platform");
  if (i === -1) return "macos";
  const v = (argv[i + 1] || "").toLowerCase();
  return v === "ios" ? "ios" : "macos";
}

// Local hardware identity for the benchmark.json key. Pure read of os.* — no
// shelling out (calibrate_hardware.py does the deeper probe).
export function detectDevice() {
  const cpus = os.cpus() || [];
  return {
    device: os.hostname(),
    arch: process.arch,
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    ncpu: cpus.length,
    memGb: Math.round(os.totalmem() / 1073741824),
  };
}

// Score a model's code-run result HONESTLY (v1.25.1 bench honesty).
// A bridge/terminal failure means we COULD NOT MEASURE correctness — that is
// `null` (unknown), NEVER `false`. "unmeasured ≠ wrong": a down bridge daemon or a
// macOS-TCC denial must not be recorded as the model answering incorrectly.
// Only a run that actually produced output is judged correct/incorrect.
export function scoreRun(runResult, expected) {
  const r = runResult || {};
  if (r.bridgeError) {
    return { ran: null, correct: null, out: "", bridgeError: r.status ?? true };
  }
  const out = (r.output || "").trim();
  return { ran: r.exitCode === 0, correct: out.includes(expected), out };
}

// Canonical benchmark.json record shape (v4 schema key: platform+device+method).
export function benchRecord({
  platform,
  device,
  method,
  model,
  promptTps = null,
  responseTps = null,
  totalTps = null,
  latencyMs = null,
  correct = null,
  ts,
}) {
  return {
    platform,
    device,
    method,
    model,
    promptTps,
    responseTps,
    totalTps,
    latencyMs,
    correct,
    ts,
  };
}
