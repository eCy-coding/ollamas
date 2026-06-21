// v1.12 expose-side federated roots. After ollamas connects to an upstream MCP
// server, it fetches the upstream's roots (roots/list) and aggregates them under
// getFederatedRoots(), namespaced "<server>:<name>". The expose-side /mcp server
// merges these with our own workspace root. Best-effort: an upstream that does not
// serve roots/list contributes [] (never throws).
import { describe, test, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS_SERVER = path.join(HERE, "fixtures", "roots-server-mcp.mjs");
const PLAIN = path.join(HERE, "fixtures", "mini-mcp.mjs"); // serves tools, no roots/list

describe("expose-side federated roots (v1.12)", () => {
  test("a roots-serving upstream is aggregated, namespaced <server>:<name>", async () => {
    const { connectUpstream, getFederatedRoots } = await import("../server/mcp/client");
    const r = await connectUpstream({ name: "up1", transport: "stdio", command: "node", args: [ROOTS_SERVER] });
    expect(r.ok).toBe(true);

    const fed = getFederatedRoots();
    expect(fed).toContainEqual({ uri: "file:///upstream/ws", name: "up1:upstream-root" });
  }, 20000);

  test("an upstream without roots/list contributes nothing (graceful, never throws)", async () => {
    const { connectUpstream, getFederatedRoots } = await import("../server/mcp/client");
    const r = await connectUpstream({ name: "plain1", transport: "stdio", command: "node", args: [PLAIN] });
    expect(r.ok).toBe(true);

    // No throw, and this upstream adds no roots (only up1's, if that test ran first).
    const fed = getFederatedRoots();
    expect(fed.some((x) => x.name.startsWith("plain1:"))).toBe(false);
  }, 20000);
});
