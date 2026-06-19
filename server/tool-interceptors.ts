// Choke-point interceptor chain (v1.8 / Faz 17). A small, ordered pre/post
// middleware layer that ToolRegistry.execute() runs around every tool call —
// adopting the gateway interceptor pattern (docker/mcp-gateway --block-secrets,
// IBM mcp-context-forge). One framework, so security/perf concerns (secret
// redaction, read-only result caching, …) plug in WITHOUT re-editing the
// choke-point each time (AGENTS.md §4: still one dispatch path).
//
// Contract: interceptors NEVER throw out — a throwing interceptor is skipped and
// logged, the tool call proceeds. `pre` may short-circuit (return a ToolResult,
// e.g. a cache hit); `post` transforms the result in registration order.
import { LRUCache } from "lru-cache";
import crypto from "node:crypto";
import type { ToolCtx, ToolResult, ToolTier } from "./tool-registry";

export interface ToolInterceptor {
  name: string;
  /** Runs before tool.invoke. Return a ToolResult to short-circuit (e.g. cache hit). */
  pre?(tool: string, args: any, ctx: ToolCtx, tier: ToolTier): ToolResult | undefined;
  /** Runs after a successful invoke (post-validation). Transform + return the result. */
  post?(tool: string, args: any, ctx: ToolCtx, tier: ToolTier, r: ToolResult): ToolResult;
}

const registry: ToolInterceptor[] = [];

export function registerInterceptor(i: ToolInterceptor): void { registry.push(i); }
/** Test helper — reset the chain to a known state. */
export function _resetInterceptors(): void { registry.length = 0; }
export function interceptorNames(): string[] { return registry.map((i) => i.name); }

/** Run pre-hooks in order; first ToolResult short-circuits the call. */
export function runPre(tool: string, args: any, ctx: ToolCtx, tier: ToolTier): ToolResult | undefined {
  for (const i of registry) {
    if (!i.pre) continue;
    try {
      const hit = i.pre(tool, args, ctx, tier);
      if (hit) return hit;
    } catch (e: any) {
      console.warn(`[interceptor:${i.name}] pre failed (${e?.message}) — skipping.`);
    }
  }
  return undefined;
}

/** Run post-hooks in registration order, threading the result through each. */
export function runPost(tool: string, args: any, ctx: ToolCtx, tier: ToolTier, r: ToolResult): ToolResult {
  let cur = r;
  for (const i of registry) {
    if (!i.post) continue;
    try {
      cur = i.post(tool, args, ctx, tier, cur);
    } catch (e: any) {
      console.warn(`[interceptor:${i.name}] post failed (${e?.message}) — skipping.`);
    }
  }
  return cur;
}

// ───────────────────────── Faz 17B: secret redaction ─────────────────────────
// High-precision secret patterns adopted (as DATA) from the gitleaks and
// secretlint rule sets (both MIT). Kept high-precision to avoid masking benign
// text; the generic key=value rule masks only the VALUE, keeping the field name.
const SECRET_RULES: { name: string; re: RegExp }[] = [
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g },
  { name: "github-pat", re: /\bgithub_pat_[0-9A-Za-z_]{22,}\b/g },
  { name: "gitlab-pat", re: /\bglpat-[0-9A-Za-z_-]{20}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "stripe-secret", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
];
// Generic `key = value` / `key: value` secret assignment (masks the value only).
const ASSIGN_RE = /\b(api[_-]?key|apikey|secret|password|passwd|token|authorization|access[_-]?token)(\s*[:=]\s*)(['"]?)([A-Za-z0-9._\-+/]{8,})(\3)/gi;

/** Mask known secrets inside a single string. */
export function redactString(s: string): string {
  if (!s) return s;
  let out = s;
  for (const { name, re } of SECRET_RULES) out = out.replace(re, `***REDACTED:${name}***`);
  out = out.replace(ASSIGN_RE, (_m, k, sep, q, _v, q2) => `${k}${sep}${q}***REDACTED***${q2}`);
  return out;
}

/** Recursively mask secrets in any tool output (string | array | object). Keys
 *  are left intact; only string VALUES are scanned. */
export function redactDeep(v: any): any {
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) o[k] = redactDeep(val);
    return o;
  }
  return v;
}

// Default ON; disable per-deployment with MCP_REDACT=0 (read at call time so it
// can be toggled without re-importing). Applies to BOTH structured output and the
// write_file diff, covering built-in and untrusted-upstream tool output alike.
export const redactionInterceptor: ToolInterceptor = {
  name: "redact",
  post(_tool, _args, _ctx, _tier, r) {
    if (process.env.MCP_REDACT === "0") return r;
    return { ...r, output: redactDeep(r.output), diff: r.diff ? redactString(r.diff) : r.diff };
  },
};

// ───────────────────────── Faz 17C: read-only result cache ─────────────────────────
// Opt-in (MCP_CACHE_TTL_MS>0) LRU cache for PURE-READ tools only — never for
// tools with side effects (write_file, run_command, web_search, logbook). Keyed
// per tenant so tenants never share cached output. Adopts `lru-cache` (MIT).
const CACHEABLE = new Set([
  "list_tree", "read_file", "grep_search", "git_ops",
  "process_port", "health_probe", "log_stream", "lint_format", "tools_doctor", "shell_check",
]);

let _cache: LRUCache<string, ToolResult> | null = null;
function cache(): LRUCache<string, ToolResult> {
  if (!_cache) _cache = new LRUCache<string, ToolResult>({ max: Number(process.env.MCP_CACHE_MAX) || 500 });
  return _cache;
}
function cacheTtl(): number { const n = Number(process.env.MCP_CACHE_TTL_MS); return Number.isFinite(n) && n > 0 ? n : 0; }
function cacheKey(tool: string, args: any, ctx: ToolCtx): string {
  const h = crypto.createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
  return `${ctx.tenantId || "_"}:${tool}:${h}`;
}
const clone = (r: ToolResult): ToolResult => structuredClone(r);

export const cacheInterceptor: ToolInterceptor = {
  name: "cache",
  pre(tool, args, ctx) {
    if (!cacheTtl() || !CACHEABLE.has(tool)) return undefined;
    const hit = cache().get(cacheKey(tool, args, ctx));
    return hit ? clone(hit) : undefined;
  },
  post(tool, args, ctx, _tier, r) {
    if (!cacheTtl() || !CACHEABLE.has(tool)) return r;
    if (r.ok && !r.halt && !r.applied) cache().set(cacheKey(tool, args, ctx), clone(r), { ttl: cacheTtl() });
    return r;
  },
};

/** Test helper — drop all cached entries. */
export function _clearCache(): void { _cache?.clear(); }

// ───────────────────────── built-in registration ─────────────────────────
// Order matters: redaction runs (and stores into cache, Faz 17C) BEFORE caching,
// so a cache hit serves already-redacted output. Both are gated at call time
// (MCP_REDACT / MCP_CACHE_TTL_MS) — registering them is always safe.
registerInterceptor(redactionInterceptor);
registerInterceptor(cacheInterceptor);
