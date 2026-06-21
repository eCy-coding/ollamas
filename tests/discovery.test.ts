// Faz 15A — MCP discovery + registry manifest. Hermetic, no server boot needed:
// validates the static server.json against the registry schema's required fields
// and checks the /.well-known/mcp.json builder stays in lockstep with the live
// MCP capabilities (drift guard).
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpDiscovery } from "../server/mcp/discovery";
import { MCP_CAPABILITIES, MCP_SERVER_VERSION, MCP_SERVER_NAME } from "../server/mcp/server";
import { PROTECTED_RESOURCE_PATH, REGISTRATION_PATH } from "../server/mcp/oauth-metadata";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("server.json registry manifest (modelcontextprotocol/registry)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "server.json"), "utf8"));

  test("has the required top-level fields", () => {
    expect(typeof manifest.$schema).toBe("string");
    expect(manifest.$schema).toMatch(/server\.schema\.json$/);
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.version).toBe("string");
  });

  test("name uses reverse-DNS namespace format", () => {
    // e.g. io.github.eCy-coding/ollamas — reverse-DNS prefix (≥1 dot) + "/" + name.
    // GitHub owner segment may carry uppercase, so segments allow [A-Za-z0-9.-].
    expect(manifest.name).toMatch(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\/[A-Za-z0-9._-]+$/);
  });

  test("declares a streamable-http remote", () => {
    expect(Array.isArray(manifest.remotes)).toBe(true);
    const r = manifest.remotes[0];
    expect(r.type).toBe("streamable-http");
    expect(r.url).toMatch(/\/mcp$/);
  });

  test("manifest version tracks the single VERSION source of truth", () => {
    expect(manifest.version).toBe(MCP_SERVER_VERSION);
  });
});

describe("/.well-known/mcp.json discovery", () => {
  test("capabilities equal the live MCP server capabilities (no drift)", () => {
    const d = mcpDiscovery("https://gw.example.com");
    expect(d.capabilities).toEqual({ ...MCP_CAPABILITIES });
    expect(d.name).toBe(MCP_SERVER_NAME);
    expect(d.version).toBe(MCP_SERVER_VERSION);
  });

  test("advertises transport, auth metadata + DCR endpoint", () => {
    const base = "https://gw.example.com";
    const d = mcpDiscovery(base) as any;
    expect(d.transport).toEqual({ type: "streamable-http", endpoint: `${base}/mcp` });
    expect(d.auth.resourceMetadata).toBe(`${base}${PROTECTED_RESOURCE_PATH}`);
    expect(d.auth.registrationEndpoint).toBe(`${base}${REGISTRATION_PATH}`);
    expect(typeof d.auth.required).toBe("boolean");
  });

  test("reports a non-negative primitive count", () => {
    const d = mcpDiscovery("https://gw.example.com") as any;
    expect(d.primitives.tools).toBeGreaterThan(0);
    expect(d.primitives.prompts).toBeGreaterThanOrEqual(0);
  });

  test("trailing slash in baseUrl does not double up", () => {
    const d = mcpDiscovery("https://gw.example.com/") as any;
    expect(d.transport.endpoint).toBe("https://gw.example.com/mcp");
  });
});
