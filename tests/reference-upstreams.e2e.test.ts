// Reference-server fan-out (v1.11). Proves ollamas consumes 3+ MCP upstreams
// concurrently through the single choke-point with per-upstream allowlists and
// host_upstream tiering — the config wired into tools.json (memory, thinking,
// everything) modeled deterministically with stdio fixtures (no network). A
// RUN_LIVE_E2E part connects the real @modelcontextprotocol/server-everything.
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fix = (f: string) => path.join(HERE, "fixtures", f);
const ctx = () => ({ isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any });

describe("MCP gateway CONSUME — reference-server fan-out (3+ upstreams)", () => {
  test("three stdio upstreams coexist; allowlists filter; all host_upstream", async () => {
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-ref-${process.pid}.db`);
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    const results = await Promise.all([
      connectUpstream({ name: "local", transport: "stdio", command: "node", args: [fix("mini-mcp.mjs")] }),
      connectUpstream({ name: "cluster", transport: "stdio", command: "node", args: [fix("mini-cluster.mjs")], allowedTools: ["node_info"] }),
      connectUpstream({ name: "memory", transport: "stdio", command: "node", args: [fix("mini-memory.mjs")], allowedTools: ["read_graph"] }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);

    // Fan-out: all three upstreams' allowed tools are reachable at once.
    expect(ToolRegistry.has("mcp__local__ping")).toBe(true);
    expect(ToolRegistry.has("mcp__cluster__node_info")).toBe(true);
    expect(ToolRegistry.has("mcp__memory__read_graph")).toBe(true);
    // Allowlist isolation across upstreams.
    expect(ToolRegistry.has("mcp__cluster__node_secret")).toBe(false);
    expect(ToolRegistry.has("mcp__memory__wipe_all")).toBe(false);
    // Every upstream tool is untrusted-tiered.
    for (const n of ["mcp__local__ping", "mcp__cluster__node_info", "mcp__memory__read_graph"]) {
      expect(ToolRegistry.tier(n)).toBe("host_upstream");
    }

    const out = await ToolRegistry.execute("mcp__memory__read_graph", {}, ctx());
    expect(out.ok).toBe(true);
    expect(String(out.output)).toContain("nodes");
  }, 30000);

  // Live: real @modelcontextprotocol/server-everything (canonical test server, no FS writes).
  test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
    "real server-everything registers mcp__everything__echo at host_upstream",
    async () => {
      const { connectUpstream } = await import("../server/mcp/client");
      const { ToolRegistry } = await import("../server/tool-registry");
      const r = await connectUpstream({
        name: "everything", transport: "stdio", command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        allowedTools: ["echo", "add"],
      });
      expect(r.ok).toBe(true);
      expect(ToolRegistry.has("mcp__everything__echo")).toBe(true);
      expect(ToolRegistry.tier("mcp__everything__echo")).toBe("host_upstream");
    },
    120000,
  );
});
