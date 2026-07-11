import { describe, test, expect, vi } from "vitest";
import { ToolRegistry, type ToolCtx, type ToolDeps } from "../server/tool-registry";

// Minimal deps; only the fields a given tool touches need real behavior.
function mkDeps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    FilesystemManager: {
      readFile: () => { throw new Error("no file"); },
      writeFile: vi.fn(),
      generateUnifiedDiff: () => "--- DIFF ---",
      getTree: async () => ({ tree: "root/" }),
    } as any,
    TerminalManager: { execute: async () => "ok" } as any,
    runOnHostTerminal: async () => "term",
    writeHostFile: async () => "wrote",
    execOnHost: async () => "exec",
    HOST_TOOLS_DIR: "/tmp/tools",
    shArg: (s) => `'${s}'`,
    db: { logSecurity: vi.fn() },
    ...over,
  };
}
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({ isLive: true, workspaceRoot: "/ws", autoApply: false, deps: mkDeps(), ...over });

describe("ToolRegistry choke-point", () => {
  test("exposes all 36 built-in workspace tools", () => {
    expect(ToolRegistry.schemas().length).toBe(36); // +bench_model(v1.8) +mac_power(v1.9) +eval_prompt(v1.12) +rag_index/rag_search(v1.13) +count_tokens(graft) +upload_file/download_file(updown) +test_generate/code_audit/storefront_generate(revenue-ops Faz19) +contract_admin(contract vK2) +deep_research(O2 Faz7)
  });

  test("unknown tool → ok:false, not a throw", async () => {
    const r = await ToolRegistry.execute("does_not_exist", {}, ctx());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain("Unrecognized");
  });

  test("tier allowlist blocks privileged tool for a safe-only plan", async () => {
    const r = await ToolRegistry.execute("macos_terminal", { command: "ls" }, ctx({ allowedTiers: ["safe"] }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain("not permitted");
  });

  test("safe tool runs when allowlist permits it", async () => {
    const r = await ToolRegistry.execute("list_tree", {}, ctx({ allowedTiers: ["safe"] }));
    expect(r.ok).toBe(true);
    expect(r.output).toBe("root/");
  });

  test("write_file with autoApply=false halts and returns a diff", async () => {
    const r = await ToolRegistry.execute("write_file", { path: "a.txt", content: "x" }, ctx({ autoApply: false }));
    expect(r.ok).toBe(true);
    expect(r.halt).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.diff).toContain("DIFF");
  });

  test("write_file with autoApply=true applies and does not halt", async () => {
    const r = await ToolRegistry.execute("write_file", { path: "a.txt", content: "x" }, ctx({ autoApply: true }));
    expect(r.applied).toBe(true);
    expect(r.halt).toBe(false);
  });

  // --- Faz 18B: elicitation replaces the halt path when the client supports it ---
  test("write_file elicits approval → accept applies (no halt)", async () => {
    const writeFile = vi.fn();
    const deps = mkDeps({ FilesystemManager: { readFile: () => { throw new Error("nf"); }, writeFile, generateUnifiedDiff: () => "D", getTree: async () => ({ tree: "" }) } as any });
    const onElicit = vi.fn(async () => ({ action: "accept" as const, content: { approve: true } }));
    const r = await ToolRegistry.execute("write_file", { path: "a.txt", content: "x" }, { isLive: true, workspaceRoot: "/ws", autoApply: false, deps, onElicit });
    expect(onElicit).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledOnce();
    expect(r.applied).toBe(true);
    expect(r.halt).toBe(false);
  });

  test("write_file elicits approval → decline does not write (no halt)", async () => {
    const writeFile = vi.fn();
    const deps = mkDeps({ FilesystemManager: { readFile: () => { throw new Error("nf"); }, writeFile, generateUnifiedDiff: () => "D", getTree: async () => ({ tree: "" }) } as any });
    const onElicit = vi.fn(async () => ({ action: "decline" as const }));
    const r = await ToolRegistry.execute("write_file", { path: "a.txt", content: "x" }, { isLive: true, workspaceRoot: "/ws", autoApply: false, deps, onElicit });
    expect(writeFile).not.toHaveBeenCalled();
    expect(r.applied).toBe(false);
    expect(r.halt).toBe(false);
    expect(String(r.output)).toContain("declined");
  });

  test("write_file without elicitation capability falls back to halt", async () => {
    const r = await ToolRegistry.execute("write_file", { path: "a.txt", content: "x" }, ctx({ autoApply: false }));
    expect(r.halt).toBe(true); // unchanged legacy behavior
  });

  test("onUsage fires with tool/tier/ok/latency", async () => {
    const seen: any[] = [];
    await ToolRegistry.execute("list_tree", {}, ctx({ onUsage: (e) => seen.push(e) }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ tool: "list_tree", tier: "safe", ok: true });
    expect(typeof seen[0].latencyMs).toBe("number");
  });

  test("scope enforcement: non-safe tool needs tools:<tier> scope (Faz 9B)", async () => {
    const denied = await ToolRegistry.execute("macos_terminal", { command: "ls" }, ctx({ scopes: ["tools:safe"] }));
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied.output)).toContain("insufficient_scope");
    const allowed = await ToolRegistry.execute("macos_terminal", { command: "ls" }, ctx({ scopes: ["tools:privileged"] }));
    expect(allowed.ok).toBe(true);
  });

  test("empty scopes → no scope restriction (backward compatible)", async () => {
    const r = await ToolRegistry.execute("macos_terminal", { command: "ls" }, ctx({ scopes: [] }));
    expect(r.ok).toBe(true);
  });

  test("per-tenant tool visibility isolation (Faz 24 owner-gate)", () => {
    const def = (n: string) => ({ tier: "host_upstream" as const, schema: { type: "function" as const, function: { name: n, description: "", parameters: { type: "object", properties: {} } } }, invoke: async () => "ok" });
    ToolRegistry.register("mcp__AAA_up__x", def("mcp__AAA_up__x"), "AAA"); // owned by AAA
    ToolRegistry.register("mcp__BBB_up__y", def("mcp__BBB_up__y"), "BBB"); // owned by BBB
    ToolRegistry.register("mcp__global__z", def("mcp__global__z"));        // ownerless (shared)
    const names = (tenantId?: string) => ToolRegistry.list(undefined, tenantId).map((t) => t.name);
    // Tenant AAA sees its own + global, not BBB's (ownership, not name parsing).
    expect(names("AAA")).toContain("mcp__AAA_up__x");
    expect(names("AAA")).not.toContain("mcp__BBB_up__y");
    expect(names("AAA")).toContain("mcp__global__z");
    // No tenant → owned tools hidden, global visible.
    expect(names()).not.toContain("mcp__AAA_up__x");
    expect(names()).toContain("mcp__global__z");
  });

  test("register() merges a dynamic (consume) tool reachable via execute", async () => {
    ToolRegistry.register("mcp__x__ping", {
      tier: "host",
      schema: { type: "function", function: { name: "mcp__x__ping", description: "p", parameters: { type: "object", properties: {} } } },
      invoke: async () => "pong",
    });
    expect(ToolRegistry.has("mcp__x__ping")).toBe(true);
    const r = await ToolRegistry.execute("mcp__x__ping", {}, ctx());
    expect(r.output).toBe("pong");
  });

  // --- v1.7-A: outputSchema enforcement at the choke-point ---
  const withOut = (name: string, out: any, outputSchema: any) =>
    ToolRegistry.register(name, {
      tier: "host",
      schema: { type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} }, outputSchema } },
      invoke: async () => out,
    });

  test("structured output matching its outputSchema passes through", async () => {
    withOut("mcp__os__good", { score: 9, ok: true },
      { type: "object", properties: { score: { type: "number" }, ok: { type: "boolean" } }, required: ["score", "ok"] });
    const r = await ToolRegistry.execute("mcp__os__good", {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ score: 9, ok: true });
  });

  test("structured output violating its outputSchema → ok:false (not a throw)", async () => {
    withOut("mcp__os__bad", { score: "nine" },
      { type: "object", properties: { score: { type: "number" } }, required: ["score"] });
    const r = await ToolRegistry.execute("mcp__os__bad", {}, ctx());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain("output_schema_violation");
  });

  test("string output is never schema-checked (text-only tools unaffected)", async () => {
    withOut("mcp__os__str", "plain text",
      { type: "object", properties: { x: { type: "number" } }, required: ["x"] });
    const r = await ToolRegistry.execute("mcp__os__str", {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe("plain text");
  });

  test("a malformed outputSchema is ignored, not fatal", async () => {
    withOut("mcp__os__badschema", { a: 1 }, { type: "not-a-real-type", properties: 42 });
    const r = await ToolRegistry.execute("mcp__os__badschema", {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ a: 1 });
  });

  // Faz 20B: abort-to-host. A long-running host tool must forward ctx.abortSignal
  // into its host helper so an MCP CancelledNotification severs the real fetch.
  describe("abort-to-host (Faz 20B)", () => {
    test("run_tests forwards ctx.abortSignal to execOnHost (3rd arg)", async () => {
      const execOnHost = vi.fn(async (..._a: any[]) => "exec");
      const ac = new AbortController();
      await ToolRegistry.execute("run_tests", {}, ctx({ deps: mkDeps({ execOnHost }), abortSignal: ac.signal }));
      expect(execOnHost).toHaveBeenCalledTimes(1);
      expect(execOnHost.mock.calls[0][2]).toBe(ac.signal);
    });

    test("macos_terminal forwards ctx.abortSignal to runOnHostTerminal (4th arg)", async () => {
      const runOnHostTerminal = vi.fn(async (..._a: any[]) => "term");
      const ac = new AbortController();
      await ToolRegistry.execute("macos_terminal", { command: "ls" }, ctx({ deps: mkDeps({ runOnHostTerminal }), abortSignal: ac.signal }));
      expect(runOnHostTerminal).toHaveBeenCalledTimes(1);
      expect(runOnHostTerminal.mock.calls[0][3]).toBe(ac.signal);
    });

    test("write_host_file forwards ctx.abortSignal to writeHostFile (3rd arg)", async () => {
      const writeHostFile = vi.fn(async (..._a: any[]) => "wrote");
      const ac = new AbortController();
      await ToolRegistry.execute("write_host_file", { path: "/tmp/x", content: "y" }, ctx({ deps: mkDeps({ writeHostFile }), abortSignal: ac.signal }));
      expect(writeHostFile).toHaveBeenCalledTimes(1);
      expect(writeHostFile.mock.calls[0][2]).toBe(ac.signal);
    });

    test("combineSignal: an already-aborted signal aborts the combined signal", async () => {
      const { combineSignalForTest } = await import("../server/host-bridge");
      const ac = new AbortController();
      ac.abort();
      expect(combineSignalForTest(ac.signal, 60000).aborted).toBe(true);
    });
  });
});
