// v1.8: stdio EXPOSE e2e. Drives `bin/mcp-stdio.ts` exactly as Claude Desktop /
// Cursor would — over stdio with the official MCP SDK client — proving ollamas is
// consumable as a local `npx ollamas-mcp` server through the same choke-point.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WS = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-stdio-ws-"));

beforeAll(() => {
  fs.writeFileSync(path.join(WS, "hello.txt"), "hi from stdio");
});
afterAll(() => {
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch {}
});

function connect(env: Record<string, string> = {}) {
  const c = new Client({ name: "stdio-e2e", version: "0" }, { capabilities: {} });
  const tr = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "bin/mcp-stdio.ts"],
    cwd: ROOT,
    env: { ...process.env, OLLAMAS_WORKSPACE: WS, ...env } as Record<string, string>,
  });
  return { c, tr };
}

describe("MCP stdio EXPOSE (npx ollamas-mcp)", () => {
  test("default boot exposes the 15 safe-tier tools over stdio", async () => {
    const { c, tr } = connect();
    await c.connect(tr);
    const { tools } = await c.listTools();
    await c.close();
    expect(tools.length).toBe(15); // safe tier only by default
    expect(tools.some((t) => t.name === "read_file")).toBe(true);
    expect(tools.some((t) => t.name === "git_commit")).toBe(false); // host tier excluded
  }, 40000);

  test("read_file resolves against the bound workspace (real on-disk)", async () => {
    const { c, tr } = connect();
    await c.connect(tr);
    const res: any = await c.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    await c.close();
    const text = (res.content || []).map((b: any) => b.text).join("");
    expect(text).toContain("hi from stdio");
    expect(res.isError).toBeFalsy();
  }, 40000);

  test("MCP_STDIO_TIERS widens the exposed tier set", async () => {
    const { c, tr } = connect({ MCP_STDIO_TIERS: "safe,host,privileged" });
    await c.connect(tr);
    const { tools } = await c.listTools();
    await c.close();
    expect(tools.some((t) => t.name === "git_commit")).toBe(true); // host tier now visible
    expect(tools.length).toBeGreaterThan(15);
  }, 40000);
});
