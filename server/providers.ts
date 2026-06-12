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
}

export interface GenerateResult {
  text: string;
  source: string; // e.g. "ollama_local", "cloud:gemini", "cloud:openrouter", "demo"
  modelUsed: string;
  latencyMs: number;
  tokensPerSec?: number;
}

// In-Memory Latency Tracker
interface LatencyEntry {
  latencyMs: number;
  updatedAt: number;
}
const latencyCache: Record<string, LatencyEntry> = {};

export class ProviderRouter {
  /**
   * Main route function with fallback and latency awareness
   */
  public static async generate(
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void
  ): Promise<GenerateResult> {
    const start = Date.now();
    const providersToTry = this.getFallbackChain(config.provider);
    let lastError: Error | null = null;

    for (const prov of providersToTry) {
      try {
        const resolvedConfig = { ...config, provider: prov };
        // If specific provider key isn't set, skip unless it's ollama-local or we are in DEMO fallback mode
        if (prov !== "ollama-local" && prov !== "demo" && !this.hasKey(prov)) {
          continue;
        }

        const result = await this.executeProvider(resolvedConfig, onStreamChunk);
        
        // Track successfully executed provider's latency
        const elapsed = Date.now() - start;
        latencyCache[prov] = { latencyMs: elapsed, updatedAt: Date.now() };

        return {
          ...result,
          latencyMs: elapsed,
        };
      } catch (err: any) {
        console.warn(`[Router] Provider ${prov} failed: ${err?.message || err}. Retrying fallback...`);
        lastError = err;
        // Proceed to next fallback provider
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
    const defaults = ["ollama-local", "openrouter", "gemini", "openai", "demo"];
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

  private static getDecryptedKey(provider: string): string {
    const encryptedKey = db.data.keys[provider];
    if (encryptedKey) {
      const decrypted = db.decrypt(encryptedKey);
      if (decrypted) return decrypted;
    }
    return process.env[this.getEnvKeyName(provider)] || "";
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

  /**
   * Individual execution adapter
   */
  private static async executeProvider(
    config: GenerateConfig,
    onStreamChunk?: (text: string) => void
  ): Promise<{ text: string; source: string; modelUsed: string; tokensPerSec?: number }> {
    const systemMessage = config.messages.find((m) => m.role === "system")?.content || "";
    const nonSystemMessages = config.messages.filter((m) => m.role !== "system");

    switch (config.provider) {
      case "ollama-local": {
        const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
        const numCtx = config.numCtx || db.data.ollamaNumCtx || 8192;
        
        // Dynamic fetch request directly to /api/chat
        const response = await fetch(`${ollamaHost}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model || "qwen3:8b",
            messages: config.messages,
            options: {
              num_ctx: numCtx,
              temperature: config.temperature ?? 0.7,
            },
            think: false, // Prevent reasoning bloat output according to L6 Spec
            stream: !!onStreamChunk,
          }),
          signal: AbortSignal.timeout(300000), // Massive timeout for slow-loading local models (L12)
        });

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
          return { text: reply, source: "ollama_local", modelUsed: config.model, tokensPerSec };
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
            },
          });
          return { text: response.text || "", source: "cloud:gemini", modelUsed: geminiModel };
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
          }),
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
          return {
            text: json.choices?.[0]?.message?.content || "",
            source: "cloud:openrouter",
            modelUsed: config.model,
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
          }),
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
          return {
            text: json.choices?.[0]?.message?.content || "",
            source: `cloud:${keyProvider}`,
            modelUsed: config.model,
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
          }),
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
          const reply = json.content?.[0]?.text || "";
          return { text: reply, source: "cloud:anthropic", modelUsed: config.model };
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
