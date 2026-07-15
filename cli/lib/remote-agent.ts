// RemoteAgentClient — dispatch ONE agent task to a REMOTE ollamas server over HTTP
// /api/agent/chat (SSE) and fold the stream into a structured report.
//
// This is the cli-lane mirror of scripts/agent-dispatch.mjs (the oracle): same request
// body shape, same SSE event handling, same demo-detection + verdict logic
// (agent-dispatch.mjs:106/109). It is a THIN fetch wrapper — N-012 choke-point law:
// the remote machine's own server is the single tool choke-point, so this file NEVER
// imports the server's tool registry module. The ReAct inner loop runs on the worker; only
// the task-spec (out) and the structured report (back) cross the wire (SPEC_DISPATCH §2).
//
// Pure split: parseDispatchReport(events) folds canned SSE events with no IO (testable);
// dispatch() is the only IO surface (fetch + AbortController timeout).
import { parseSSEBuffer } from "./client";
import type { Backend } from "./remote";

// Re-export so the dispatch lane can build a worker pool without a second remote.ts import.
export type { Backend } from "./remote";
export { selectBackend } from "./remote";

// One parsed SSE `data:` frame from /api/agent/chat. Mirrors the server's event union
// (client.ts:AgentEvent) but kept structurally loose — parseDispatchReport tolerates any
// shape (totality: never throws on a malformed/unknown frame).
export interface DispatchEvent {
  type?: string;
  stepNum?: number;
  tool?: string;
  ok?: boolean;
  result?: any;
  args?: { path?: string; [k: string]: any };
  text?: string;
  message?: string;
  [k: string]: any;
}

export interface DispatchStep {
  n: number | undefined;
  tool: string | undefined;
  ok: boolean | undefined;
  out: string;
}

export interface DispatchReport {
  host: string;
  steps: DispatchStep[];
  files: string[];
  errors: string[];
  messages: string[];
  demoSuspected: boolean;
  verdict: "DONE" | "BLOCKED" | "OK" | "INCOMPLETE";
  tokensPerSec: number; // final-generation throughput from the done event (0 when absent)
}

export interface DispatchTask {
  prompt: string;
  provider?: string;
  model?: string;
  maxSteps?: number;
  root: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000; // agent-dispatch.mjs:30 OLLAMAS_TIMEOUT_MS default
const DEFAULT_MAX_STEPS = Number(process.env.OLLAMAS_MAX_STEPS) || 40; // raised from 10 so executors run long
const DEFAULT_PROVIDER = "ollama-local"; // agent-dispatch.mjs:24

// eCyPro calibration standards prepended to every dispatched task — verbatim mirror of
// agent-dispatch.mjs:42-54 so a remote run matches the main-thread quality bar (root-cause,
// single writable root, evidence-over-assertion, terminal VERDICT line the verdict regex reads).
export function buildStandards(prompt: string, root: string): string {
  return [
    "[ollamas sub-agent — operate at eCyPro standards]",
    "- Minimize steps. Do NOT call the same tool twice with the same args. No exploration the task does not require.",
    `- The ONLY writable root is ${root} — write files there with absolute paths.`,
    "- For a fresh file: write_host_file it directly, then immediately macos_terminal to RUN it and show the exact stdout. Investigate existing code (read_file/grep_search) ONLY when the task references code that already exists.",
    "- grep_search: pass ONE literal pattern, NO shell metacharacters (| & ; > < ` $ are blocked). For alternation run separate searches. If a tool is refused, change approach — do NOT retry the same call.",
    "- Evidence over assertion: never fabricate output — show the real macos_terminal stdout and confirm it matches the expected result.",
    "- If a tool errors, report the exact error and stop (do not retry blindly).",
    "- When the result is verified, STOP immediately and emit a final line exactly: VERDICT: DONE <one-line proof>   (or  VERDICT: BLOCKED <reason>).",
    "",
    "TASK:",
    prompt,
  ].join("\n");
}

// Build the request body — IDENTICAL shape to agent-dispatch.mjs:56-57.
// model is OMITTED entirely when empty (provider keeps its own default).
export function buildDispatchBody(task: DispatchTask): string {
  const provider = task.provider || DEFAULT_PROVIDER;
  const model =
    task.model !== undefined && task.model !== ""
      ? task.model
      : provider === "ollama-local"
        ? "qwen3:8b" // ollama-local bench-proven default (agent-dispatch.mjs:28)
        : "";
  const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
  const content = buildStandards(task.prompt, task.root);
  return JSON.stringify({
    provider,
    ...(model ? { model } : {}),
    autoApply: true,
    maxSteps,
    messages: [{ role: "user", content }],
  });
}

// PURE CORE — fold the SSE event list into a structured report. No IO, total
// (never throws on any input), deterministic. Mirrors agent-dispatch.mjs:83-109.
export function parseDispatchReport(
  events: DispatchEvent[],
  host = "",
): DispatchReport {
  const steps: DispatchStep[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  const messages: string[] = [];
  let tokensPerSec = 0;

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.type === "step") {
      const out = typeof ev.result === "string" ? ev.result : safeStringify(ev.result);
      steps.push({ n: ev.stepNum, tool: ev.tool, ok: ev.ok, out: (out || "").slice(0, 2000) });
      // write_host_file / write_file proposals carry the file path in args.
      if (ev.tool === "write_host_file" || ev.tool === "write_file") {
        const p = ev.args?.path;
        if (p) files.push(p);
      }
    } else if (ev.type === "message") {
      if (ev.text?.trim()) messages.push(ev.text.trim());
    } else if (ev.type === "done") {
      if (ev.text?.trim()) messages.push(ev.text.trim());
      const t = (ev as { tokensPerSec?: unknown }).tokensPerSec;
      if (typeof t === "number" && Number.isFinite(t)) tokensPerSec = t;
    } else if (ev.type === "error") {
      errors.push(ev.message || "unknown");
    }
  }

  // Demo detection: a real run drives tools; zero tool steps + a chatty message with no
  // error is the classic demo/refusal signature (agent-dispatch.mjs:106).
  const demoSuspected = steps.length === 0 && messages.length > 0 && errors.length === 0;
  const allOk =
    steps.length > 0 && steps.every((s) => s.ok) && errors.length === 0 && !demoSuspected;
  const finalMsg = messages[messages.length - 1] || "";
  // Verdict regex parity with agent-dispatch.mjs:109.
  const verdict: DispatchReport["verdict"] = /VERDICT:\s*DONE/i.test(finalMsg)
    ? "DONE"
    : /VERDICT:\s*BLOCKED/i.test(finalMsg)
      ? "BLOCKED"
      : allOk
        ? "OK"
        : "INCOMPLETE";

  return { host, steps, files, errors, messages, demoSuspected, verdict, tokensPerSec };
}

// JSON.stringify that never throws (circular/exotic result payloads → "").
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

// THIN IO — POST the task to a remote worker's /api/agent/chat, stream the SSE,
// and fold it via parseDispatchReport. NEVER throws on an HTTP/network/timeout
// failure: the failure is recorded in report.errors → verdict INCOMPLETE
// (agent-dispatch.mjs treats HTTP !ok as a hard error; here it's a soft, reported
// failure so the dispatch supervisor can re-route per the Hybrid failover contract).
export class RemoteAgentClient {
  async dispatch(host: string, port: number, task: DispatchTask): Promise<DispatchReport> {
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `http://${host}:${port}/api/agent/chat`;
    const body = buildDispatchBody(task);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const events: DispatchEvent[] = [];
    const ioErrors: string[] = [];

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body,
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        ioErrors.push(`dispatch failed: HTTP ${res.status}`);
      } else {
        // Drain the SSE stream with the shared pure parser (client.ts:parseSSEBuffer).
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSSEBuffer(buffer);
          buffer = parsed.rest;
          for (const ev of parsed.events) events.push(ev as DispatchEvent);
        }
      }
    } catch (e: any) {
      ioErrors.push(ac.signal.aborted ? `timeout after ${timeoutMs}ms` : e?.message || String(e));
    } finally {
      clearTimeout(timer);
    }

    const report = parseDispatchReport(events, `${host}:${port}`);
    // Merge IO failures (HTTP/network/timeout) into the report and recompute the verdict:
    // any IO error with no successful tool run ⟹ INCOMPLETE (never DONE/OK).
    if (ioErrors.length) {
      report.errors.push(...ioErrors);
      report.demoSuspected = false; // an IO error is not a demo signature
      if (report.verdict === "OK" || report.verdict === "DONE") {
        report.verdict = "INCOMPLETE";
      }
    }
    return report;
  }

  // Convenience: dispatch to a fleet Backend (url like http://host:port). Splits the
  // url so callers holding a Backend (selectBackend output) need not re-parse.
  async dispatchToBackend(backend: Backend, task: DispatchTask): Promise<DispatchReport> {
    const { host, port } = parseBackendUrl(backend.url);
    return this.dispatch(host, port, task);
  }
}

// Split a backend url (http://host:port or host:port) into host + numeric port.
// Defaults port to 8090 (the ollamas server default) when absent.
export function parseBackendUrl(url: string): { host: string; port: number } {
  const stripped = (url || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const idx = stripped.lastIndexOf(":");
  const host = idx === -1 ? stripped : stripped.slice(0, idx);
  // Reject empty/malformed input early — an empty host would build `http://:8090` (invalid).
  if (!host) throw new Error(`invalid backend url (no host): ${JSON.stringify(url)}`);
  if (idx === -1) return { host, port: 8090 };
  const port = Number(stripped.slice(idx + 1));
  return { host, port: Number.isFinite(port) && port > 0 ? port : 8090 };
}
