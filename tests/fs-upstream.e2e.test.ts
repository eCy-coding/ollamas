// Multi-upstream cluster fan-out (v1.10). Proves ollamas CONSUMES more than one
// MCP upstream concurrently through the single ToolRegistry choke-point, that the
// per-upstream allowedTools allowlist gates tools, and that upstream tools land at
// the host_upstream tier. The deterministic part uses stdio fixtures (no network);
// a RUN_LIVE_E2E part connects the REAL @modelcontextprotocol/server-filesystem
// (the adopted working code wired in tools.json).
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ctx = () => ({ isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any });

describe("MCP gateway CONSUME — multi-upstream cluster fan-out", () => {
  test("two stdio upstreams coexist; allowlist filters; tier is host_upstream", async () => {
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-fanout-${process.pid}.db`);
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    const a = await connectUpstream({
      name: "local", transport: "stdio", command: "node", args: [path.join(HERE, "fixtures", "mini-mcp.mjs")],
    });
    const b = await connectUpstream({
      name: "cluster", transport: "stdio", command: "node", args: [path.join(HERE, "fixtures", "mini-cluster.mjs")],
      allowedTools: ["node_info"], // node_secret must be excluded
    });
    expect(a.ok && b.ok).toBe(true);

    // Fan-out: both upstreams' tools are reachable simultaneously.
    expect(ToolRegistry.has("mcp__local__ping")).toBe(true);
    expect(ToolRegistry.has("mcp__cluster__node_info")).toBe(true);
    // Allowlist isolation: the non-allowed tool never registers.
    expect(ToolRegistry.has("mcp__cluster__node_secret")).toBe(false);
    // Untrusted upstream tier.
    expect(ToolRegistry.tier("mcp__cluster__node_info")).toBe("host_upstream");

    const out = await ToolRegistry.execute("mcp__cluster__node_info", {}, ctx());
    expect(out.ok).toBe(true);
    expect(out.output).toBe("node-1");
  }, 30000);

  // Live: the real filesystem MCP server (Apache) via npx. Opt-in; skip if npx/net absent.
  test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
    "real @modelcontextprotocol/server-filesystem registers mcp__fs__* at host_upstream",
    async () => {
      const { connectUpstream } = await import("../server/mcp/client");
      const { ToolRegistry } = await import("../server/tool-registry");
      const r = await connectUpstream({
        name: "fs", transport: "stdio", command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", os.tmpdir()],
        allowedTools: ["read_file", "list_directory", "get_file_info"],
      });
      expect(r.ok).toBe(true);
      expect(r.tools).toBeGreaterThanOrEqual(1);
      expect(ToolRegistry.has("mcp__fs__list_directory")).toBe(true);
      expect(ToolRegistry.tier("mcp__fs__list_directory")).toBe("host_upstream");
    },
    120000,
  );
});
