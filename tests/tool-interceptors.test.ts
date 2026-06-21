import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolRegistry, type ToolCtx, type ToolDeps, type ToolResult } from "../server/tool-registry";
import { registerInterceptor, _resetInterceptors, redactionInterceptor, cacheInterceptor, _clearCache, redactString, redactDeep } from "../server/tool-interceptors";

const deps = {
  FilesystemManager: {} as any, TerminalManager: {} as any,
  runOnHostTerminal: async () => "", writeHostFile: async () => "", execOnHost: async () => "",
  HOST_TOOLS_DIR: "/tmp", shArg: (s: string) => s, db: { logSecurity: () => {} },
} as ToolDeps;
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({ isLive: true, workspaceRoot: "/ws", autoApply: true, deps, ...over });

// Register a dynamic tool with a spied invoke; returns the spy.
function spyTool(name: string, out: any = "ok") {
  const invoke = vi.fn(async () => out);
  ToolRegistry.register(name, {
    tier: "host",
    schema: { type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} } } },
    invoke,
  });
  return invoke;
}

describe("choke-point interceptor chain (Faz 17A)", () => {
  beforeEach(() => _resetInterceptors());

  test("a pre-hook ToolResult short-circuits the call (no invoke)", async () => {
    const invoke = spyTool("ix__pre");
    const cached: ToolResult = { ok: true, output: "CACHED", diff: "", applied: false, halt: false };
    registerInterceptor({ name: "stub", pre: () => cached });
    const r = await ToolRegistry.execute("ix__pre", {}, ctx());
    expect(r.output).toBe("CACHED");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("a post-hook transforms the result in order", async () => {
    spyTool("ix__post", "raw");
    registerInterceptor({ name: "upper", post: (_t, _a, _c, _ti, r) => ({ ...r, output: String(r.output).toUpperCase() }) });
    const r = await ToolRegistry.execute("ix__post", {}, ctx());
    expect(r.output).toBe("RAW");
  });

  test("a throwing interceptor is swallowed; the tool still runs", async () => {
    const invoke = spyTool("ix__throw", "fine");
    registerInterceptor({ name: "boom", pre: () => { throw new Error("nope"); } });
    const r = await ToolRegistry.execute("ix__throw", {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe("fine");
    expect(invoke).toHaveBeenCalledOnce();
  });
});

// Secrets assembled at runtime so no literal secret string lives in this source.
const AWS_KEY = "AK" + "IA" + "IOSFODNN7EXAMPLE";
const GH_TOKEN = "gh" + "p_" + "0".repeat(36);
const GOOGLE_KEY = "AI" + "za" + "Sy" + "A".repeat(33);
const JWT = "ey" + "Jhdr0123456" + "." + "ey" + "Jwld0123456" + "." + "s1g0123456789";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";

describe("secret redaction (Faz 17B)", () => {
  beforeEach(() => { _resetInterceptors(); registerInterceptor(redactionInterceptor); delete process.env.MCP_REDACT; });

  test("redactString masks high-precision secrets", () => {
    expect(redactString(`key ${AWS_KEY} end`)).toContain("***REDACTED:aws-access-key***");
    expect(redactString(GH_TOKEN)).toContain("***REDACTED:github-token***");
    expect(redactString(`tok ${JWT} done`)).toContain("***REDACTED:jwt***");
    expect(redactString(PEM)).toBe("***REDACTED:private-key***");
  });

  test("generic key=value masks the value, keeps the field name", () => {
    expect(redactString('api_key="s3cr3tValue123"')).toBe('api_key="***REDACTED***"');
    expect(redactString("password = hunter2hunter2")).toContain("password = ***REDACTED***");
  });

  test("non-secret text is untouched", () => {
    expect(redactString("just a normal sentence with numbers 42")).toBe("just a normal sentence with numbers 42");
  });

  test("redactDeep walks nested objects/arrays, leaving keys intact", () => {
    const out = redactDeep({ note: "ok", creds: { token: GH_TOKEN }, list: [AWS_KEY] });
    expect(out.note).toBe("ok");
    expect(out.creds.token).toContain("***REDACTED:github-token***");
    expect(out.list[0]).toContain("***REDACTED:aws-access-key***");
  });

  test("choke-point masks a tool's structured output by default", async () => {
    spyTool("ix__leak", { db_url: "ok", apikey: GOOGLE_KEY });
    const r = await ToolRegistry.execute("ix__leak", {}, ctx());
    expect(r.output.apikey).toContain("***REDACTED:google-api-key***");
    expect(r.output.db_url).toBe("ok");
  });

  test("MCP_REDACT=0 disables redaction at the choke-point", async () => {
    spyTool("ix__noredact", AWS_KEY);
    process.env.MCP_REDACT = "0";
    const r = await ToolRegistry.execute("ix__noredact", {}, ctx());
    expect(r.output).toBe(AWS_KEY);
  });
});

describe("read-only result cache (Faz 17C)", () => {
  // Spyable deps for the real cacheable built-in `list_tree`.
  const mkCtx = (getTree: any, over: Partial<ToolCtx> = {}): ToolCtx => ({
    isLive: true, workspaceRoot: "/ws", autoApply: true,
    deps: { ...deps, FilesystemManager: { getTree } as any },
    ...over,
  });

  beforeEach(() => { _resetInterceptors(); registerInterceptor(cacheInterceptor); _clearCache(); });
  afterEach(() => { delete process.env.MCP_CACHE_TTL_MS; });

  test("with TTL set, a second identical read serves from cache (no re-invoke)", async () => {
    process.env.MCP_CACHE_TTL_MS = "5000";
    const getTree = vi.fn(async () => ({ tree: "T" }));
    const c = mkCtx(getTree);
    const a = await ToolRegistry.execute("list_tree", {}, c);
    const b = await ToolRegistry.execute("list_tree", {}, c);
    expect(a.output).toBe("T");
    expect(b.output).toBe("T");
    expect(getTree).toHaveBeenCalledOnce(); // 2nd call hit cache
  });

  test("default (no TTL) → caching off, every call re-invokes", async () => {
    const getTree = vi.fn(async () => ({ tree: "T" }));
    const c = mkCtx(getTree);
    await ToolRegistry.execute("list_tree", {}, c);
    await ToolRegistry.execute("list_tree", {}, c);
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  test("cache is isolated per tenant", async () => {
    process.env.MCP_CACHE_TTL_MS = "5000";
    const getTree = vi.fn(async () => ({ tree: "T" }));
    await ToolRegistry.execute("list_tree", {}, mkCtx(getTree, { tenantId: "A" }));
    await ToolRegistry.execute("list_tree", {}, mkCtx(getTree, { tenantId: "A" })); // hit
    await ToolRegistry.execute("list_tree", {}, mkCtx(getTree, { tenantId: "B" })); // miss (other tenant)
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  test("a non-cacheable tool (run_command) is never cached", async () => {
    process.env.MCP_CACHE_TTL_MS = "5000";
    const execute = vi.fn(async () => "out");
    const c: ToolCtx = { isLive: true, workspaceRoot: "/ws", autoApply: true, deps: { ...deps, TerminalManager: { execute } as any } };
    await ToolRegistry.execute("run_command", { command: "ls" }, c);
    await ToolRegistry.execute("run_command", { command: "ls" }, c);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("tool-call cancellation (Faz 17D)", () => {
  beforeEach(() => _resetInterceptors());

  test("a pre-aborted signal returns ok:false cancelled without invoking", async () => {
    const invoke = spyTool("ix__preabort");
    const ac = new AbortController();
    ac.abort();
    const r = await ToolRegistry.execute("ix__preabort", {}, ctx({ abortSignal: ac.signal }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain("cancelled");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("abort DURING a long invoke resolves promptly as cancelled", async () => {
    const ac = new AbortController();
    ToolRegistry.register("ix__longrun", {
      tier: "host",
      schema: { type: "function", function: { name: "ix__longrun", description: "d", parameters: { type: "object", properties: {} } } },
      invoke: () => new Promise(() => {}), // never resolves
    });
    const p = ToolRegistry.execute("ix__longrun", {}, ctx({ abortSignal: ac.signal }));
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain("cancelled");
  });
});
