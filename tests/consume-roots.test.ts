// Faz 20A: consume-side roots. ollamas (as an MCP CLIENT to an upstream) advertises
// the `roots` capability and answers the upstream's `roots/list` with its workspace
// root. A well-behaved upstream can thus scope its operations to our workspace.
import { describe, test, expect } from "vitest";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "roots-mcp.mjs");

const ctx = () => ({ isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any });

describe("consume-side roots (Faz 20A)", () => {
  test("upstream roots/list receives our workspace file:// root", async () => {
    const { db } = await import("../server/db");
    const WS = path.join(HERE, "fixtures"); // any real directory
    db.data.workspacePath = WS;
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    const r = await connectUpstream({ name: "root1", transport: "stdio", command: "node", args: [FIXTURE] });
    expect(r.ok).toBe(true);

    const out = await ToolRegistry.execute("mcp__root1__whereami", {}, ctx());
    expect(out.ok).toBe(true);
    expect(String(out.output)).toBe(pathToFileURL(WS).href);
  }, 20000);

  test("no workspace set → upstream gets an empty roots list", async () => {
    const { db } = await import("../server/db");
    db.data.workspacePath = "";
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    const r = await connectUpstream({ name: "root2", transport: "stdio", command: "node", args: [FIXTURE] });
    expect(r.ok).toBe(true);

    const out = await ToolRegistry.execute("mcp__root2__whereami", {}, ctx());
    expect(out.ok).toBe(true);
    expect(String(out.output)).toBe("(no roots)");
  }, 20000);
});
