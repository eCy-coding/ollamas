// Faz 24 (v1.15) — per-tenant upstream tool isolation. A tenant-OWNED upstream tool
// must be invisible to and un-invokable by any other tenant (deny-by-default at the
// choke-point), while ownerless (global tools.json) upstreams stay shared. Closes
// the cross-tenant invoke hole (visibility filtering alone did not gate execute()).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINI = path.join(HERE, "fixtures", "mini-mcp.mjs");

const ctx = (tenantId?: string) => ({ isLive: true, workspaceRoot: "/ws", autoApply: true, deps: {} as any, tenantId });

// This suite uses a trusted local stdio fixture (mini-mcp.mjs) as a tenant upstream
// to exercise isolation logic. The RCE guard blocks tenant-scoped stdio by default,
// so — acting as the trusted self-hoster — opt in for the duration of the suite.
let prevStdioOptIn: string | undefined;
beforeAll(() => { prevStdioOptIn = process.env.ALLOW_TENANT_STDIO_UPSTREAM; process.env.ALLOW_TENANT_STDIO_UPSTREAM = "1"; });
afterAll(() => { if (prevStdioOptIn === undefined) delete process.env.ALLOW_TENANT_STDIO_UPSTREAM; else process.env.ALLOW_TENANT_STDIO_UPSTREAM = prevStdioOptIn; });

describe("per-tenant upstream tool isolation (Faz 24)", () => {
  test("owned tool is visible to its owner only; cross-tenant invoke is denied", async () => {
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    // tenantA owns this upstream; tenantB owns a separate one; one global ownerless.
    expect((await connectUpstream({ name: "tenantA_mini", transport: "stdio", command: "node", args: [MINI] }, "tenantA")).ok).toBe(true);
    expect((await connectUpstream({ name: "shared", transport: "stdio", command: "node", args: [MINI] })).ok).toBe(true); // ownerless

    const ownedName = "mcp__tenantA_mini__ping";
    const globalName = "mcp__shared__ping";

    // Visibility: owner sees owned; other tenant does not. Global visible to both.
    const aNames = ToolRegistry.list(undefined, "tenantA").map((t) => t.name);
    const bNames = ToolRegistry.list(undefined, "tenantB").map((t) => t.name);
    expect(aNames).toContain(ownedName);
    expect(bNames).not.toContain(ownedName);
    expect(aNames).toContain(globalName);
    expect(bNames).toContain(globalName);

    // Access control: only the owner may invoke the owned tool.
    const denied = await ToolRegistry.execute(ownedName, {}, ctx("tenantB"));
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied.output)).toContain("tool_not_permitted");

    const allowed = await ToolRegistry.execute(ownedName, {}, ctx("tenantA"));
    expect(allowed.ok).toBe(true);
    expect(String(allowed.output)).toContain("pong");

    // Ownerless global tool is invokable by any tenant.
    const globalOk = await ToolRegistry.execute(globalName, {}, ctx("tenantB"));
    expect(globalOk.ok).toBe(true);
  }, 30000);

  test("unregisterByPrefix clears ownership (no leak on reconnect)", async () => {
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    await connectUpstream({ name: "tenantC_mini", transport: "stdio", command: "node", args: [MINI] }, "tenantC");
    const name = "mcp__tenantC_mini__ping";
    expect(ToolRegistry.list(undefined, "tenantC").map((t) => t.name)).toContain(name);

    ToolRegistry.unregisterByPrefix("mcp__tenantC_mini__");
    expect(ToolRegistry.list(undefined, "tenantC").map((t) => t.name)).not.toContain(name);

    // Re-register ownerless → now shared (ownership did not leak from before).
    await connectUpstream({ name: "tenantC_mini", transport: "stdio", command: "node", args: [MINI] });
    expect(ToolRegistry.list(undefined, "tenantX").map((t) => t.name)).toContain(name);
  }, 30000);
});
