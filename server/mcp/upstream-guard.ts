// Tenant-facing upstream validation (security-critical). POST /api/saas/upstreams
// lets any valid tenant key register an MCP upstream; for stdio transports the
// gateway then spawns `command`+`args` via StdioClientTransport. Without this
// guard a tenant (who, under SAAS_ENFORCE=1, is NOT the host owner) could set
// command="/bin/sh" args=["-c","…"] → arbitrary host command execution.
//
// Positive allowlist mirroring server/terminal.ts: only the two runtimes the
// curated catalog uses (npx, uvx), bare basename only, dangerous eval/shell
// flags denied, and the package token pinned to known MCP prefixes so an
// allowed runtime can't be turned into "run any npm package". `node` is
// deliberately excluded — `node -e` is raw code execution and nothing needs it.

import { classifyHost, type LookupFn } from "./host-guard";

export interface UpstreamConfigInput {
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
}

export interface ValidationResult { ok: boolean; error?: string }

export interface GuardOptions { lookup?: LookupFn }

// Runtimes the catalog spawns. Bare command names only — PATH resolves them.
const ALLOWED_COMMANDS = new Set(["npx", "uvx"]);

// Flags that turn an allowed runtime into an arbitrary-code/shell executor.
// `-c/--call` (npx) runs a command string; `-e/--eval/-p/--print` are node-style
// eval; `--package` pairs with `--call`. Rejected in any position.
const DANGEROUS_FLAGS = new Set(["-c", "--call", "-e", "--eval", "-p", "--print", "--package"]);

// The package spec (first non-flag arg) must name a known MCP server — closes
// the "npx -y any-evil-package" residual. Covers every catalog entry:
// @modelcontextprotocol/server-* (npx) and mcp-server-* (uvx).
const PACKAGE_PREFIXES = ["@modelcontextprotocol/", "mcp-server"];

const allowAny = (): boolean => process.env.MCP_UPSTREAM_ALLOW_ANY === "1";

async function validateHttp(url: unknown, opts: GuardOptions): Promise<ValidationResult> {
  if (typeof url !== "string" || !url) return { ok: false, error: "http transport requires a 'url'" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: "invalid url" }; }
  // Only real web transports — blocks file:/gopher:/data: (local-file / SSRF vectors).
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `url protocol not allowed: ${parsed.protocol}` };
  }
  if (allowAny()) return { ok: true }; // local operator escape hatch (also skips host check)
  // SSRF: a tenant must not point the gateway at internal hosts (metadata, loopback,
  // RFC1918). linklocal is blocked even locally; loopback/private only under SAAS_ENFORCE.
  return classifyHost(parsed.hostname, { saas: process.env.SAAS_ENFORCE === "1", lookup: opts.lookup });
}

function validateStdio(command: unknown, args: unknown): ValidationResult {
  if (typeof command !== "string" || !command) return { ok: false, error: "stdio transport requires a 'command'" };
  if (args !== undefined && (!Array.isArray(args) || !args.every((a) => typeof a === "string"))) {
    return { ok: false, error: "args must be an array of strings" };
  }
  if (allowAny()) return { ok: true }; // local power-user escape hatch (terminal.ts pattern)

  // Bare basename only — reject "/bin/sh", "./x", "../x", "/usr/bin/npx" (PATH escape / symlink-by-path).
  if (command.includes("/") || command.includes("\\")) return { ok: false, error: `command must be a bare name, got path: ${command}` };
  if (!ALLOWED_COMMANDS.has(command)) return { ok: false, error: `command not allowed: ${command} (allowed: ${[...ALLOWED_COMMANDS].join(", ")})` };

  const argList = (args as string[] | undefined) ?? [];
  for (const a of argList) {
    if (DANGEROUS_FLAGS.has(a)) return { ok: false, error: `disallowed flag: ${a}` };
  }
  // First non-flag token is the package spec; pin it to a known MCP prefix.
  const pkg = argList.find((a) => !a.startsWith("-"));
  if (!pkg) return { ok: false, error: "no package specified" };
  if (!PACKAGE_PREFIXES.some((p) => pkg.startsWith(p))) {
    return { ok: false, error: `package not allowed: ${pkg} (must start with ${PACKAGE_PREFIXES.join(" or ")})` };
  }
  return { ok: true };
}

/** Validate a tenant-supplied upstream config before it is persisted or spawned.
 *  Async because http URLs are DNS-resolved for SSRF classification. */
export async function validateUpstreamConfig(cfg: UpstreamConfigInput, opts: GuardOptions = {}): Promise<ValidationResult> {
  if (cfg.transport !== "stdio" && cfg.transport !== "http") {
    return { ok: false, error: `transport must be 'stdio' or 'http', got: ${String(cfg.transport)}` };
  }
  return cfg.transport === "http" ? validateHttp(cfg.url, opts) : validateStdio(cfg.command, cfg.args);
}
