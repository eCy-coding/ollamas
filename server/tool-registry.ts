// Single choke-point for ALL workspace tool execution (AGENTS.md §4).
// The ReAct loop (server.ts), the MCP server (expose, Faz 1) and the MCP client
// (consume, Faz 1) all run tools through ToolRegistry.execute — never a second
// dispatch path. Metering/auth/rate-limit/per-tenant allowlist all hook here.
//
// Host helpers (execOnHost, runOnHostTerminal, ...) live in server.ts and are
// injected via ToolDeps to avoid a circular import and keep host-bridge state
// owned by one module.

import Ajv, { type ValidateFunction } from "ajv";
import { runPre, runPost } from "./tool-interceptors";
import type { FilesystemManager } from "./files";
import type { TerminalManager } from "./terminal";

// outputSchema enforcement (v1.7-A). A tool may declare `schema.function.outputSchema`
// (advertised over MCP since Faz 14B). When such a tool returns STRUCTURED (object)
// output we validate it here at the single choke-point — so HTTP expose, stdio, the
// ReAct loop and consume side all get the same guarantee. ajv ships with the MCP SDK
// (no new heavy dep); compiled validators are cached by schema identity.
// allErrors:false (default) — first error only; avoids unbounded error allocation
// when validating UNTRUSTED upstream tool output (DoS hardening, semgrep ajv-allerrors).
const ajv = new Ajv({ strict: false });
const validatorCache = new WeakMap<object, ValidateFunction | null>();
function getValidator(schema: any): ValidateFunction | null {
  if (!schema || typeof schema !== "object") return null;
  if (validatorCache.has(schema)) return validatorCache.get(schema)!;
  let v: ValidateFunction | null = null;
  try { v = ajv.compile(schema); } catch { v = null; } // malformed schema → no-op, never fatal
  validatorCache.set(schema, v);
  return v;
}

/**
 * Security tier — gates which tenant plans may call a tool (AGENTS.md §5).
 * `host_upstream` = tools merged from an UNTRUSTED upstream MCP server (consume
 * side); excluded from default MCP expose so they never reach a tenant unless a
 * plan/admin explicitly allows that tier.
 */
export type ToolTier = "safe" | "host" | "privileged" | "host_upstream";

/** Host-side helpers the tool thunks need, owned by server.ts and injected. */
export interface ToolDeps {
  FilesystemManager: typeof FilesystemManager;
  TerminalManager: typeof TerminalManager;
  runOnHostTerminal: (target: string | undefined, command: string, timeoutMs?: number, signal?: AbortSignal) => Promise<any>;
  writeHostFile: (filePath: string, content: string, signal?: AbortSignal) => Promise<any>;
  execOnHost: (command: string, timeoutMs?: number, signal?: AbortSignal) => Promise<any>;
  HOST_TOOLS_DIR: string;
  shArg: (s: string) => string;
  db: { logSecurity: (cat: string, what: string, how: string, decision: string) => void };
}

/** Per-call context flowing through the choke-point. */
export interface ToolCtx {
  isLive: boolean;
  workspaceRoot: string;
  autoApply: boolean;
  deps: ToolDeps;
  /** When set, only these tiers may run (per-tenant allowlist, Faz 3). */
  allowedTiers?: ToolTier[];
  /** OAuth scopes granted to the caller. When non-empty, non-safe tools require
   *  the matching `tools:<tier>` scope (Faz 9B). Empty = no scope restriction. */
  scopes?: string[];
  /** Tenant identifier for metering/audit (Faz 4). */
  tenantId?: string;
  /** MCP progress token from request `_meta` (Faz 10A). */
  progressToken?: string | number;
  /** Emit an MCP progress notification during a long tool call (Faz 10A). */
  onProgress?: (progress: number, total?: number, message?: string) => void;
  /** Metering hook, invoked after every call (Faz 4). */
  onUsage?: (e: { tool: string; tier: ToolTier; ok: boolean; latencyMs: number; tenantId?: string }) => void;
  /** Cooperative cancellation (Faz 17D). Aborted before/while a tool runs → the
   *  call returns ok:false `cancelled` promptly (the MCP CancelledNotification path). */
  abortSignal?: AbortSignal;
  /** Server→client elicitation (Faz 18). Set ONLY when the connected client
   *  advertises the `elicitation` capability (bidirectional stdio). A tool may
   *  ask the user a structured question; undefined → tool falls back (e.g. halt). */
  onElicit?: (message: string, requestedSchema: any) => Promise<{ action: "accept" | "decline" | "cancel"; content?: any }>;
  /** Server→client sampling (Faz 18). Set ONLY when the client advertises the
   *  `sampling` capability. A tool may ask the client's LLM to generate text. */
  onSample?: (params: { messages: any[]; systemPrompt?: string; maxTokens?: number }) => Promise<{ text: string }>;
}

/** Normalized result the ReAct loop and MCP layer consume. */
export interface ToolResult {
  ok: boolean;
  output: any;
  /** Unified diff for write_file (approval flow). */
  diff: string;
  /** Whether a file write was actually applied to disk. */
  applied: boolean;
  /** Pause the ReAct loop for manual approval (write_file, autoApply=false). */
  halt: boolean;
}

/** OpenAI function-calling schema (also used directly as MCP inputSchema). */
export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: any; outputSchema?: any };
}

interface ToolDef {
  tier: ToolTier;
  schema: ToolSchema;
  /** Returns output (string|object), or a partial ToolResult for diff/halt cases. */
  invoke: (args: any, ctx: ToolCtx) => Promise<any | { output: any; diff?: string; applied?: boolean; halt?: boolean }>;
}

const fn = (name: string, description: string, parameters: any, outputSchema?: any): ToolSchema => ({
  type: "function",
  function: { name, description, parameters, ...(outputSchema ? { outputSchema } : {}) },
});
const NO_ARGS = { type: "object", properties: {}, required: [] };

/**
 * Parse `llama-bench -o json` output (a JSON array of run records) into a
 * normalized tok/s reading. llama.cpp reports throughput as `avg_ts`
 * (tokens/sec) per run; prompt-processing (`pp`) and generation (`tg`) runs are
 * distinct rows. We surface generation tok/s as `tps` and prompt tok/s as
 * `pp_tps`. Throws on unparseable input so the choke-point returns ok:false.
 * Exported for the v1.8 contract test (no real binary needed to test parsing).
 */
export function parseLlamaBench(raw: string): { tps: number; pp_tps?: number; model?: string; runs: number } {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) throw new Error("llama-bench: no JSON array in output");
  const rows: any[] = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("llama-bench: empty result set");
  // n_gen>0 → generation run (the tok/s users care about); n_prompt>0 only → prompt run.
  const gen = rows.find((r) => Number(r.n_gen) > 0) ?? rows[rows.length - 1];
  const pp = rows.find((r) => Number(r.n_prompt) > 0 && !(Number(r.n_gen) > 0));
  const tps = Number(gen.avg_ts);
  if (!Number.isFinite(tps)) throw new Error("llama-bench: missing avg_ts");
  return {
    tps,
    pp_tps: pp && Number.isFinite(Number(pp.avg_ts)) ? Number(pp.avg_ts) : undefined,
    model: gen.model_filename || gen.model_type || undefined,
    runs: rows.length,
  };
}

const TOOLS: Record<string, ToolDef> = {
  list_tree: {
    tier: "safe",
    schema: fn("list_tree", "List the entire workspace files directory structure recursively.", NO_ARGS),
    invoke: async (_args, { isLive, workspaceRoot, deps }) => {
      const tree = await deps.FilesystemManager.getTree(isLive, workspaceRoot);
      deps.db.logSecurity("file_system", "Agent list_tree", "Traced files tree dynamically", "allow");
      return tree.tree;
    },
  },

  read_file: {
    tier: "safe",
    schema: fn("read_file", "Read full contents of a file at the specified workspace path.", {
      type: "object",
      properties: { path: { type: "string", description: "The workspace-relative path of the target file to load." } },
      required: ["path"],
    }),
    invoke: async (args, { isLive, workspaceRoot, deps }) => {
      if (!args.path) throw new Error("Missing 'path' argument.");
      const text = deps.FilesystemManager.readFile(isLive, workspaceRoot, args.path);
      deps.db.logSecurity("file_system", `Agent read_file: ${args.path}`, "Opened file contents securely", "allow");
      return text;
    },
  },

  write_file: {
    tier: "safe",
    schema: fn(
      "write_file",
      "Propose or write updated full content to a file at the specified workspace relative path. If autoApply is false, this returns a unified diff for user approval before saving.",
      {
        type: "object",
        properties: {
          path: { type: "string", description: "The workspace-relative path of the file." },
          content: { type: "string", description: "The full file content to write." },
        },
        required: ["path", "content"],
      }
    ),
    invoke: async (args, ctx) => {
      const { isLive, workspaceRoot, autoApply, deps } = ctx;
      if (!args.path || args.content === undefined) {
        throw new Error("Missing 'path' or 'content' in write_file parameters.");
      }
      let oldContent = "";
      try {
        oldContent = deps.FilesystemManager.readFile(isLive, workspaceRoot, args.path);
      } catch {}
      const diff = deps.FilesystemManager.generateUnifiedDiff(args.path, oldContent, args.content);

      const apply = () => {
        deps.FilesystemManager.writeFile(isLive, workspaceRoot, args.path, args.content);
        deps.db.logSecurity("file_system", `Agent write_file: ${args.path}`, "Wrote code modifications into workspace", "allow");
      };

      if (autoApply) {
        apply();
        return { output: "Changes written to disk successfully.", diff, applied: true };
      }

      // Faz 18B: when the client supports elicitation (bidirectional stdio), ask the
      // user to approve INSTEAD of halting the loop. Falls back to halt otherwise.
      if (ctx.onElicit) {
        const res = await ctx.onElicit(`Apply write to ${args.path}?`, {
          type: "object",
          properties: { approve: { type: "boolean", title: `Apply changes to ${args.path}?` } },
          required: ["approve"],
        });
        if (res.action === "accept" && res.content?.approve) {
          apply();
          return { output: "Changes written after elicited approval.", diff, applied: true };
        }
        return { output: `Write declined (${res.action}).`, diff, applied: false };
      }

      // Pause the loop for manual validation; diff is surfaced for approval.
      return { output: "File write is pending authorization. Diffs are stored and waiting for manual approval.", diff, applied: false, halt: true };
    },
  },

  run_command: {
    tier: "safe",
    schema: fn("run_command", "Execute a command against the safe shell terminal environment (e.g. pytest, git, ls, date). Restricted system operations are blocked.", {
      type: "object",
      properties: { command: { type: "string", description: "The shell terminal command line parameters to execute." } },
      required: ["command"],
    }),
    invoke: async (args, { isLive, workspaceRoot, deps }) => {
      if (!args.command) throw new Error("Missing 'command' argument.");
      return await deps.TerminalManager.execute(isLive, workspaceRoot, args.command);
    },
  },

  grep_search: {
    tier: "safe",
    schema: fn("grep_search", "Search for clean text matches inside files inside the project recursively.", {
      type: "object",
      properties: { query: { type: "string", description: "The pattern query string to scan." } },
      required: ["query"],
    }),
    invoke: async (args, { isLive, workspaceRoot, deps }) => {
      if (!args.query) throw new Error("Missing 'query' parameter.");
      return await deps.TerminalManager.execute(isLive, workspaceRoot, `grep -rnI "${args.query}" .`);
    },
  },

  macos_terminal: {
    tier: "privileged",
    schema: fn(
      "macos_terminal",
      "Run a shell command in a REAL, visible macOS terminal window (iTerm2 or Terminal.app) on the host, in real time, and return its output and exit code. Use for live coding sessions the user can watch. Unlike run_command this has no sandbox/allowlist — full host privileges.",
      {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to type and run in the visible terminal." },
          target: { type: "string", enum: ["iterm2", "terminal"], description: "Which terminal app to drive. Defaults to iterm2." },
        },
        required: ["command"],
      }
    ),
    invoke: async (args, { deps, abortSignal }) => {
      if (!args.command) throw new Error("Missing 'command' argument.");
      return await deps.runOnHostTerminal(args.target, args.command, undefined, abortSignal);
    },
  },

  write_host_file: {
    tier: "privileged",
    schema: fn(
      "write_host_file",
      "Write a file directly to the macOS HOST filesystem at an absolute path (creates parent dirs). Use this — not write_file — to author host scripts/tools (e.g. under bin/host-bridge/tools). Reliable for multi-line content; no shell/heredoc needed.",
      {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute host path, e.g. /Users/.../bin/host-bridge/tools/x.mjs" },
          content: { type: "string", description: "Full file content." },
        },
        required: ["path", "content"],
      }
    ),
    invoke: async (args, { deps, abortSignal }) => {
      if (!args.path || args.content === undefined) throw new Error("Missing 'path' or 'content'.");
      return await deps.writeHostFile(args.path, args.content, abortSignal);
    },
  },

  run_tests: {
    tier: "safe",
    schema: fn("run_tests", "Run the project's test suite (vitest unit tests in the container) and return pass/fail summary.", NO_ARGS),
    invoke: async (_args, { deps, abortSignal }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/run_tests.mjs`, undefined, abortSignal),
  },

  git_ops: {
    tier: "safe",
    schema: fn("git_ops", "Read-only git inspection. sub: status (default) | diff | branch | log.", {
      type: "object",
      properties: { sub: { type: "string", enum: ["status", "diff", "branch", "log"] } },
      required: [],
    }),
    invoke: async (args, { deps }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/git_ops.mjs ${deps.shArg(String(args.sub || "status"))}`),
  },

  process_port: {
    tier: "safe",
    schema: fn("process_port", "List the process(es) listening on a TCP port on the host.", {
      type: "object",
      properties: { port: { type: "number", description: "TCP port number, e.g. 3000." } },
      required: ["port"],
    }),
    invoke: async (args, { deps }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/process_port.mjs ${Number(args.port) || 3000}`),
  },

  health_probe: {
    tier: "safe",
    schema: fn("health_probe", "Aggregate health of the whole stack (bridge, app, ollama, terminals) plus a live terminal log snapshot.", NO_ARGS),
    invoke: async (_args, { deps }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/health_probe.mjs`),
  },

  lint_format: {
    tier: "safe",
    schema: fn("lint_format", "Typecheck the project (tsc --noEmit) and return whether it is clean plus any type errors.", NO_ARGS),
    invoke: async (_args, { deps, abortSignal }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/lint_format.mjs`, 250000, abortSignal),
  },

  git_commit: {
    tier: "host",
    schema: fn("git_commit", "Stage all changes and commit with the given message. Set push=true to also push.", {
      type: "object",
      properties: { message: { type: "string", description: "Commit message." }, push: { type: "boolean", description: "Also push after committing." } },
      required: ["message"],
    }),
    invoke: async (args, { deps }) => {
      if (!args.message) throw new Error("Missing 'message'.");
      return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/git_commit.mjs ${args.push ? "--push " : ""}${deps.shArg(String(args.message))}`);
    },
  },

  build_app: {
    tier: "host",
    schema: fn("build_app", "Rebuild and recreate the app container (docker compose build + up -d) and report whether it came back healthy.", NO_ARGS),
    invoke: async (_args, { deps, abortSignal }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/build_app.mjs`, 220000, abortSignal),
  },

  kill_process: {
    tier: "host",
    schema: fn("kill_process", "Kill a host process by PID, or all listeners on a port (':<port>'). Optional signal.", {
      type: "object",
      properties: { target: { type: "string", description: "A PID (e.g. '4123') or a port as ':<port>'." }, signal: { type: "string", enum: ["TERM", "KILL", "INT", "HUP"] } },
      required: ["target"],
    }),
    invoke: async (args, { deps }) => {
      if (!args.target) throw new Error("Missing 'target' (pid or :port).");
      return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/kill_process.mjs ${args.signal ? "--sig " + deps.shArg(String(args.signal)) + " " : ""}${deps.shArg(String(args.target))}`);
    },
  },

  log_stream: {
    tier: "safe",
    schema: fn("log_stream", "Show the last N lines of the app container logs (default 40).", {
      type: "object",
      properties: { lines: { type: "number", description: "How many log lines to show." } },
      required: [],
    }),
    invoke: async (args, { deps }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/log_stream.mjs ${Number(args.lines) || 40}`),
  },

  pkg_install: {
    tier: "host",
    schema: fn("pkg_install", "Install a package via npm (in the container), pip, or brew. Requires manager + package.", {
      type: "object",
      properties: { manager: { type: "string", enum: ["npm", "pip", "brew"] }, package: { type: "string" } },
      required: ["manager", "package"],
    }),
    invoke: async (args, { deps, abortSignal }) => {
      if (!args.manager || !args.package) throw new Error("Missing 'manager' or 'package'.");
      return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/pkg_install.mjs ${deps.shArg(String(args.manager))} ${deps.shArg(String(args.package))}`, 150000, abortSignal);
    },
  },

  web_search: {
    tier: "safe",
    schema: fn("web_search", "Web research. Pass query for DuckDuckGo results, OR url to fetch+extract a page's text.", {
      type: "object",
      properties: { query: { type: "string" }, url: { type: "string", description: "If set, fetch this page's readable text instead of searching." } },
      required: [],
    }),
    invoke: async (args, { deps, abortSignal }) => {
      if (args.url) return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/web_search.mjs --fetch ${deps.shArg(String(args.url))}`, undefined, abortSignal);
      if (args.query) return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/web_search.mjs ${deps.shArg(String(args.query))}`, undefined, abortSignal);
      throw new Error("Missing 'query' or 'url'.");
    },
  },

  apply_patch: {
    tier: "host",
    schema: fn("apply_patch", "Apply a unified-diff patch to the repository (git apply, checked first). Pass the full diff text.", {
      type: "object",
      properties: { diff: { type: "string", description: "Unified diff text." } },
      required: ["diff"],
    }),
    invoke: async (args, { deps, abortSignal }) => {
      if (!args.diff) throw new Error("Missing 'diff'.");
      return deps.execOnHost(`printf '%s' ${deps.shArg(String(args.diff))} | node ${deps.HOST_TOOLS_DIR}/apply_patch.mjs`, undefined, abortSignal);
    },
  },

  tools_doctor: {
    tier: "safe",
    schema: fn("tools_doctor", "Self-test the whole bridge toolkit and return a health matrix (which tools pass/fail).", NO_ARGS),
    invoke: async (_args, { deps, abortSignal }) => deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/tools_doctor.mjs`, 90000, abortSignal),
  },

  shell_check: {
    tier: "safe",
    schema: fn(
      "shell_check",
      "Lint a shell command/script for bugs and macOS/BSD portability issues (shellcheck + heuristics) BEFORE running it. Run this on any non-trivial command, fix what it reports, then use macos_terminal.",
      { type: "object", properties: { command: { type: "string", description: "The shell command/script to lint." } }, required: ["command"] }
    ),
    invoke: async (args, { deps, abortSignal }) => {
      if (!args.command) throw new Error("Missing 'command'.");
      return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/shell_check.mjs ${deps.shArg(String(args.command))}`, 60000, abortSignal);
    },
  },

  logbook: {
    tier: "safe",
    schema: fn("logbook", "Ship's log (seyir defteri). action 'add' with text records a note; action 'tail' returns recent entries (agent steps are auto-logged).", {
      type: "object",
      properties: { action: { type: "string", enum: ["add", "tail"] }, text: { type: "string" }, n: { type: "number" } },
      required: ["action"],
    }),
    invoke: async (args, { deps }) => {
      if (args.action === "add") return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/logbook.mjs add ${deps.shArg(String(args.text || ""))}`);
      return deps.execOnHost(`node ${deps.HOST_TOOLS_DIR}/logbook.mjs tail ${Number(args.n) || 20}`);
    },
  },

  // Faz 23 (v1.14): expose-side SAMPLING. Asks the CONNECTING client's own LLM to
  // generate text via MCP sampling (server→client createMessage). The expose layer
  // sets ctx.onSample ONLY when the client advertised the `sampling` capability
  // (bidirectional transport, e.g. stdio); otherwise the tool returns a notice.
  // Symmetric to the consume-side sampling provider (Faz 18C). safe tier: it spends
  // the CALLER's model, never ollamas' host/resources. No output sanitization — the
  // text comes from the caller's own LLM, not an untrusted upstream.
  sample: {
    tier: "safe",
    schema: fn(
      "sample",
      "Ask the CONNECTING MCP client's own LLM to generate text (MCP sampling). Works only when the client advertised the `sampling` capability (bidirectional transport, e.g. stdio); otherwise returns a notice.",
      {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The user prompt to send to the client's LLM." },
          system: { type: "string", description: "Optional system prompt." },
          maxTokens: { type: "number", description: "Max tokens to generate (default 1024)." },
        },
        required: ["prompt"],
      }
    ),
    invoke: async (args, ctx) => {
      if (!args.prompt) throw new Error("Missing 'prompt'.");
      if (!ctx.onSample) return "sampling unavailable: the connected client did not advertise the sampling capability";
      const r = await ctx.onSample({
        messages: [{ role: "user", content: { type: "text", text: String(args.prompt) } }],
        systemPrompt: args.system ? String(args.system) : undefined,
        maxTokens: Number(args.maxTokens) || 1024,
      });
      return r.text;
    },
  },
  // v1.8: tok/s telemetry via llama.cpp's `llama-bench` (MIT). Wraps the native
  // Metal binary on the host — no re-implementation. Feeds the ClusterManager
  // tok/s panel. Routed through the choke-point so it gets metering/audit free.
  bench_model: {
    tier: "host",
    schema: fn(
      "bench_model",
      "Benchmark a local GGUF model's generation speed (tokens/sec) with llama.cpp's llama-bench on the host. Returns structured tps for cluster telemetry.",
      {
        type: "object",
        properties: {
          model: { type: "string", description: "Absolute path to a .gguf model file (llama-bench -m)." },
          n_tokens: { type: "number", description: "Generation tokens to time (llama-bench -n). Default 128." },
        },
        required: ["model"],
      },
      {
        type: "object",
        properties: {
          tps: { type: "number", description: "Generation throughput, tokens/sec." },
          pp_tps: { type: "number", description: "Prompt-processing throughput, tokens/sec." },
          model: { type: "string" },
          runs: { type: "number" },
        },
        required: ["tps", "runs"],
      }
    ),
    invoke: async (args, { deps }) => {
      if (!args.model) throw new Error("Missing 'model' (path to .gguf).");
      const n = Number(args.n_tokens) > 0 ? Math.floor(Number(args.n_tokens)) : 128;
      const r = await deps.execOnHost(`llama-bench -m ${deps.shArg(String(args.model))} -n ${n} -o json`, 180000);
      const text = typeof r === "string" ? r : r?.output ?? "";
      if (typeof r === "object" && r && r.ok === false) {
        throw new Error(`llama-bench failed (exit ${r.exitCode}): ${String(text).slice(0, 300)}`);
      }
      return parseLlamaBench(String(text));
    },
  },
};

// Tools merged in at runtime from upstream MCP servers (consume side, Faz 1).
// Namespaced `mcp__<server>__<tool>` so they never collide with built-ins.
const DYNAMIC: Record<string, ToolDef> = {};

// Faz 24 (v1.15): per-tenant ownership of upstream tools. A dynamic tool MAY be
// owned by a tenant (explicit map — never parse the name). An owned tool is visible
// to and invokable by ONLY its owner; an ownerless tool (built-ins + global
// tools.json upstreams) is shared. Closes the cross-tenant invoke hole where
// visibility filtering alone did not gate execute().
const OWNERS = new Map<string, string>();

function get(name: string): ToolDef | undefined {
  return TOOLS[name] || DYNAMIC[name];
}

export const ToolRegistry = {
  /** OpenAI-format schemas for the ReAct loop (`tools:` param). */
  schemas(): ToolSchema[] {
    return [...Object.values(TOOLS), ...Object.values(DYNAMIC)].map((t) => t.schema);
  },

  /**
   * Tool names + tiers (for MCP expose + per-plan allowlisting). Optionally
   * tier-filtered. When `tenantId` is given, tenant-OWNED upstream tools are
   * visible ONLY to their owner; built-ins and ownerless (global) upstreams stay
   * visible to all (Faz 24 tenant isolation — explicit owner map, not name parsing).
   */
  list(tiers?: ToolTier[], tenantId?: string): { name: string; tier: ToolTier; schema: ToolSchema }[] {
    return [...Object.entries(TOOLS), ...Object.entries(DYNAMIC)]
      .filter(([, t]) => !tiers || tiers.includes(t.tier))
      .filter(([name]) => { const o = OWNERS.get(name); return !o || o === tenantId; })
      .map(([name, t]) => ({ name, tier: t.tier, schema: t.schema }));
  },

  /** Register an upstream MCP tool into the choke-point (consume side). When
   *  `owner` (a tenantId) is given, the tool is tenant-scoped (Faz 24). */
  register(name: string, def: { tier: ToolTier; schema: ToolSchema; invoke: ToolDef["invoke"] }, owner?: string): void {
    DYNAMIC[name] = def;
    if (owner) OWNERS.set(name, owner); else OWNERS.delete(name);
  },

  /** Remove dynamic tools whose name starts with `prefix` (e.g. on upstream delete). Returns count removed. */
  unregisterByPrefix(prefix: string): number {
    let n = 0;
    for (const k of Object.keys(DYNAMIC)) if (k.startsWith(prefix)) { delete DYNAMIC[k]; OWNERS.delete(k); n++; }
    return n;
  },

  has(name: string): boolean {
    return !!get(name);
  },

  tier(name: string): ToolTier | undefined {
    return get(name)?.tier;
  },

  /** Tier + schema for one tool (MCP logging severity + outputSchema, Faz 14). */
  info(name: string): { tier: ToolTier; schema: ToolSchema } | undefined {
    const t = get(name);
    return t ? { tier: t.tier, schema: t.schema } : undefined;
  },

  /**
   * THE choke-point. Every workspace tool call flows through here. Normalizes
   * output/error/diff/halt and never throws — the caller reads `ok`.
   */
  async execute(name: string, args: any, ctx: ToolCtx): Promise<ToolResult> {
    const tool = get(name);
    const start = Date.now();
    const emit = (ok: boolean) =>
      ctx.onUsage?.({ tool: name, tier: tool?.tier ?? "safe", ok, latencyMs: Date.now() - start, tenantId: ctx.tenantId });

    if (!tool) {
      emit(false);
      return { ok: false, output: { error: `Unrecognized framework tool: '${name}'` }, diff: "", applied: false, halt: false };
    }
    // Per-tenant ownership gate (Faz 24, deny-by-default). An owned upstream tool
    // is invokable ONLY by its owner — visibility filtering is not enough, the
    // choke-point must refuse a cross-tenant invoke even when the name is guessed.
    const owner = OWNERS.get(name);
    if (owner && owner !== ctx.tenantId) {
      emit(false);
      return { ok: false, output: { error: `tool_not_permitted: '${name}' belongs to another tenant` }, diff: "", applied: false, halt: false };
    }
    // Per-tenant allowlist (AGENTS.md §5). No allowlist set = single-user/full access.
    if (ctx.allowedTiers && !ctx.allowedTiers.includes(tool.tier)) {
      emit(false);
      return { ok: false, output: { error: `Tool '${name}' (tier=${tool.tier}) not permitted for this plan.` }, diff: "", applied: false, halt: false };
    }
    // OAuth scope enforcement (Faz 9B). Only when scopes are present (JWT/scoped key);
    // non-safe tools require the matching `tools:<tier>` scope.
    if (ctx.scopes && ctx.scopes.length && tool.tier !== "safe" && !ctx.scopes.includes(`tools:${tool.tier}`)) {
      emit(false);
      return { ok: false, output: { error: `insufficient_scope: '${name}' requires scope 'tools:${tool.tier}'.` }, diff: "", applied: false, halt: false };
    }

    // Cooperative cancellation (Faz 17D): bail before doing any work if already aborted.
    if (ctx.abortSignal?.aborted) {
      emit(false);
      return { ok: false, output: { error: "cancelled" }, diff: "", applied: false, halt: false };
    }

    // PRE interceptors (Faz 17A): a returned ToolResult short-circuits (e.g. cache hit).
    const preHit = runPre(name, args, ctx, tool.tier);
    if (preHit) {
      emit(true);
      return preHit;
    }

    try {
      // Race the tool against cancellation so a CancelledNotification returns promptly.
      // The underlying host call may still run to its own timeout (documented).
      const invokePromise = Promise.resolve(tool.invoke(args, ctx));
      const r = ctx.abortSignal
        ? await Promise.race([invokePromise, abortRace(ctx.abortSignal)])
        : await invokePromise;
      if (r === ABORTED) {
        emit(false);
        return { ok: false, output: { error: "cancelled" }, diff: "", applied: false, halt: false };
      }
      const normalized =
        r && typeof r === "object" && ("output" in r || "diff" in r || "halt" in r || "applied" in r)
          ? { ok: true, output: r.output, diff: r.diff || "", applied: !!r.applied, halt: !!r.halt }
          : { ok: true, output: r, diff: "", applied: false, halt: false };

      // Enforce a declared outputSchema, but ONLY for structured (object) output —
      // text-only tools (the common case) are never schema-checked. A violation is
      // returned as ok:false (never thrown), preserving the choke-point contract.
      const outSchema = tool.schema.function.outputSchema;
      const out = normalized.output;
      if (outSchema && out !== null && typeof out === "object") {
        const validate = getValidator(outSchema);
        if (validate && !validate(out)) {
          emit(false);
          return { ok: false, output: { error: "output_schema_violation", tool: name, details: validate.errors }, diff: "", applied: false, halt: false };
        }
      }
      // POST interceptors (Faz 17A): redact secrets, store cache, … in registration order.
      const finalR = runPost(name, args, ctx, tool.tier, normalized);
      emit(true);
      return finalR;
    } catch (err: any) {
      emit(false);
      return { ok: false, output: { error: err?.message || "Execution exception" }, diff: "", applied: false, halt: false };
    }
  },
};

// Sentinel + helper for the cancellation race (Faz 17D).
const ABORTED = Symbol("aborted");
function abortRace(signal: AbortSignal): Promise<typeof ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(ABORTED);
    signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
  });
}
