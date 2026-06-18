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
});
