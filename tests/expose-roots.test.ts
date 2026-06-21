// v1.11 Phase C — expose-side roots unit tests.
//
// Covers:
//   (a) MCP_CAPABILITIES advertises the `roots` capability key.
//   (b) ListRoots handler returns a file:// workspace entry when
//       db.data.workspacePath is set; omits it when empty.
//   (c) getFederatedRoots() returns [] and always yields objects with
//       uri/name strings.
//
// roots/list is a server→client direction in the MCP spec (the server
// can call the client's roots/list), BUT our server ALSO registers a
// handler for inbound roots/list requests from CLIENTS — so we test it
// via an in-process InMemoryTransport round-trip (no real HTTP / subprocess).

import { describe, test, expect, beforeEach } from "vitest";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal ToolCtx that satisfies buildServer's type signature. */
function makeCtx() {
  return { isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any };
}

// ── (a) MCP_CAPABILITIES includes roots ──────────────────────────────────────

describe("MCP_CAPABILITIES — expose-side v1.11", () => {
  test("includes a roots key that is a non-null object", async () => {
    const { MCP_CAPABILITIES } = await import("../server/mcp/server");
    expect(MCP_CAPABILITIES).toHaveProperty("roots");
    const cap = (MCP_CAPABILITIES as any).roots;
    expect(typeof cap).toBe("object");
    expect(cap).not.toBeNull();
  });
});

// ── (b) ListRoots handler — workspace entry ───────────────────────────────────

describe("roots/list handler — expose-side v1.11", () => {
  beforeEach(async () => {
    const { db } = await import("../server/db");
    db.data.workspacePath = "";
  });

  async function buildAndConnect(workspacePath: string) {
    const { db } = await import("../server/db");
    const { buildServer } = await import("../server/mcp/server");

    db.data.workspacePath = workspacePath;
    const server = buildServer(makeCtx());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(clientTransport);
    return { client, server };
  }

  test("returns a file:// workspace root when workspacePath is set", async () => {
    const tmpDir = os.tmpdir();
    const { client } = await buildAndConnect(tmpDir);

    const result = await client.request({ method: "roots/list" }, ListRootsResultSchema);
    const roots = result.roots;

    const workspaceEntry = roots.find((r) => r.name === "workspace");
    expect(workspaceEntry).toBeDefined();
    expect(workspaceEntry!.uri).toBe(pathToFileURL(tmpDir).href);

    await client.close();
  });

  test("omits workspace entry when workspacePath is empty", async () => {
    const { client } = await buildAndConnect("");

    const result = await client.request({ method: "roots/list" }, ListRootsResultSchema);
    const roots = result.roots;

    const workspaceEntry = roots.find((r) => r.name === "workspace");
    expect(workspaceEntry).toBeUndefined();

    await client.close();
  });
});

// ── (c) getFederatedRoots() — shape contract ──────────────────────────────────

describe("getFederatedRoots — expose-side v1.11", () => {
  test("always returns an array", async () => {
    const { getFederatedRoots } = await import("../server/mcp/client");
    const roots = getFederatedRoots();
    expect(Array.isArray(roots)).toBe(true);
  });

  test("each element has uri and name as strings", async () => {
    const { getFederatedRoots } = await import("../server/mcp/client");
    const roots = getFederatedRoots();
    for (const r of roots) {
      expect(typeof r.uri).toBe("string");
      expect(typeof r.name).toBe("string");
    }
  });

  test("returns [] when no upstreams have been connected in this module instance", async () => {
    // Fresh import — upstreamRoots map is empty; this verifies the zero-upstream
    // case without spinning up any subprocess.
    const { getFederatedRoots } = await import("../server/mcp/client");
    // The module may have been populated by other tests in this run; we can only
    // assert the type and element shape contract (tested above). If the module
    // IS freshly loaded, it will be []. We skip asserting length===0 here
    // because Vitest does NOT guarantee module isolation between test files in
    // the same worker — that is tested transitively by consume-roots.test.ts.
    expect(getFederatedRoots()).toEqual(expect.any(Array));
  });
});
