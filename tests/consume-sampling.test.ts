// Faz 18C: consume-side sampling provider. When MCP_SAMPLING=1, an upstream's
// sampling/createMessage is answered by ollamas' own LLM (ProviderRouter, mocked
// here). Default OFF → the capability is not advertised and the upstream's request
// fails, so the tool call errors.
import { describe, test, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generate = vi.fn(async () => ({ text: "SAMPLED-REPLY", source: "mock", modelUsed: "mock-model", latencyMs: 1 }));
vi.mock("../server/providers", () => ({ ProviderRouter: { generate } }));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "sampling-mcp.mjs");

const ctx = () => ({ isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any });

describe("consume-side sampling provider (Faz 18C)", () => {
  beforeEach(() => generate.mockClear());

  test("MCP_SAMPLING=1: upstream createMessage is answered by ProviderRouter", async () => {
    process.env.MCP_SAMPLING = "1";
    try {
      const { connectUpstream } = await import("../server/mcp/client");
      const { ToolRegistry } = await import("../server/tool-registry");
      const r = await connectUpstream({ name: "samp1", transport: "stdio", command: "node", args: [FIXTURE] });
      expect(r.ok).toBe(true);
      const out = await ToolRegistry.execute("mcp__samp1__ask", { q: "ping" }, ctx());
      expect(out.ok).toBe(true);
      expect(String(out.output)).toContain("SAMPLED-REPLY");
      expect(generate).toHaveBeenCalledOnce();
    } finally { delete process.env.MCP_SAMPLING; }
  }, 20000);

  test("default OFF: capability not advertised → upstream sampling fails the call", async () => {
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");
    const r = await connectUpstream({ name: "samp2", transport: "stdio", command: "node", args: [FIXTURE] });
    expect(r.ok).toBe(true);
    const out = await ToolRegistry.execute("mcp__samp2__ask", { q: "ping" }, ctx());
    expect(out.ok).toBe(false); // upstream's createMessage rejected (no sampling capability)
    expect(generate).not.toHaveBeenCalled();
  }, 20000);
});
