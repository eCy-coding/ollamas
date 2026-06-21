import { GoogleGenAI } from "@google/genai";
import { db } from "./db";

// Types
export interface ProviderMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GenerateConfig {
  provider: string;
  model: string;
  messages: ProviderMessage[];
  numCtx?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

// Tolerant JSON parse for model-emitted tool-call arguments: a truncated/malformed
// arguments string must NOT throw — that would crash the whole tool_calls .map() and
// silently drop the request to provider-fallback (→ demo). Returns {} on failure.
function safeJsonObj(s: string): any { try { return JSON.parse(s); } catch { return {}; } }

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
  toolCalls?: ToolCall[];
}

// In-Memory Latency Tracker
interface LatencyEntry {
  latencyMs: number;
  updatedAt: number;
}
const latencyCache: Record<string, LatencyEntry> = {};

// Compose caller-supplied cancellation with the 300s provider timeout.
// When no caller signal is given the plain timeout is preserved unchanged.
function buildSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(300000);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

export class ProviderRouter {
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
    const providersToTry = this.getFallbackChain(config.provider);
    let lastError: Error | null = null;

    for (const prov of providersToTry) {
      const resolvedConfig = { ...config, provider: prov };
      // A model name belongs to its provider: "gemini-2.0-flash" is meaningless to
      // ollama (404 "model not found") and would cascade the whole chain to demo.
      // When falling back to a DIFFERENT provider than the one requested, drop the
      // requested model so each provider resolves its own default (case-local `||`).
      if (prov !== config.provider) resolvedConfig.model = undefined;
      // If specific provider key isn't set, skip unless it's ollama-local or we are in DEMO fallback mode
      if (prov !== "ollama-local" && prov !== "demo" && !this.hasKey(prov)) {
        continue;
      }

      // Key-pool rotation: a provider may hold MULTIPLE user-supplied keys. On a
      // quota (429) or auth (401) failure, cool the spent key and retry the SAME
      // provider with the next live key before falling through the provider chain.
      // (Rotation across user keys only — the system never auto-acquires new keys.)
      const cloudKeyed = prov !== "ollama-local" && prov !== "demo";
      const attempts = cloudKeyed ? Math.max(1, this.keyPool(prov).length) : 1;
      let provErr: any = null;
      let rotated = false;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const result = await this.executeProvider(resolvedConfig, onStreamChunk, signal);
          const elapsed = Date.now() - start;
          latencyCache[prov] = { latencyMs: elapsed, updatedAt: Date.now() };
          return { ...result, latencyMs: elapsed };
        } catch (err: any) {
          provErr = err;
          const m = (err?.message || "").toLowerCase();
          const isQuota = m.includes("429") || m.includes("quota") || m.includes("rate limit") || m.includes("resource_exhausted") || m.includes("exceeded");
          const isAuth = m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden") || m.includes("api key");
          if (cloudKeyed && (isQuota || isAuth)) {
            const spent = this.getDecryptedKey(prov);
            // Cool the spent key: quota recovers (6h), an invalid key stays out longer (24h).
            if (spent) this.markKeyCooldown(prov, spent, isQuota ? 6 * 3600_000 : 24 * 3600_000);
            const live = this.liveKeyCount(prov);
            // Token NAMES/positions ok to log; VALUES never.
            console.warn(`[KeyPool] ${prov} key#${attempt + 1} ${isQuota ? "quota" : "auth"}-exhausted → ${live} live key(s) remain`);
            if (live > 0 && attempt + 1 < attempts) { rotated = true; continue; } // retry same provider, next key
          }
          break; // not a key error, or pool exhausted → fall through to provider chain
        }
      }

      // Provider exhausted (all its keys, or a non-key error). Decide fallback.
      console.warn(`[Router] Provider ${prov} failed: ${provErr?.message || provErr}. Retrying fallback...`);
      lastError = provErr;
      const lowercaseMsg = (provErr?.message || "").toLowerCase();
      const isQuotaErr = lowercaseMsg.includes("429") || lowercaseMsg.includes("quota") || lowercaseMsg.includes("resource_exhausted") || lowercaseMsg.includes("exceeded");
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
  private static getFallbackChain(initial: string): string[] {
    const defaults = ["ollama-local", "openrouter", "gemini", "openai", "ollama-cloud", "demo"];
    const index = defaults.indexOf(initial);
    if (index === -1) {
      return [initial, ...defaults];
    }
    // Reorder so that initial is first, then rest
    return [initial, ...defaults.filter((p) => p !== initial)];
  }

  private static hasKey(provider: string): boolean {
    const rawKeys = db.data.keys || {};
    const key = rawKeys[provider] || process.env[this.getEnvKeyName(provider)];
    return typeof key === "string" && key.trim().length > 0;
  }

  // --- API key pool + rotation (user-supplied keys only; never auto-acquired) ---
  // Per-process cooldown: keyed by provider+key → expiry epoch ms. In-memory by design
  // (simplest; resets on restart, by which time provider quotas have refilled).
  private static keyCooldown = new Map<string, number>();
  private static ckey(provider: string, key: string): string { return `${provider}::${key}`; }
  public static markKeyCooldown(provider: string, key: string, ttlMs: number): void {
    this.keyCooldown.set(this.ckey(provider, key), Date.now() + ttlMs);
  }
  private static isCooled(provider: string, key: string): boolean {
    const exp = this.keyCooldown.get(this.ckey(provider, key));
    if (!exp) return false;
    if (Date.now() >= exp) { this.keyCooldown.delete(this.ckey(provider, key)); return false; } // recovered
    return true;
  }

  // All candidate keys for a provider: vault key first, then env `NAME`, `NAME_1..9`,
  // and comma-separated `NAMES`. Deduped, non-empty. Drop a new key into .env (e.g.
  // GEMINI_API_KEY_2=... or GEMINI_API_KEYS=k1,k2) and it joins the pool on next boot.
  public static keyPool(provider: string): string[] {
    const keys: string[] = [];
    const enc = db.data.keys?.[provider];
    if (enc) { const d = db.decrypt(enc); if (d) keys.push(d); }
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

  public static getDecryptedKey(provider: string): string {
    const pool = this.keyPool(provider);
    if (pool.length === 0) return "";
    // Prefer the first key not in cooldown; if all are cooled, best-effort the first.
    return pool.find((k) => !this.isCooled(provider, k)) || pool[0];
  }

  private static getEnvKeyName(provider: string): string {
    switch (provider) {
      case "gemini": return "GEMINI_API_KEY";
      case "anthropic": return "ANTHROPIC_API_KEY";
      case "openai": return "OPENAI_API_KEY";
      case "openrouter": return "OPENROUTER_API_KEY";
      case "ollama-cloud": return "OLLAMA_CLOUD_KEY";
      default: return "";
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
   * Individual execution adapter
   */
  private static async executeProvider(
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string; source: string; modelUsed: string; tokensPerSec?: number; tokens?: number; toolCalls?: ToolCall[] }> {
    // Defensive: a malformed call (no messages) must not crash the router with a
    // TypeError — fall through to an empty conversation (provider/demo handles it).
    const msgs = config.messages || [];
    const systemMessage = msgs.find((m) => m.role === "system")?.content || "";
    const nonSystemMessages = msgs.filter((m) => m.role !== "system");

    switch (config.provider) {
      case "ollama-local": {
        const numCtx = config.numCtx || db.data.ollamaNumCtx || 8192;
        const reqBody = JSON.stringify({
          model: config.model || "qwen3:8b",
          messages: config.messages,
          options: {
            num_ctx: numCtx,
            temperature: config.temperature ?? 0.7,
            // Calibrated for Apple Silicon: pin threads to performance cores,
            // keep all layers on the GPU. Env-driven (omitted if unset).
            ...(process.env.OLLAMA_NUM_THREAD ? { num_thread: Number(process.env.OLLAMA_NUM_THREAD) } : {}),
            ...(process.env.OLLAMA_NUM_GPU ? { num_gpu: Number(process.env.OLLAMA_NUM_GPU) } : {}),
          },
          // Keep the model warm in Metal VRAM so repeat calls skip the reload
          // cost (stable low latency). Default 30m; "0" disables.
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m",
          think: false, // Prevent reasoning bloat output according to L6 Spec
          stream: !!onStreamChunk,
          tools: config.tools,
        });

        // Host resolution is environment-dependent: docker uses host.docker.internal,
        // local dev uses localhost. Try the configured host first, then loopback —
        // a connection-level failure (DNS/refused) advances to the next candidate so
        // the SAME .env works in both docker and `npm run dev` (no manual edit).
        const ollamaHosts = [...new Set([
          process.env.OLLAMA_HOST || "http://localhost:11434",
          "http://localhost:11434",
          "http://127.0.0.1:11434",
        ])];
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

          while (true) {
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
                const chunkText = parsed?.message?.content || "";
                if (chunkText) {
                  onStreamChunk(chunkText);
                  fullText += chunkText;
                }
                if (parsed.done && parsed.eval_count && parsed.eval_duration) {
                  return { text: fullText, source: "ollama_local", modelUsed: config.model, tokensPerSec: parsed.eval_count / (parsed.eval_duration / 1e9) };
                }
              } catch (e) {
                // Keep moving on parse anomalies
              }
            }
          }
          return { text: fullText, source: "ollama_local", modelUsed: config.model };
        } else {
          const resultJson = await response.json();
          let reply = resultJson?.message?.content || "";
          
          // L6: If reasoning model returns empty, fallback if it gave a thinking key
          if (!reply && resultJson?.message?.thinking) {
            reply = resultJson.message.thinking;
          }
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
          // Fallback: some models emit tool calls as text — recover them.
          if (!toolCalls || toolCalls.length === 0) toolCalls = extractTextToolCalls(reply) ?? toolCalls;

          return { text: reply, source: "ollama_local", modelUsed: config.model, tokensPerSec, tokens: resultJson.eval_count, toolCalls };
        }
      }

      case "ollama-cloud": {
        const apiKey = this.getDecryptedKey("ollama-cloud");
        if (!apiKey) throw new Error("Ollama Cloud Key is not set");
        const ollamaHost = "https://ollama.com/api";
        const numCtx = config.numCtx || db.data.ollamaNumCtx || 8192;
        
        const response = await fetch(`${ollamaHost}/chat`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: config.model || "qwen3:8b",
            messages: config.messages,
            options: {
              num_ctx: numCtx,
              temperature: config.temperature ?? 0.7,
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
        const formattedContents = nonSystemMessages.map((m) => ({
          role: m.role === "assistant" ? "model" as const : "user" as const,
          parts: [{ text: m.content }],
        }));

        if (onStreamChunk) {
          const responseStream = await ai.models.generateContentStream({
            model: geminiModel,
            contents: formattedContents,
            config: {
              systemInstruction: systemMessage,
              temperature: config.temperature ?? 0.7,
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
            model: config.model || "google/gemini-2.5-flash-lite:free",
            messages: config.messages,
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
      case "custom-openai": {
        const isCustom = config.provider === "custom-openai";
        const keyProvider = isCustom ? "custom-openai" : "openai";
        const apiKey = this.getDecryptedKey(keyProvider);
        if (!apiKey) throw new Error(`${isCustom ? "Custom" : "OpenAI"} API Key not set`);

        const baseUrl = isCustom 
          ? (db.data.keys["custom-openai-endpoint"] || "https://api.openai.com/v1")
          : "https://api.openai.com/v1";

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.model || (isCustom ? "" : "gpt-4o-mini"),
            messages: config.messages,
            temperature: config.temperature ?? 0.7,
            stream: !!onStreamChunk,
            tools: config.tools,
          }),
          signal: buildSignal(signal),
        });

        if (!response.ok) {
          throw new Error(`OpenAI-compatible host returned error ${response.status}`);
        }

        if (onStreamChunk && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let fullText = "";

          while (true) {
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
          return { text: fullText, source: `cloud:${keyProvider}`, modelUsed: config.model };
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
            source: `cloud:${keyProvider}`,
            modelUsed: config.model,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
          };
        }
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
            messages: nonSystemMessages,
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
            toolCalls: toolCalls?.length ? toolCalls : undefined
          };
        }
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
