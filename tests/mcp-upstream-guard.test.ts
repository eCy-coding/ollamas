import { describe, it, expect } from "vitest";
import { connectUpstream } from "../server/mcp/client";

describe("connectUpstream stdio guard (C1 RCE defense)", () => {
  it("refuses a tenant-scoped stdio upstream (no host command spawn)", async () => {
    // A tenant must not be able to register transport:"stdio" with an arbitrary
    // command — that spawns it on the gateway host (RCE). The guard rejects BEFORE
    // building StdioClientTransport, so `true` is never spawned.
    const r = await connectUpstream(
      { name: "evil", transport: "stdio", command: "true", args: [] } as any,
      "tenant-123",
    );
    expect(r.ok).toBe(false);
    expect(r.error || "").toMatch(/stdio.*not permitted|not permitted.*stdio/i);
  });

  it("allows an explicit opt-in via ALLOW_TENANT_STDIO_UPSTREAM", async () => {
    // Escape hatch for trusted self-hosters: when explicitly enabled, the guard
    // does not block (the connect itself still fails here since `true` is not an
    // MCP server, but the error is a connect error, NOT the guard rejection).
    const prev = process.env.ALLOW_TENANT_STDIO_UPSTREAM;
    process.env.ALLOW_TENANT_STDIO_UPSTREAM = "1";
    try {
      const r = await connectUpstream(
        { name: "optin", transport: "stdio", command: "true", args: [] } as any,
        "tenant-123",
      );
      expect(r.ok).toBe(false);
      expect(r.error || "").not.toMatch(/not permitted/i);
    } finally {
      if (prev === undefined) delete process.env.ALLOW_TENANT_STDIO_UPSTREAM;
      else process.env.ALLOW_TENANT_STDIO_UPSTREAM = prev;
    }
  });
});
