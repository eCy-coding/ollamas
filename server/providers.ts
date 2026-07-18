import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import { parseBackendPool, selectBackend, type Backend, type BackendProbe } from "../cli/lib/remote";
import { generateViaGeminiCli, geminiCliAvailable } from "./gemini-cli";
import { keyId, recordKeyUse, keyWindows, recordCallCost, keyUsageSnapshot, hydrateKeyUsage } from "./key-usage";
import { loadAlignmentSelection, resolveAlignedModel, alignmentEnabled, type AlignmentSelection } from "./alignment";

// Constitutional-Alignment runtime wiring (vO65): lazily load ALIGNMENT_SELECTION.json once, then map a local
// model tag to its regression-clean "-ca" variant — but ONLY when OLLAMAS_ALIGN is on (default OFF = no-op).
let _alignSel: AlignmentSelection | null = null;
function alignSelection(): AlignmentSelection {
  if (!_alignSel) _alignSel = loadAlignmentSelection(pathJoin(process.cwd(), "orchestration", "ALIGNMENT_SELECTION.json"));
  return _alignSel;
}
import { estimateCost } from "./tokens";
import { limitFor, pctOfLimit, approaching } from "./key-limits";
import { PROVIDER_CATALOG, catalogEntry, catalogBaseUrl } from "./provider-catalog";
import { ProviderHttpError, parseRetryAfter, quotaCooldownTtl, FAILURE_COOLDOWN_MS, classifyKeyError } from "./provider-errors";
import { filterChain } from "./chain-policy";
import { setToolSupport, toolSupportSnapshot, hydrateToolSupport } from "./capability-cache";
import { recordRequestEvent } from "./telemetry";
import { resolveModelTuning, resolveKeepAlive, withSystemOverride } from "./model-overrides";
import { randomUUID } from "node:crypto";

// Types
export interface ProviderMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];   // assistant turn that emitted tool calls (D-003)
  tool_call_id?: string;     // role:"tool" result — which call it answers
  name?: string;             // role:"tool" — the tool name (gemini functionResponse)
}

export interface GenerateConfig {
  provider: string;
  model: string;
  messages: ProviderMessage[];
  numCtx?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  // Validate exactly this provider with exactly the resolved key — NO provider fallback and NO
  // key-pool rotation. Used by /api/keys/test so a candidate's failure surfaces honestly instead
  // of a different provider/key answering and reporting a false "verified".
  singleAttempt?: boolean;
  // Sovereign privacy: exclude every provider whose FREE tier trains on prompts (gemini
  // free tier, …) from the fallback chain. Local tiers always remain available.
  privateMode?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

// ── Cross-provider message mapping (D-003) ─────────────────────────────────────
// The ReAct history carries assistant turns with `tool_calls` + `role:"tool"` results.
// Each provider must serialize that into ITS tool shape — a tool result not preceded by
// the matching assistant tool_calls/tool_use is rejected (400 on OpenAI/Anthropic).
// Pure (testable) — no I/O.

/** OpenAI / OpenRouter / custom-openai chat messages. `stringifyArgs`: OpenAI wants
 *  function.arguments as a JSON STRING; ollama wants it as an OBJECT (its native shape),
 *  so the ollama cases pass false. */
export function toOpenAiMessages(msgs: ProviderMessage[], stringifyArgs = true): any[] {
  return (msgs || []).map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content || "",
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: stringifyArgs
              ? (typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}))
              : (typeof tc.arguments === "string" ? safeJsonObj(tc.arguments) : (tc.arguments ?? {})),
          },
        })),
      };
    }
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: String(m.content ?? "") };
    return { role: m.role, content: m.content };
  });
}

/** Anthropic Messages API: tool calls/results become tool_use/tool_result content blocks. */
export function toAnthropicMessages(msgs: ProviderMessage[]): any[] {
  return (msgs || []).map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      return { role: "assistant", content: blocks };
    }
    if (m.role === "tool") {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") }] };
    }
    return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
  });
}

/** Gemini generateContent contents: functionCall / functionResponse parts (never empty parts). */
export function toGeminiContents(msgs: ProviderMessage[]): any[] {
  const out: any[] = [];
  for (const m of msgs || []) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls) parts.push({ functionCall: { name: tc.name, args: tc.arguments ?? {} } });
      out.push({ role: "model", parts });
      continue;
    }
    if (m.role === "tool") {
      out.push({ role: "user", parts: [{ functionResponse: { name: m.name || "tool", response: { result: String(m.content ?? "") } } }] });
      continue;
    }
    out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content || " " }] });
  }
  return out;
}

// CRITICAL-3: cross-provider tool-call robustness. Sentinel returned when arguments
// cannot be parsed even after repair — the ReAct loop checks it (getToolArgError) and
// feeds the error back to the model (Try-Rewrite-Retry) instead of silently running the
// tool with empty {} args. Refs: json-repair patterns; litellm#18667/goose#2892
// (control chars), fastmcp#932 (string-wrapped args), CRITIC validator-feedback.
export const TOOL_ARG_ERROR = "__toolArgError";
export function getToolArgError(args: any): string | null {
  return args && typeof args === "object" && typeof args[TOOL_ARG_ERROR] === "string" ? args[TOOL_ARG_ERROR] : null;
}

// Escape raw control chars (a frequent Claude/Bedrock tool-arg bug). JSON forbids
// literal control chars anywhere outside strings, so escaping all of them is safe.
function escapeBareControls(t: string): string {
  return t.replace(/[\u0000-\u001F]/g, (c) => (({ "\n": "\\n", "\r": "\\r", "\t": "\\t" }) as Record<string, string>)[c] ?? " ");
}
// Append closers for unbalanced strings/brackets (truncated streaming output).
function balanceBrackets(t: string): string {
  let curly = 0, square = 0, inStr = false, esc = false;
  for (const ch of t) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") curly++; else if (ch === "}") curly--;
    else if (ch === "[") square++; else if (ch === "]") square--;
  }
  let out = t;
  if (inStr) out += '"';
  while (square-- > 0) out += "]";
  while (curly-- > 0) out += "}";
  return out;
}
// Best-effort repair of model-emitted JSON, applied ONLY after a plain JSON.parse has
// already failed (valid JSON is never touched). Returns the parsed value or null.
export function repairJson(s: string): any | null {
  if (typeof s !== "string") return null;
  let t = s.trim().replace(/^```(?:json|tool_code)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Slice to the outermost object/array if wrapped in prose.
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  if (starts.length) {
    const first = Math.min(...starts);
    const close = t[first] === "{" ? "}" : "]";
    const last = t.lastIndexOf(close);
    if (last > first) t = t.slice(first, last + 1);
  }
  const noTrailingComma = (x: string) => x.replace(/,\s*([}\]])/g, "$1");
  for (const candidate of [
    t,
    noTrailingComma(t),
    escapeBareControls(noTrailingComma(t)),
    balanceBrackets(escapeBareControls(noTrailingComma(t))),
  ]) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  return null;
}

// Tolerant JSON parse for model-emitted tool-call arguments: a truncated/malformed
// arguments string must NOT throw (that would crash the tool_calls .map()). Tries
// JSON.parse → repairJson → a sentinel (NOT silent {}) so the loop can ask the model
// to re-emit valid args instead of running the tool with empty arguments.
function safeJsonObj(s: string): any {
  try { return JSON.parse(s); } catch { /* attempt repair */ }
  const repaired = repairJson(s);
  if (repaired !== null && typeof repaired === "object") return repaired;
  return { [TOOL_ARG_ERROR]: "tool arguments were not valid JSON (unparseable after repair)", __rawPreview: String(s).slice(0, 120) };
}

// Some local models (e.g. qwen3) emit tool calls as TEXT instead of the
// structured tool_calls field — `<function=NAME>{json}</function>`,
// `<tool_call>{"name":..,"arguments":..}</tool_call>`, or a fenced/bare JSON
// object. This recovers them so the ReAct loop doesn't stall/loop. Returns
// undefined if nothing parseable is found.
export function extractTextToolCalls(text: string): ToolCall[] | undefined {
  if (!text) return undefined;
  const calls: ToolCall[] = [];
  const mk = (name: string, args: any) => calls.push({ id: `tc-${crypto.randomUUID().slice(0, 8)}`, name, arguments: args || {} });
  const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };

  // 1) <function=NAME ...>{args}</function>  or  <function=NAME></function>
  for (const m of text.matchAll(/<function=([a-z_][\w-]*)\s*>([\s\S]*?)<\/function>/gi)) {
    const body = m[2].trim();
    mk(m[1], body ? (safeParse(body) ?? {}) : {});
  }
  // 2) <tool_call>{"name":..,"arguments":..}</tool_call>
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    const o = safeParse(m[1].trim());
    if (o && o.name) mk(o.name, o.arguments ?? o.parameters ?? {});
  }
  // 3) fenced ```json {"name":..,"arguments":..} ``` (only if it looks like a tool call)
  if (calls.length === 0) {
    for (const m of text.matchAll(/```(?:json|tool_code)?\s*([\s\S]*?)```/gi)) {
      const o = safeParse(m[1].trim());
      if (o && o.name && (o.arguments !== undefined || o.parameters !== undefined)) mk(o.name, o.arguments ?? o.parameters ?? {});
    }
  }
  return calls.length ? calls : undefined;
}

export interface GenerateResult {
  text: string;
  source: string; // e.g. "ollama_local", "cloud:gemini", "cloud:openrouter", "demo"
  modelUsed: string;
  latencyMs: number;
  tokensPerSec?: number;
  tokens?: number; // output tokens (eval_count) when the provider reports them
  tokensIn?: number;  // prompt tokens from the provider `usage` (vNEXT-D1)
  tokensOut?: number; // completion tokens from the provider `usage` (== tokens; explicit)
  toolCalls?: ToolCall[];
}

// In-Memory Latency Tracker
interface LatencyEntry {
  latencyMs: number;
  updatedAt: number;
}
const latencyCache: Record<string, LatencyEntry> = {};

// vNext T2.2 (live): the latency a FAILED/HUNG provider records so it sorts AFTER any healthy
// one. A hang records its real (large) timeout time; a fast auth/quota error is floored to the
// penalty so a broken provider can never sort ahead of a working one. Pure → unit-tested.
export function latencyForFailure(elapsedMs: number, penaltyMs = Number(process.env.PROVIDER_FAIL_PENALTY_MS) || 60_000): number {
  return Math.max(elapsedMs, penaltyMs);
}

// Streaming fail-safe: throw if the caller has cancelled, so a provider read loop never keeps
// draining a backend that streams PAST an abort (fetch-abort only rejects read() if the remote
// honors it; this guards the rest). Called at the top of every streaming loop iteration.
export function abortIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("provider stream aborted (caller cancelled or timed out)");
}

// API-key cooldown persistence (pure-core). Cooldown entries are `provider::keyId → expiryEpochMs`.
// toPersist: serialize the live map, DROPPING anything already expired (prunes stale junk so the
// config never grows unbounded). fromPersist: parse the saved object on boot, keeping ONLY numeric
// FUTURE expiries (ignores corrupt/past entries). Both pure → unit-tested, no IO.
export function cooldownToPersist(entries: Array<[string, number]>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, exp] of entries) { if (typeof exp === "number" && exp > now) out[k] = exp; }
  return out;
}
export function cooldownFromPersist(obj: unknown, now: number): Array<[string, number]> {
  if (!obj || typeof obj !== "object") return [];
  const out: Array<[string, number]> = [];
  for (const [k, exp] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof exp === "number" && Number.isFinite(exp) && exp > now) out.push([k, exp]);
  }
  return out;
}

// Compose caller-supplied cancellation with the provider timeout (default 300s,
// overridable via PROVIDER_TIMEOUT_MS — vNext T1.3, no hardcode). Caller signal preserved.
function buildSignal(callerSignal?: AbortSignal, timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS) || 300000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

export class ProviderRouter {
  /**
   * Whether the demo provider may be used as a CHAIN FALLBACK (when every real
   * provider failed). Default true preserves prior behavior + all existing tests.
   * server.ts sets it to `(CURRENT_MODE === "demo")` at boot: in LIVE/degraded-live
   * mode it becomes false so an all-providers-down situation surfaces as an honest
   * error instead of silently returning fabricated demo text to the live agent.
   * An EXPLICIT `provider:"demo"` request always works (the guard only skips demo
   * reached as a fallback).
   */
  public static demoFallbackAllowed = true;

  /**
   * True when the demo provider, reached as a CHAIN FALLBACK, must be skipped.
   * Pure (given demoFallbackAllowed) → unit-testable. Explicit `provider:"demo"`
   * is never skipped; only demo reached after real providers failed, in non-demo mode.
   */
  public static shouldSkipDemoFallback(prov: string, requestedProvider: string): boolean {
    return prov === "demo" && requestedProvider !== "demo" && !ProviderRouter.demoFallbackAllowed;
  }

  /**
   * Main route function with fallback and latency awareness
   */
  public static async generate(
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void,
    onFallback?: (from: string, to: string, error: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResult> {
    const start = Date.now();
    const providersToTry = this.effectiveChain(config);
    let lastError: Error | null = null;
    const requestId = randomUUID();
    let prevProv: string | undefined; // provider the current attempt fell back FROM (telemetry)

    for (const prov of providersToTry) {
      const resolvedConfig = { ...config, provider: prov };
      // A model name belongs to its provider: "gemini-2.0-flash" is meaningless to
      // ollama (404 "model not found") and would cascade the whole chain to demo.
      // When falling back to a DIFFERENT provider than the one requested, drop the
      // requested model so each provider resolves its own default (case-local `||`).
      if (prov !== config.provider) resolvedConfig.model = undefined;
      // Demo honesty (CRITICAL-2): never silently return fabricated demo text to a LIVE
      // caller. Demo is used ONLY when explicitly requested (config.provider === "demo")
      // or when demoFallbackAllowed (demo mode). Otherwise skip it → the loop ends and
      // throws an honest "all providers failed" error instead of mock output.
      if (ProviderRouter.shouldSkipDemoFallback(prov, config.provider)) {
        continue;
      }
      // If specific provider key isn't set, skip unless it's ollama-local or we are in DEMO fallback mode.
      // gemini-cli + vllm/llamacpp are KEYLESS local backends (own auth / no auth) → never key-gated.
      // catalog-keyless providers (e.g. pollinations, per-IP) are attempted with NO key.
      if (prov !== "ollama-local" && prov !== "fleet" && prov !== "demo" && prov !== "gemini-cli" && prov !== "vllm" && prov !== "llamacpp" && !catalogEntry(prov)?.keyless && !this.hasKey(prov)) {
        continue;
      }

      // Key-pool rotation: a provider may hold MULTIPLE user-supplied keys. On a
      // quota (429) or auth (401) failure, cool the spent key and retry the SAME
      // provider with the next live key before falling through the provider chain.
      // (Rotation across user keys only — the system never auto-acquires new keys.)
      const cloudKeyed = prov !== "ollama-local" && prov !== "fleet" && prov !== "demo" && prov !== "gemini-cli" && prov !== "vllm" && prov !== "llamacpp" && !catalogEntry(prov)?.keyless;
      // singleAttempt (key test): exactly one try — no rotation across the pool, so the candidate's
      // own auth failure is the verdict (rotation would mask it and trip the fallthrough-as-success).
      const attempts = config.singleAttempt ? 1 : (cloudKeyed ? Math.max(1, this.keyPool(prov).length) : 1);
      let provErr: any = null;
      let rotated = false;
      let lastAttemptMs = 0; // this provider's OWN time (per-attempt) for the latency cache — NOT cumulative
      for (let attempt = 0; attempt < attempts; attempt++) {
        const attemptStart = Date.now();
        // TTFT: wrap onStreamChunk so the first token's arrival is timed for telemetry.
        let firstChunkAt = 0;
        const wrappedChunk = onStreamChunk
          ? (t: string) => { if (!firstChunkAt) firstChunkAt = Date.now(); onStreamChunk(t); }
          : undefined;
        try {
          const result = await this.executeProvider(resolvedConfig, wrappedChunk, signal);
          lastAttemptMs = Date.now() - attemptStart;
          // Passive capability learning: a tools request that SUCCEEDED proves support.
          if (config.tools?.length) { setToolSupport(prov, resolvedConfig.model || "", true); this.persistUsageDebounced(); }
          const elapsed = Date.now() - start; // total wall-clock incl. fallbacks (honest caller-facing number)
          // T2.2 (live): record the provider's OWN latency (not `elapsed`, which includes prior failed
          // attempts) so getFallbackChain learns the fastest proven-working cloud provider.
          this.recordLatency(prov, lastAttemptMs);
          // Per-key usage for proactive quota awareness (keyless providers skip). The key used is
          // the one getDecryptedKey resolved — recorded by its safe keyId, never the raw value.
          // Hydrated once from the config + debounce-persisted back, so a restart keeps the
          // day's spent budget (quota-persist.ts; boundary-aware windows in key-usage.ts).
          if (cloudKeyed) {
            const used = this.getDecryptedKey(prov);
            if (used) { this.ensureUsageHydrated(); recordKeyUse(prov, keyId(used)); this.persistUsageDebounced(); }
          }
          // vNEXT-D1 — per-call token + USD telemetry. Use the provider's real `usage` when present
          // (tokensIn/tokensOut), else estimate (~4 chars/token). Cost via the env-tunable table.
          {
            const inChars = (config.messages || []).reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length), 0);
            const estIn = Math.ceil(inChars / 4);
            const tokensIn = result.tokensIn ?? estIn;
            const tokensOut = result.tokensOut ?? result.tokens ?? Math.ceil((result.text || "").length / 4);
            const costUsd = estimateCost(result.modelUsed || resolvedConfig.model || prov, tokensIn, tokensOut);
            recordCallCost(prov, tokensIn, tokensOut, costUsd);
            // Per-request telemetry (T5-F2): one event per model op, feeds the live cockpit.
            // side-effect-safe — recordRequestEvent never throws into the model path.
            const used = cloudKeyed ? this.getDecryptedKey(prov) : "";
            recordRequestEvent({
              ts: Date.now(), operation: "chat", providerName: prov,
              requestModel: resolvedConfig.model || undefined,
              responseModel: result.modelUsed || resolvedConfig.model || undefined,
              inputTokens: tokensIn, outputTokens: tokensOut,
              requestId, ttftMs: wrappedChunk && firstChunkAt ? firstChunkAt - attemptStart : undefined,
              totalMs: elapsed, status: "ok", costUsd,
              routeAttempt: providersToTry.indexOf(prov), fallbackFrom: prevProv,
              retryCount: attempt, keyId: used ? keyId(used) : undefined,
              stream: !!wrappedChunk, tokPerSec: lastAttemptMs > 0 ? tokensOut / (lastAttemptMs / 1000) : undefined,
            });
          }
          return { ...result, latencyMs: elapsed };
        } catch (err: any) {
          provErr = err;
          lastAttemptMs = Date.now() - attemptStart;
          // Prefer the typed HTTP status over message substrings so a typed 5xx isn't mis-cooled as a 6h
          // quota (classifyKeyError is pure/tested). Untyped errors still fall back to message heuristics.
          const errKind = classifyKeyError(err);
          const isQuota = errKind === "quota";
          const isAuth = errKind === "auth";
          if (cloudKeyed && (isQuota || isAuth)) {
            const spent = this.getDecryptedKey(prov);
            // Cool the spent key: quota honors the server's Retry-After when present (else 6h);
            // an invalid key stays out longer (24h). quotaCooldownTtl is pure → tested.
            const retryAfterMs = err instanceof ProviderHttpError ? err.retryAfterMs : undefined;
            if (spent) this.markKeyCooldown(prov, spent, quotaCooldownTtl(isQuota, retryAfterMs));
            const live = this.liveKeyCount(prov);
            // Token NAMES/positions ok to log; VALUES never.
            console.warn(`[KeyPool] ${prov} key#${attempt + 1} ${isQuota ? "quota" : "auth"}-exhausted → ${live} live key(s) remain`);
            // v15 buddy-system: the provider just went dark (last live key cooled) → ask the
            // health loop to immediately harvest any machine key so a buddy can be restored fast.
            if (live === 0) { try { ProviderRouter.onPoolExhausted?.(prov); } catch { /* best-effort self-heal */ } }
            if (live > 0 && attempt + 1 < attempts) { rotated = true; continue; } // retry same provider, next key
          } else if (cloudKeyed) {
            // Passive capability learning: a 400/422 on a TOOLS request marks this
            // provider::model tool-incapable — future tool work routes around it for free
            // (free tiers don't guarantee function-calling; an active probe would burn quota).
            if (config.tools?.length && err instanceof ProviderHttpError && (err.status === 400 || err.status === 422)) {
              setToolSupport(prov, resolvedConfig.model || "", false);
              this.persistUsageDebounced();
            }
            // Generic failure (network blip / 5xx / timeout): bench this provider's key 30s so
            // the NEXT request skips a flapping endpoint instead of re-hitting it immediately
            // (LiteLLM deployment-cooldown pattern). Real outages still surface via the chain.
            const spent = this.getDecryptedKey(prov);
            if (spent) this.markKeyCooldown(prov, spent, FAILURE_COOLDOWN_MS);
          }
          break; // not a key error, or pool exhausted → fall through to provider chain
        }
      }

      // Provider exhausted (all its keys, or a non-key error). Decide fallback.
      console.warn(`[Router] Provider ${prov} failed: ${provErr?.message || provErr}. Retrying fallback...`);
      // T2.2 (live): a failed/hung provider records a penalized latency so it sorts AFTER any
      // healthy one on the next chain build (cooldown handles keyed exhaustion; this guards order).
      this.recordLatency(prov, latencyForFailure(lastAttemptMs));
      lastError = provErr;
      const lowercaseMsg = (provErr?.message || "").toLowerCase();
      const isQuotaErr = lowercaseMsg.includes("429") || lowercaseMsg.includes("quota") || lowercaseMsg.includes("resource_exhausted") || lowercaseMsg.includes("exceeded");
      // Per-request telemetry (T5-F2): record this provider's FAILURE before falling through.
      // errorType = HTTP status when typed, else a short classifier from the message.
      recordRequestEvent({
        ts: Date.now(), operation: "chat", providerName: prov,
        requestModel: resolvedConfig.model || undefined,
        inputTokens: 0, outputTokens: 0, requestId, totalMs: Date.now() - start,
        status: "error",
        errorType: provErr instanceof ProviderHttpError ? String(provErr.status) : (isQuotaErr ? "429" : "error"),
        routeAttempt: providersToTry.indexOf(prov), fallbackFrom: prevProv,
        retryCount: attempts - 1, quotaCooldownFlag: isQuotaErr, stream: !!onStreamChunk, costUsd: 0,
      });
      prevProv = prov; // the NEXT provider in the chain falls back FROM this one
      const isAuthError =
        lowercaseMsg.includes("401") ||
        lowercaseMsg.includes("403") ||
        lowercaseMsg.includes("unauthorized") ||
        lowercaseMsg.includes("forbidden") ||
        lowercaseMsg.includes("api key") ||
        lowercaseMsg.includes("not set");

      // Hard-fail only when the EXPLICITLY selected provider has a genuinely invalid key
      // (not mere quota, and only if rotation didn't already exhaust a real pool) — so a
      // bad key surfaces clearly, while a fallback provider's bad key never poisons the chain.
      if (isAuthError && !isQuotaErr && !rotated && prov === config.provider) {
        throw new Error(`Authentication failure: invalid or missing key for ${prov}. Error: ${provErr?.message || provErr}`);
      }

      const nextIndex = providersToTry.indexOf(prov) + 1;
      if (nextIndex < providersToTry.length && onFallback) {
        onFallback(prov, providersToTry[nextIndex], provErr?.message || "Unknown error");
      }
    }

    // All fallback options failed
    if (lastError) {
      throw new Error(`All providers in fallback chain failed. Last error: ${lastError.message}`);
    } else {
      throw new Error("No usable provider found.");
    }
  }

  /**
   * Determine fallback chain based on selected initial provider
   */
  // --- Fleet-aware routing (server/providers.ts darboğaz fix: boş Windows CUDA'yı kullan) ---
  private static fleetProbeCache: { at: number; probes: BackendProbe[] } | null = null;

  private static loadFleetPool(): Backend[] {
    try {
      // FLEET_BACKENDS_PATH override keeps this consistent with the contract lane
      // sync (server/contract.ts) and makes the pool test-isolatable.
      const fleetPath = process.env.FLEET_BACKENDS_PATH || pathJoin(homedir(), ".ollamas", "backends.json");
      const raw = JSON.parse(readFileSync(fleetPath, "utf8"));
      return parseBackendPool(raw);
    } catch { return []; }
  }

  // Hafif /api/tags probe (reachability + model listesi), per-request hız için ~8s cache'li.
  private static async probeFleet(pool: Backend[]): Promise<BackendProbe[]> {
    const now = Date.now();
    if (this.fleetProbeCache && now - this.fleetProbeCache.at < 8000) return this.fleetProbeCache.probes;
    const probes = await Promise.all(pool.map(async (b): Promise<BackendProbe> => {
      try {
        const res = await fetch(`${b.url}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return { url: b.url, reachable: false, models: [] };
        const j: any = await res.json();
        const models = Array.isArray(j?.models) ? j.models.map((m: any) => m.name).filter(Boolean) : [];
        return { url: b.url, reachable: true, models };
      } catch { return { url: b.url, reachable: false, models: [] }; }
    }));
    this.fleetProbeCache = { at: now, probes };
    return probes;
  }

  // Gerekli modeli sunan en düşük-öncelikli erişilebilir backend (Windows 10 → Mac 99). Yoksa null.
  // Test için pool/probes override edilebilir (saf karar).
  public static async selectFleetBackend(model: string, poolOverride?: Backend[], probesOverride?: BackendProbe[]): Promise<Backend | null> {
    const pool = poolOverride ?? this.loadFleetPool();
    if (!pool.length) return null;
    const probes = probesOverride ?? await this.probeFleet(pool);
    return selectBackend(pool, probes, { required: [model] });
  }

  /**
   * The provider list generate() actually walks: singleAttempt pins exactly the requested
   * provider (key-test honesty); otherwise the fallback chain filtered by policy —
   * privateMode (no training free tiers), free-tier context caps, tool capability.
   * Public + pure(ish) so routing policy is directly testable.
   */
  public static effectiveChain(config: GenerateConfig): string[] {
    if (config.singleAttempt) return [config.provider];
    const inChars = (config.messages || []).reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length), 0);
    return filterChain(this.getFallbackChain(config.provider), {
      privateMode: config.privateMode,
      needTools: !!(config.tools && config.tools.length),
      estTokensIn: Math.ceil(inChars / 4),
      model: config.model,
    });
  }

  // public for unit testing the chain order (pure helper, no side effects)
  public static getFallbackChain(initial: string): string[] {
    // Free-tier catalog providers join the cloud tier (before demo). Keyless ones are
    // skipped by the hasKey gate at dispatch, so listing them costs nothing until a key
    // is added — then they participate in latency-ordered failover automatically.
    const defaults = ["fleet", "ollama-local", "openrouter", "gemini", "gemini-cli", "openai", "ollama-cloud", ...Object.keys(PROVIDER_CATALOG), "demo"];
    // Keep the Gemini family ADJACENT and FIRST when a gemini provider is requested: an exhausted
    // gemini API-key pool (429/cooled) self-sustains on the KEYLESS gemini-cli OAuth binary (same
    // Gemini family, 1000/day, no paste/rotation) BEFORE dropping to local — minimum-manual
    // sustainability. gemini-cli is keyless-safe in the loop; with OAuth absent it errors fast
    // (non-interactive json, no hang) → the chain continues.
    const front = initial === "gemini" ? ["gemini", "gemini-cli"]
      : initial === "gemini-cli" ? ["gemini-cli", "gemini"]
      : [initial];
    const rest = defaults.filter((p) => !front.includes(p));
    return [...front, ...this.orderRestByLatency(rest, (p) => this.getLatency(p), (p) => this.healthPenalty(p))];
  }

  // v15 buddy-system: how "unavailable" a KEYED cloud provider is right now, for proactive
  // reordering. 0 = healthy, 1 = every live key ≥80% (about to 429), 2 = all keys cooled.
  // Providers with no keyed pool (keyless like pollinations, local, unconfigured) return 0 —
  // they're never demoted; keyless/local are the always-available buddies + $0 safety net.
  public static healthPenalty(provider: string): number {
    const pool = this.keyPool(provider);
    if (pool.length === 0) return 0;
    if (this.keyPoolStatus(provider).live === 0) return 2;
    return this.poolSaturation(provider).allApproaching ? 1 : 0;
  }

  // v15 buddy-system status for the UI: who's live/saturated/cooled/absent, which buddy is
  // actually serving, and whether every cloud provider is down (→ riding $0-local). No values.
  public static buddyStatus(): {
    providers: Array<{ id: string; state: "live" | "saturated" | "cooled" | "absent"; worstPct: number; live: number; total: number }>;
    activeBuddy: string;
    allCloudCooled: boolean;
  } {
    const LEGACY = ["gemini", "openai", "openrouter", "anthropic", "ollama-cloud"];
    const catalogKeyed = Object.keys(PROVIDER_CATALOG).filter((id) => !catalogEntry(id)?.keyless);
    const ids = [...new Set([...LEGACY, ...catalogKeyed])];
    const providers = ids.map((id) => {
      const { total, live } = this.keyPoolStatus(id);
      if (total === 0) return { id, state: "absent" as const, worstPct: 0, live: 0, total: 0 };
      const sat = this.poolSaturation(id);
      const state = live === 0 ? "cooled" as const : sat.allApproaching ? "saturated" as const : "live" as const;
      return { id, state, worstPct: Math.round(sat.worstPct * 100) / 100, live, total };
    });
    const liveCloud = providers.filter((p) => p.state === "live" || p.state === "saturated").map((p) => p.id);
    const activeBuddy = this.getFallbackChain("ollama-local").find((p) => liveCloud.includes(p)) ?? "ollama-local ($0)";
    return { providers, activeBuddy, allCloudCooled: liveCloud.length === 0 };
  }

  // vNext T2.2: order the fallback TAIL by measured latency WITHOUT breaking invariants —
  // $0 local (fleet, ollama-local) stays first, demo last, and the gemini family stays
  // adjacent. Only the cloud tier reorders, fastest-first; providers with no fresh latency
  // (getLatency = -1) sort last via Infinity, so a cold cache preserves the original order
  // (zero behavior change until real measurements exist). Pure (getLatency injected) → tested.
  public static orderRestByLatency(
    rest: string[],
    getLatency: (p: string) => number,
    // v15 buddy-system: proactively demote a saturated/cooled provider BELOW its healthy
    // buddies BEFORE it 429s. 0 = healthy, 1 = ≥80% saturated, 2 = all keys cooled. Keyless/
    // local/demo return 0 (never demoted — they're the always-available buddies). Default
    // () => 0 keeps the pure latency behavior for existing callers/tests.
    getHealthPenalty: (p: string) => number = () => 0,
  ): string[] {
    const EARLY = ["fleet", "ollama-local"];
    const early = rest.filter((p) => EARLY.includes(p));
    const hasDemo = rest.includes("demo");
    const cloud = rest.filter((p) => !EARLY.includes(p) && p !== "demo");
    const lat = (p: string) => { const v = getLatency(p); return v < 0 ? Infinity : v; };
    // Health penalty dominates latency: a healthy slow buddy beats a fast saturated one.
    const sorted = [...cloud].sort((a, b) => (getHealthPenalty(a) - getHealthPenalty(b)) || (lat(a) - lat(b)));
    // Keep the gemini family adjacent: pin gemini-cli immediately after gemini if both present.
    const gi = sorted.indexOf("gemini"), ci = sorted.indexOf("gemini-cli");
    if (gi >= 0 && ci >= 0 && ci !== gi + 1) {
      sorted.splice(ci, 1);
      sorted.splice(sorted.indexOf("gemini") + 1, 0, "gemini-cli");
    }
    return [...early, ...sorted, ...(hasDemo ? ["demo"] : [])];
  }

  private static hasKey(provider: string): boolean {
    // A scoped /api/keys/test candidate counts as a key: without this, testing a key for a
    // provider that has NO stored/env key is skipped by the chain's key gate and reports the
    // misleading "No usable provider found." instead of the candidate's real verdict.
    if (this.testKeyOverride && this.testKeyOverride.provider === provider) return true;
    const rawKeys = db.data.keys || {};
    const key = rawKeys[provider] || process.env[this.getEnvKeyName(provider)];
    return typeof key === "string" && key.trim().length > 0;
  }

  // --- API key pool + rotation (user-supplied keys only; never auto-acquired) ---
  // Cooldown: provider+key → expiry epoch ms. PERSISTED to the same JSON config that holds the
  // keys (db.data.keyCooldowns) + hydrated lazily on first access, so a key benched 24h (invalid)
  // or 6h (quota) stays benched across deploys/crashes/reboots — the self-sustaining pool no longer
  // thrashes on boot (a wiped cooldown would instantly retry a known-bad key / re-hit a 429).
  // SECURITY: keyed by keyId() (SHA256-12, non-reversible) NOT the raw value, so nothing written
  // to plaintext config can leak a key. In-memory behavior is identical (keyId is deterministic).
  private static keyCooldown = new Map<string, number>();
  private static cooldownHydrated = false;
  private static ckey(provider: string, key: string): string { return `${provider}::${keyId(key)}`; }
  // Load persisted cooldowns into the in-memory map once (boot/first-touch). Dropped if expired.
  private static ensureHydrated(): void {
    if (this.cooldownHydrated) return;
    this.cooldownHydrated = true;
    try {
      const saved = (db.data as any).keyCooldowns;
      for (const [k, exp] of cooldownFromPersist(saved ?? {}, Date.now())) this.keyCooldown.set(k, exp);
    } catch { /* corrupt/absent config → start cold (cooldown is best-effort) */ }
  }
  // Write the live (non-expired) cooldowns back to the config. Best-effort: a disk error must
  // never break generation. Pruned via cooldownToPersist so stale entries don't accumulate.
  private static persistCooldowns(): void {
    try {
      (db.data as any).keyCooldowns = cooldownToPersist([...this.keyCooldown], Date.now());
      db.save();
    } catch { /* persistence is best-effort */ }
  }
  // Drop every expired cooldown. isCooled only evicts on access, so a key that is never re-checked
  // after recovery would linger forever; sweeping at the write site bounds the map to live cooldowns.
  public static sweepCooldowns(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [k, exp] of this.keyCooldown) { if (nowMs >= exp) { this.keyCooldown.delete(k); removed++; } }
    return removed;
  }
  public static markKeyCooldown(provider: string, key: string, ttlMs: number): void {
    this.ensureHydrated();
    const now = Date.now();
    this.keyCooldown.set(this.ckey(provider, key), now + ttlMs);
    this.sweepCooldowns(now); // bound the map to currently-cooled keys
    this.persistCooldowns(); // survive restart (sustainable pool)
  }
  private static isCooled(provider: string, key: string): boolean {
    this.ensureHydrated();
    const exp = this.keyCooldown.get(this.ckey(provider, key));
    if (!exp) return false;
    if (Date.now() >= exp) { this.keyCooldown.delete(this.ckey(provider, key)); return false; } // recovered
    return true;
  }
  /** Test/observability helper — number of retained cooldown entries. */
  public static cooldownSize(): number { return this.keyCooldown.size; }
  /** Earliest cooldown-expiry timestamp (ms) across all cooled keys, or null if none. Lets the
   *  key-health loop schedule its next sweep right after a key recovers instead of waiting the
   *  full steady-state interval — a recovered key rejoins the health snapshot within seconds. */
  public static nextCooldownExpiry(nowMs: number = Date.now()): number | null {
    this.ensureHydrated();
    let min: number | null = null;
    for (const exp of this.keyCooldown.values()) {
      if (exp <= nowMs) continue; // already expired — swept on next access
      if (min === null || exp < min) min = exp;
    }
    return min;
  }
  /** Earliest cooldown-expiry for ONE provider's keys (cooldown map keys are `provider::keyId`),
   *  or null if none are cooled. Powers the cockpit's per-provider "recovers in N" countdown. */
  public static providerCooldownExpiry(provider: string, nowMs: number = Date.now()): number | null {
    this.ensureHydrated();
    const prefix = `${provider}::`;
    let min: number | null = null;
    for (const [k, exp] of this.keyCooldown) {
      if (!k.startsWith(prefix) || exp <= nowMs) continue;
      if (min === null || exp < min) min = exp;
    }
    return min;
  }

  // ── Key-usage restart persistence (Faz 4) — same config vault as the cooldowns. ─────────
  // Buckets are keyId-only (never raw keys). Saves are debounced (5s) and best-effort: a
  // disk error must never break generation. No background timer — the hot path triggers it.
  private static usageHydrated = false;
  private static usageLastSaveMs = 0;
  private static ensureUsageHydrated(): void {
    if (this.usageHydrated) return;
    this.usageHydrated = true;
    try {
      hydrateKeyUsage((db.data as any).keyUsage);
      hydrateToolSupport((db.data as any).toolSupport);
    } catch { /* corrupt/absent → start cold */ }
  }
  private static persistUsageDebounced(nowMs: number = Date.now()): void {
    if (nowMs - this.usageLastSaveMs < 5000) return;
    this.usageLastSaveMs = nowMs;
    try {
      (db.data as any).keyUsage = keyUsageSnapshot(nowMs);
      (db.data as any).toolSupport = toolSupportSnapshot();
      db.save();
    } catch { /* persistence is best-effort */ }
  }

  // All candidate keys for a provider: vault key first, then env `NAME`, `NAME_1..9`,
  // and comma-separated `NAMES`. Deduped, non-empty. Drop a new key into .env (e.g.
  // GEMINI_API_KEY_2=... or GEMINI_API_KEYS=k1,k2) and it joins the pool on next boot.
  public static keyPool(provider: string): string[] {
    const keys: string[] = [];
    const enc = db.data.keys?.[provider];
    if (enc) { const d = db.decrypt(enc); if (d) keys.push(d); }
    // Vault POOL: extra keys added via the guided "add next key" flow (POST /api/keys/add).
    const extra = (db.data as any).keyPool?.[provider];
    if (Array.isArray(extra)) for (const e of extra) { const d = db.decrypt(e); if (d) keys.push(d); }
    const base = this.getEnvKeyName(provider);
    if (base) {
      const push = (v?: string) => { if (v && v.trim()) keys.push(v.trim()); };
      push(process.env[base]);
      for (let i = 1; i <= 9; i++) push(process.env[`${base}_${i}`]);
      const multi = process.env[`${base}S`];
      if (multi) multi.split(",").forEach(push);
    }
    return [...new Set(keys)];
  }

  public static liveKeyCount(provider: string): number {
    return this.keyPool(provider).filter((k) => !this.isCooled(provider, k)).length;
  }
  // For the monitor: pool health without ever exposing values.
  public static keyPoolStatus(provider: string): { total: number; live: number } {
    const pool = this.keyPool(provider);
    return { total: pool.length, live: pool.filter((k) => !this.isCooled(provider, k)).length };
  }

  // P2 — least-loaded selection: among LIVE (non-cooled) keys, pick the one with the most
  // headroom (lowest % of its rate limit) so load spreads + the next-best serves BEFORE a 429
  // (silent auto-rotation). Falls back to the first key when all are cooled. Stable tie-break by id.
  // Scoped, non-persistent override used ONLY by /api/keys/test so a candidate key can be
  // validated as the EXACT key that serves the ping — without mutating the vault or being
  // overshadowed by the least-loaded pool selection. Set+cleared around a single test call.
  public static testKeyOverride: { provider: string; key: string } | null = null;

  // v15 buddy-system hook: set by key-health.startKeyHealth. Fired (best-effort) when a keyed
  // provider's last live key cools (live→0) so the health loop can rescan machine keys NOW.
  // A callback (not a direct import) avoids a providers↔key-health cycle.
  public static onPoolExhausted: ((provider: string) => void) | null = null;

  public static getDecryptedKey(provider: string): string {
    const o = this.testKeyOverride;
    if (o && o.provider === provider) return o.key;
    const pool = this.keyPool(provider);
    if (pool.length === 0) return "";
    const live = pool.filter((k) => !this.isCooled(provider, k));
    if (!live.length) return pool[0];
    const lim = limitFor(provider);
    return live
      .map((k) => ({ k, pct: pctOfLimit(keyWindows(provider, keyId(k)), lim), id: keyId(k) }))
      .sort((a, b) => a.pct - b.pct || a.id.localeCompare(b.id))[0].k;
  }

  // P2 — pool saturation for the proactive alert: true `allApproaching` when EVERY live key is
  // ≥ the threshold (the pool can't absorb more without a new key). No live keys = saturated.
  public static poolSaturation(provider: string): { worstPct: number; minPct: number; liveCount: number; allApproaching: boolean } {
    const pool = this.keyPool(provider);
    const live = pool.filter((k) => !this.isCooled(provider, k));
    const lim = limitFor(provider);
    const pcts = live.map((k) => pctOfLimit(keyWindows(provider, keyId(k)), lim));
    return {
      worstPct: pcts.length ? Math.max(...pcts) : 1,
      minPct: pcts.length ? Math.min(...pcts) : 1,
      liveCount: live.length,
      allApproaching: pcts.length === 0 || pcts.every((p) => approaching(p)),
    };
  }

  // Pure: resolve the OpenAI-compatible base URL for a local backend (env-overridable defaults).
  // vLLM serves on :8000, llama.cpp-server on :8080 — both expose /v1/chat|/v1/models.
  public static localCompatBaseUrl(provider: string, env: NodeJS.ProcessEnv = process.env): string {
    if (provider === "vllm") return env.VLLM_BASE_URL || "http://localhost:8000/v1";
    if (provider === "llamacpp") return env.LLAMACPP_BASE_URL || "http://localhost:8080/v1";
    return "";
  }

  private static getEnvKeyName(provider: string): string {
    switch (provider) {
      case "gemini": return "GEMINI_API_KEY";
      case "anthropic": return "ANTHROPIC_API_KEY";
      case "openai": return "OPENAI_API_KEY";
      case "openrouter": return "OPENROUTER_API_KEY";
      case "ollama-cloud": return "OLLAMA_CLOUD_KEY";
      // Catalog providers name their own env slot — keyPool's NAME/_1..9/NAMES rotation
      // then works for them with zero extra wiring.
      default: return catalogEntry(provider)?.envKey ?? "";
    }
  }

  // Gemini's functionDeclarations accept only a subset of JSON Schema. Tool schemas
  // authored for OpenAI/Ollama carry keywords Gemini rejects (e.g. `exclusiveMinimum`
  // → HTTP 400 INVALID_ARGUMENT). Deep-strip the unsupported keywords so the shared
  // ToolRegistry schemas pass through to Gemini unchanged elsewhere.
  private static geminiParams(schema: any): any {
    const DROP = new Set([
      "exclusiveMinimum", "exclusiveMaximum", "$schema", "additionalProperties",
      "const", "examples", "default", "$ref", "definitions", "$defs",
    ]);
    if (Array.isArray(schema)) return schema.map((s) => this.geminiParams(s));
    if (schema && typeof schema === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(schema)) {
        if (DROP.has(k)) continue;
        out[k] = this.geminiParams(v);
      }
      return out;
    }
    return schema;
  }

  /**
   * Shared OpenAI-compatible chat call — one implementation for openai/custom-openai,
   * the keyless local backends (vllm/llamacpp) AND every free-tier catalog provider.
   * Streaming SSE (`data:` lines, `[DONE]` terminator) and non-streaming JSON both handled.
   */
  private static async openAiCompatCall(
    baseUrl: string,
    apiKey: string,
    source: string,
    defaultModel: string,
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string; source: string; modelUsed: string; tokensIn?: number; tokensOut?: number; toolCalls?: ToolCall[] }> {
    const model = config.model || defaultModel;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Only send Authorization when a key exists (local backends 400 on a bogus bearer).
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(config.messages),
        temperature: config.temperature ?? 0.7,
        stream: !!onStreamChunk,
        tools: config.tools,
      }),
      signal: buildSignal(signal),
    });

    if (!response.ok) {
      // Typed failure: status + Retry-After survive to the router loop, where a 429's
      // server-stated wait becomes the exact key-cooldown TTL instead of the blanket 6h.
      throw new ProviderHttpError(
        `OpenAI-compatible host returned error ${response.status}`,
        response.status,
        parseRetryAfter(response.headers.get("retry-after"), Date.now())
      );
    }

    if (onStreamChunk && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let fullText = "";

      while (true) {
        abortIfCancelled(signal); // never drain a backend past a caller abort
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const lines = accumulated.split("\n");
        accumulated = lines.pop() || "";

        for (const line of lines) {
          const cleaned = line.trim();
          if (!cleaned || !cleaned.startsWith("data:")) continue;
          if (cleaned === "data: [DONE]") break;
          try {
            const parsed = JSON.parse(cleaned.substring(5).trim());
            const chunkText = parsed.choices?.[0]?.delta?.content || "";
            if (chunkText) {
              onStreamChunk(chunkText);
              fullText += chunkText;
            }
          } catch (e) {}
        }
      }
      return { text: fullText, source, modelUsed: model };
    } else {
      const json = await response.json();
      const tcs = json.choices?.[0]?.message?.tool_calls;
      const toolCalls = tcs?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: typeof tc.function?.arguments === "string" ? safeJsonObj(tc.function.arguments) : tc.function?.arguments
      }));

      return {
        text: json.choices?.[0]?.message?.content || "",
        source,
        modelUsed: model,
        // Real OpenAI-compat token usage — D1 cost telemetry.
        tokensIn: json.usage?.prompt_tokens,
        tokensOut: json.usage?.completion_tokens,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      };
    }
  }

  /**
   * Individual execution adapter
   */
  private static async executeProvider(
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string; source: string; modelUsed: string; tokensPerSec?: number; tokens?: number; tokensIn?: number; tokensOut?: number; toolCalls?: ToolCall[] }> {
    // Defensive: a malformed call (no messages) must not crash the router with a
    // TypeError — fall through to an empty conversation (provider/demo handles it).
    const msgs = config.messages || [];
    const systemMessage = msgs.find((m) => m.role === "system")?.content || "";
    const nonSystemMessages = msgs.filter((m) => m.role !== "system");

    // Free-tier catalog providers (groq, cerebras, zai, …) all speak OpenAI-compat —
    // one data-driven branch instead of N copy-paste switch cases.
    const cat = catalogEntry(config.provider);
    if (cat) {
      const baseUrl = catalogBaseUrl(cat.id);
      if (!baseUrl) throw new Error(`${cat.id}: CLOUDFLARE_ACCOUNT_ID not set (required to compose the API base URL)`);
      const apiKey = this.getDecryptedKey(cat.id);
      if (!apiKey && !cat.keyless) throw new Error(`${cat.id} API key not set (${cat.envKey})`);
      return this.openAiCompatCall(baseUrl, apiKey || "", `cloud:${cat.id}`, cat.defaultModel, config, onStreamChunk, signal);
    }

    switch (config.provider) {
      case "fleet": {
        // Fleet-aware routing: rutin modeli (qwen3:8b) BOŞ Windows CUDA worker'a kaydır, Mac'i
        // ağır/orkestrasyona ayır. Uygun uzak backend yoksa Mac-local'e düşer → asla daha kötü değil.
        const fModel = config.model || "qwen3:8b";
        const backend = await ProviderRouter.selectFleetBackend(fModel);
        if (!backend) {
          return this.executeProvider({ ...config, provider: "ollama-local" }, onStreamChunk, signal);
        }
        const sub: GenerateConfig = { ...config, provider: "ollama-local" };
        (sub as any)._ollamaHost = backend.url;
        const fr = await this.executeProvider(sub, onStreamChunk, signal);
        return { ...fr, source: `fleet:${backend.name}` };
      }

      case "ollama-local": {
        // The model actually used. After a provider fallback config.model is nulled
        // so each provider self-defaults; reporting config.model in the returns would
        // surface modelUsed:undefined — resolve it once here and reuse everywhere.
        const requestedModel = config.model || "qwen3:8b";
        // M-038: persisted per-model override — explicit request values still win.
        const override = db.data.modelOverrides?.[requestedModel];
        const { numCtx, temperature } = resolveModelTuning(config, override, db.data.ollamaNumCtx);
        // vO65 alignment wiring: swap to the regression-clean "-ca" variant when OLLAMAS_ALIGN is on (else no-op).
        const usedModel = resolveAlignedModel(requestedModel, alignSelection(), { enabled: alignmentEnabled(process.env) });
        if (usedModel !== requestedModel) console.log(`[align] ${requestedModel} → ${usedModel}`);
        const reqBody = JSON.stringify({
          model: usedModel,
          messages: toOpenAiMessages(withSystemOverride(config.messages, override?.system), false), // ollama wants OBJECT args, not stringified
          options: {
            num_ctx: numCtx,
            temperature,
            // Calibrated for Apple Silicon: pin threads to performance cores,
            // keep all layers on the GPU. Env-driven (omitted if unset).
            ...(process.env.OLLAMA_NUM_THREAD ? { num_thread: Number(process.env.OLLAMA_NUM_THREAD) } : {}),
            ...(process.env.OLLAMA_NUM_GPU ? { num_gpu: Number(process.env.OLLAMA_NUM_GPU) } : {}),
          },
          // Keep the model warm in Metal VRAM so repeat calls skip the reload
          // cost (stable low latency). Default 30m; "0" disables.
          keep_alive: resolveKeepAlive(override, process.env.OLLAMA_KEEP_ALIVE),
          think: false, // Prevent reasoning bloat output according to L6 Spec
          stream: !!onStreamChunk,
          tools: config.tools,
        });

        // Host resolution is environment-dependent: docker uses host.docker.internal,
        // local dev uses localhost. Try the configured host first, then loopback —
        // a connection-level failure (DNS/refused) advances to the next candidate so
        // the SAME .env works in both docker and `npm run dev` (no manual edit).
        const ollamaHosts = [...new Set([
          (config as any)._ollamaHost,
          process.env.OLLAMA_HOST || "http://localhost:11434",
          "http://localhost:11434",
          "http://127.0.0.1:11434",
        ].filter(Boolean) as string[])];
        const genStart = Date.now(); // wall-clock fallback for tok/s when ollama omits eval_duration
        let response: Response | undefined;
        let connErr: any = null;
        for (const host of ollamaHosts) {
          try {
            response = await fetch(`${host}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: reqBody,
              signal: buildSignal(signal), // Compose caller cancellation with 300s timeout (L12)
            });
            break; // got an HTTP response (even an error status) — stop host probing
          } catch (e) {
            connErr = e; // connection-level failure → try next host candidate
          }
        }
        if (!response) {
          throw new Error(`Ollama Local unreachable on [${ollamaHosts.join(", ")}]: ${connErr?.message || connErr}`);
        }

        if (!response.ok) {
          const errMsg = await response.text().catch(() => "");
          throw new Error(`Ollama Local returned status ${response.status}: ${errMsg || response.statusText}`);
        }

        if (onStreamChunk && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let fullText = "";
          let streamToolCalls: any[] | undefined;
          // Map accumulated ollama tool_calls into the ToolCall shape (mirrors the
          // non-stream branch); fall back to text-embedded tool calls. The streaming
          // branch used to forward only content and silently drop tool_calls.
          const mapStreamCalls = (): ToolCall[] | undefined => {
            let tc = streamToolCalls?.map((t: any) => ({
              id: t.id || `tc-${crypto.randomUUID().slice(0, 8)}`,
              name: t.function?.name,
              arguments: typeof t.function?.arguments === "string" ? safeJsonObj(t.function.arguments) : t.function?.arguments,
            }));
            if (!tc || tc.length === 0) tc = extractTextToolCalls(fullText) ?? tc;
            return tc;
          };

          while (true) {
            abortIfCancelled(signal); // never drain a backend past a caller abort
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });

            // Ollama streams JSON line-by-line
            const lines = accumulated.split("\n");
            accumulated = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed?.message?.tool_calls?.length) streamToolCalls = parsed.message.tool_calls;
                const chunkText = parsed?.message?.content || "";
                if (chunkText) {
                  onStreamChunk(chunkText);
                  fullText += chunkText;
                }
                if (parsed.done && parsed.eval_count) {
                  // Capture the token count even when the done chunk omits eval_duration
                  // (compute tps only when we can) so the billing meter never under-counts.
                  return {
                    text: fullText, source: "ollama_local", modelUsed: usedModel,
                    tokens: parsed.eval_count,
                    tokensPerSec: parsed.eval_duration ? parsed.eval_count / (parsed.eval_duration / 1e9) : parsed.eval_count / Math.max(0.001, (Date.now() - genStart) / 1000),
                    toolCalls: mapStreamCalls(),
                  };
                }
              } catch (e) {
                // Keep moving on parse anomalies
              }
            }
          }
          return { text: fullText, source: "ollama_local", modelUsed: usedModel, toolCalls: mapStreamCalls() };
        } else {
          const resultJson = await response.json();
          let reply = resultJson?.message?.content || "";
          
          // L6: If reasoning model returns empty, fallback if it gave a thinking key
          if (!reply && resultJson?.message?.thinking) {
            reply = resultJson.message.thinking;
          }
          // tok/s: prefer ollama's eval timing; fall back to wall-clock effective rate when
          // eval_duration is absent (so the dispatch bench never under-reports tok/s as 0).
          let tokensPerSec: number | undefined;
          if (resultJson.eval_count) {
            tokensPerSec = resultJson.eval_duration
              ? resultJson.eval_count / (resultJson.eval_duration / 1e9)
              : resultJson.eval_count / Math.max(0.001, (Date.now() - genStart) / 1000);
          }

          let toolCalls: ToolCall[] | undefined;
          if (resultJson?.message?.tool_calls) {
            toolCalls = resultJson.message.tool_calls.map((tc: any) => ({
              id: tc.id || `tc-${crypto.randomUUID().slice(0, 8)}`,
              name: tc.function?.name,
              arguments: typeof tc.function?.arguments === "string" ? safeJsonObj(tc.function.arguments) : tc.function?.arguments
            }));
          }
          // Fallback: some models emit tool calls as text — recover them.
          if (!toolCalls || toolCalls.length === 0) toolCalls = extractTextToolCalls(reply) ?? toolCalls;

          return { text: reply, source: "ollama_local", modelUsed: usedModel, tokensPerSec, tokens: resultJson.eval_count, toolCalls };
        }
      }

      case "ollama-cloud": {
        const apiKey = this.getDecryptedKey("ollama-cloud");
        if (!apiKey) throw new Error("Ollama Cloud Key is not set");
        const ollamaHost = "https://ollama.com/api";
        // Direct ollama.com API serves cloud models by their BASE name (no "-cloud"
        // suffix → that suffix is only for the local daemon's pulled cloud tags). A
        // non-cloud default like qwen3:8b 404s here, so default to a real cloud model.
        const cloudModel = (config.model || "gpt-oss:120b").replace(/-cloud$/, "");
        // M-038: per-model override keyed by the tag the user selected (as shown in the UI).
        const cloudOverride = db.data.modelOverrides?.[config.model || cloudModel];
        const { numCtx, temperature } = resolveModelTuning(config, cloudOverride, db.data.ollamaNumCtx);

        const response = await fetch(`${ollamaHost}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: cloudModel,
            messages: toOpenAiMessages(withSystemOverride(config.messages, cloudOverride?.system), false), // ollama wants OBJECT args
            options: {
              num_ctx: numCtx,
              temperature,
            },
            think: false,
            stream: !!onStreamChunk,
            tools: config.tools,
          }),
          signal: buildSignal(signal),
        });

        if (!response.ok) {
          const errMsg = await response.text().catch(() => "");
          throw new Error(`Ollama Cloud returned status ${response.status}: ${errMsg || response.statusText}`);
        }

        if (onStreamChunk && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let fullText = "";

          while (true) {
            abortIfCancelled(signal); // never drain a backend past a caller abort
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            const lines = accumulated.split("\n");
            accumulated = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const chunkText = parsed?.message?.content || "";
                if (chunkText) {
                  onStreamChunk(chunkText);
                  fullText += chunkText;
                }
                if (parsed.done && parsed.eval_count && parsed.eval_duration) {
                  return { text: fullText, source: "cloud:ollama-cloud", modelUsed: config.model, tokensPerSec: parsed.eval_count / (parsed.eval_duration / 1e9) };
                }
              } catch (e) {}
            }
          }
          return { text: fullText, source: "cloud:ollama-cloud", modelUsed: config.model };
        } else {
          const resultJson = await response.json();
          let reply = resultJson?.message?.content || "";
          let tokensPerSec: number | undefined;
          if (resultJson.eval_count && resultJson.eval_duration) {
             tokensPerSec = resultJson.eval_count / (resultJson.eval_duration / 1e9);
          }

          let toolCalls: ToolCall[] | undefined;
          if (resultJson?.message?.tool_calls) {
            toolCalls = resultJson.message.tool_calls.map((tc: any) => ({
              id: tc.id || `tc-${crypto.randomUUID().slice(0, 8)}`,
              name: tc.function?.name,
              arguments: typeof tc.function?.arguments === "string" ? safeJsonObj(tc.function.arguments) : tc.function?.arguments
            }));
          }

          if (!toolCalls || toolCalls.length === 0) toolCalls = extractTextToolCalls(reply) ?? toolCalls;

          return { text: reply, source: "cloud:ollama-cloud", modelUsed: config.model, tokensPerSec, tokens: resultJson.eval_count, toolCalls };
        }
      }

      case "gemini": {
        const apiKey = this.getDecryptedKey("gemini");
        if (!apiKey) throw new Error("Gemini API key is not set");
        
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });

        const geminiModel = config.model || "gemini-3.5-flash";

        // Map messages into Gemini SDK format
        // System instruction is placed in the config
        // D-003: map tool_calls/tool results to Gemini functionCall/functionResponse parts.
        const formattedContents = toGeminiContents(nonSystemMessages);

        if (onStreamChunk) {
          const responseStream = await ai.models.generateContentStream({
            model: geminiModel,
            contents: formattedContents,
            config: {
              systemInstruction: systemMessage,
              temperature: config.temperature ?? 0.7,
              abortSignal: buildSignal(signal), // bound by the same 300s/caller signal as every fetch provider
              ...(config.tools ? {
                tools: config.tools.map((t: any) => ({
                  functionDeclarations: [{
                    name: t.function.name,
                    description: t.function.description,
                    parameters: this.geminiParams(t.function.parameters)
                  }]
                }))
              } : {})
            },
          });

          let fullText = "";
          for await (const chunk of responseStream) {
            abortIfCancelled(signal); // SDK stream may not honor the abort signal — guard explicitly
            const chunkText = chunk.text || "";
            if (chunkText) {
              onStreamChunk(chunkText);
              fullText += chunkText;
            }
          }
          return { text: fullText, source: "cloud:gemini", modelUsed: geminiModel };
        } else {
          const response = await ai.models.generateContent({
            model: geminiModel,
            contents: formattedContents,
            config: {
              systemInstruction: systemMessage,
              temperature: config.temperature ?? 0.7,
              abortSignal: buildSignal(signal), // bound by the same 300s/caller signal as every fetch provider
              ...(config.tools ? {
                tools: config.tools.map((t: any) => ({
                  functionDeclarations: [{
                    name: t.function.name,
                    description: t.function.description,
                    parameters: this.geminiParams(t.function.parameters)
                  }]
                }))
              } : {})
            },
          });

          const fcs = response.functionCalls || [];
          const toolCalls = fcs.map((fc: any) => ({
            id: `tc-${crypto.randomUUID().slice(0, 8)}`,
            name: fc.name,
            arguments: fc.args
          }));

          return {
            text: response.text || "",
            source: "cloud:gemini",
            modelUsed: geminiModel,
            tokensIn: (response as any).usageMetadata?.promptTokenCount,
            tokensOut: (response as any).usageMetadata?.candidatesTokenCount,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
          };
        }
      }

      case "openrouter": {
        const apiKey = this.getDecryptedKey("openrouter");
        if (!apiKey) throw new Error("OpenRouter API key is not set");

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://ai.studio/build",
            "X-Title": "LLM Mission Control",
          },
          body: JSON.stringify({
            // env-overridable: OpenRouter's :free roster rotates — the old hardcoded
            // gemini-2.5-flash-lite:free now 404s, silently burning this fallback slot.
            model: config.model || process.env.OPENROUTER_DEFAULT_MODEL || "google/gemma-4-26b-a4b-it:free",
            messages: toOpenAiMessages(config.messages),
            temperature: config.temperature ?? 0.7,
            stream: !!onStreamChunk,
            tools: config.tools,
          }),
          signal: buildSignal(signal),
        });

        if (!response.ok) {
          throw new Error(`OpenRouter returned status ${response.status}: ${response.statusText}`);
        }

        if (onStreamChunk && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let fullText = "";

          while (true) {
            abortIfCancelled(signal); // never drain a backend past a caller abort
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            const lines = accumulated.split("\n");
            accumulated = lines.pop() || "";

            for (const line of lines) {
              const cleaned = line.trim();
              if (!cleaned || !cleaned.startsWith("data:")) continue;
              if (cleaned === "data: [DONE]") break;
              try {
                const parsed = JSON.parse(cleaned.substring(5).trim());
                const chunkText = parsed.choices?.[0]?.delta?.content || "";
                if (chunkText) {
                  onStreamChunk(chunkText);
                  fullText += chunkText;
                }
              } catch (e) {}
            }
          }
          return { text: fullText, source: "cloud:openrouter", modelUsed: config.model };
        } else {
          const json = await response.json();
          const tcs = json.choices?.[0]?.message?.tool_calls;
          const toolCalls = tcs?.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: typeof tc.function?.arguments === "string" ? safeJsonObj(tc.function.arguments) : tc.function?.arguments
          }));

          return {
            text: json.choices?.[0]?.message?.content || "",
            source: "cloud:openrouter",
            modelUsed: config.model,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
          };
        }
      }

      case "openai":
      case "custom-openai":
      case "vllm":
      case "llamacpp": {
        const prov = config.provider;
        const isCustom = prov === "custom-openai";
        // vLLM / llama.cpp are KEYLESS local OpenAI-compat servers (no auth required).
        const localCompat = prov === "vllm" || prov === "llamacpp";
        const keyProvider = isCustom ? "custom-openai" : prov === "openai" ? "openai" : prov;
        const apiKey = this.getDecryptedKey(keyProvider);
        if (!apiKey && !localCompat) throw new Error(`${isCustom ? "Custom" : "OpenAI"} API Key not set`);

        const baseUrl = localCompat
          ? ProviderRouter.localCompatBaseUrl(prov)
          : isCustom
            ? (db.data.keys["custom-openai-endpoint"] || "https://api.openai.com/v1")
            : "https://api.openai.com/v1";

        const source = localCompat ? `local:${prov}` : `cloud:${keyProvider}`;
        const defaultModel = isCustom || localCompat ? "" : "gpt-4o-mini";
        return this.openAiCompatCall(baseUrl, apiKey, source, defaultModel, config, onStreamChunk, signal);
      }

      case "anthropic": {
        const apiKey = this.getDecryptedKey("anthropic");
        if (!apiKey) throw new Error("Anthropic API key is not set");

        // Native Anthropic Messages fetch call to skip external client library overhead
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.model || "claude-3-5-sonnet-latest",
            system: systemMessage,
            messages: toAnthropicMessages(nonSystemMessages),
            max_tokens: 4096,
            temperature: config.temperature ?? 0.7,
            stream: !!onStreamChunk,
            tools: config.tools ? config.tools.map((t: any) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters
            })) : undefined,
          }),
          signal: buildSignal(signal),
        });

        if (!response.ok) {
          const errorMsg = await response.text();
          throw new Error(`Anthropic returned status ${response.status}: ${errorMsg}`);
        }

        if (onStreamChunk && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let fullText = "";

          while (true) {
            abortIfCancelled(signal); // never drain a backend past a caller abort
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            const lines = accumulated.split("\n");
            accumulated = lines.pop() || "";

            for (const line of lines) {
              const cleaned = line.trim();
              if (!cleaned || !cleaned.startsWith("data:")) continue;
              try {
                const parsed = JSON.parse(cleaned.substring(5).trim());
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  const chunkText = parsed.delta.text;
                  onStreamChunk(chunkText);
                  fullText += chunkText;
                }
              } catch (e) {}
            }
          }
          return { text: fullText, source: "cloud:anthropic", modelUsed: config.model };
        } else {
          const json = await response.json();
          const reply = json.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || "";
          const toolUses = json.content?.filter((c: any) => c.type === "tool_use");
          const toolCalls = toolUses?.map((tu: any) => ({
            id: tu.id,
            name: tu.name,
            arguments: tu.input
          }));

          return {
            text: reply,
            source: "cloud:anthropic",
            modelUsed: config.model,
            tokensIn: json.usage?.input_tokens,
            tokensOut: json.usage?.output_tokens,
            toolCalls: toolCalls?.length ? toolCalls : undefined
          };
        }
      }

      case "gemini-cli": {
        // T1.1 (vNext): fail-fast when the gemini binary is absent/unauthed (8s-cached probe)
        // so a fallback-chain pass-through doesn't pay the spawn + kill-timer wait. Keeps
        // gemini-cli as a chain member (loop design) but skips it instantly when unusable.
        if (!(await geminiCliAvailable())) throw new Error("gemini-cli unavailable (binary not installed/authed)");
        // Concurrent backend: drive the external Google Gemini CLI as a subprocess. It runs
        // its OWN agent loop (tools + Google grounding) and returns the final text → no
        // tool_calls, so the ollamas ReAct loop treats this as a final reply and halts.
        // Use a pooled GEMINI_API_KEY when available (per-key 1000/day × N, rotatable) — falls
        // back to the binary's own OAuth when the pool is empty. Count the use against the pool.
        const poolKey = ProviderRouter.getDecryptedKey("gemini");
        const r = await generateViaGeminiCli(msgs, config.model || undefined, signal, "gemini", poolKey || undefined);
        if (poolKey) recordKeyUse("gemini", keyId(poolKey));
        return { text: r.text, source: poolKey ? "gemini-cli:keyed" : "gemini-cli:oauth", modelUsed: r.modelUsed, tokens: undefined, tokensPerSec: r.tokensPerSec };
      }

      case "demo":
      default: {
        // Return structured, clean, informative mock context explaining target
        const simulatedText = `[LLM Mission Control - Dual-Mode Demo Fallback]
Hello! Currently, the system is executing in DEMO Mode (Cloud Sandboxing). 
Since the local MacBook workstation cannot be reached directly across the public cloud container,
the multi-agent pipeline is executing on a high-fidelity local emulation layer.

### System Configuration Selected:
- Role Provider: ${config.provider}
- Active Target Model: ${config.model}
- Context Limits: ${config.numCtx || "Default 8K"}

To run genuine macOS terminal execution, read/write local filesystem files directly, and run offline, GPU-accelerated local models via metal-backed Ollama:
1. Export this appলেট as a zip archive (Top-Right "Export" menu).
2. Unpack the files onto your macOS system.
3. Run "./install.sh" or "npm install && npm run dev".
4. Open http://localhost:3000 to launch live MacBook mode!`;

        if (onStreamChunk) {
          // Stream chunks beautifully with delays to simulate actual output
          const words = simulatedText.split(" ");
          for (let i = 0; i < words.length; i++) {
            onStreamChunk(words[i] + " ");
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        return { text: simulatedText, source: "demo", modelUsed: config.model };
      }
    }
  }

  /**
   * Record a provider's measured latency (success = its own per-attempt ms; failure = penalized
   * via latencyForFailure). Feeds getFallbackChain's cloud-tier ordering (T2.2). O(1) hot-path write.
   */
  public static recordLatency(providerId: string, ms: number): void {
    latencyCache[providerId] = { latencyMs: ms, updatedAt: Date.now() };
  }

  /**
   * Safe latency retrieval helper
   */
  public static getLatency(providerId: string): number {
    const entry = latencyCache[providerId];
    if (entry && Date.now() - entry.updatedAt < 300000) {
      return entry.latencyMs;
    }
    return -1;
  }
}
