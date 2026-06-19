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
  test("exposes all 22 built-in workspace tools", () => {
    expect(ToolRegistry.schemas().length).toBe(22);
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

  test("per-tenant tool visibility isolation (Faz 10A)", () => {
    const def = (n: string) => ({ tier: "host_upstream" as const, schema: { type: "function" as const, function: { name: n, description: "", parameters: { type: "object", properties: {} } } }, invoke: async () => "ok" });
    ToolRegistry.register("mcp__tnt_AAA_up__x", def("mcp__tnt_AAA_up__x"));
    ToolRegistry.register("mcp__tnt_BBB_up__y", def("mcp__tnt_BBB_up__y"));
    ToolRegistry.register("mcp__global__z", def("mcp__global__z"));
    const names = (tenantId?: string) => ToolRegistry.list(undefined, tenantId).map((t) => t.name);
    // Tenant AAA sees its own + global, not BBB's.
    expect(names("tnt_AAA")).toContain("mcp__tnt_AAA_up__x");
    expect(names("tnt_AAA")).not.toContain("mcp__tnt_BBB_up__y");
    expect(names("tnt_AAA")).toContain("mcp__global__z");
    // No tenant → tenant-scoped hidden, global visible.
    expect(names()).not.toContain("mcp__tnt_AAA_up__x");
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
});
