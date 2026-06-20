import { describe, it, expect } from "vitest";
import {
  rpcEnvelope, parseRpcResponse, toolDanger, globMatch, filterByGuard,
  formatToolSignature, coerceArg, argsFromPairs, renderToolResult, type McpTool,
} from "../cli/lib/mcp";
import { GatewayClient } from "../cli/lib/client";

const noColor = { color: false, json: false };

describe("rpcEnvelope", () => {
  it("builds a JSON-RPC 2.0 request", () => {
    expect(rpcEnvelope(7, "tools/list", { cursor: "c" })).toEqual({
      jsonrpc: "2.0", id: 7, method: "tools/list", params: { cursor: "c" },
    });
  });
});

describe("parseRpcResponse", () => {
  it("parses an SSE-framed result (Streamable HTTP)", () => {
    const body = 'event: message\ndata: {"result":{"tools":[]},"jsonrpc":"2.0","id":1}\n\n';
    expect(parseRpcResponse(body)).toEqual({ result: { tools: [] }, jsonrpc: "2.0", id: 1 });
  });
  it("parses a bare JSON body", () => {
    expect(parseRpcResponse('{"result":{"ok":true},"id":2}')).toEqual({ result: { ok: true }, id: 2 });
  });
  it("returns the error envelope when present", () => {
    const body = 'data: {"error":{"code":-32601,"message":"boom"},"id":3}\n\n';
    expect(parseRpcResponse(body).error.message).toBe("boom");
  });
  it("throws on an empty response", () => {
    expect(() => parseRpcResponse("   ")).toThrow();
  });
});

describe("toolDanger (HIL gate signal)", () => {
  it("flags destructive or open-world tools", () => {
    expect(toolDanger({ name: "x", annotations: { destructiveHint: true } })).toBe(true);
    expect(toolDanger({ name: "x", annotations: { openWorldHint: true } })).toBe(true);
    expect(toolDanger({ name: "x", annotations: { readOnlyHint: true } })).toBe(false);
    expect(toolDanger({ name: "x" })).toBe(false);
  });
});

describe("globMatch + filterByGuard (mcptools guard)", () => {
  it("matches only * as wildcard, anchored", () => {
    expect(globMatch("git_*", "git_commit")).toBe(true);
    expect(globMatch("git_*", "run_command")).toBe(false);
    expect(globMatch("read_file", "read_file")).toBe(true);
    expect(globMatch("read_file", "read_files")).toBe(false);
  });
  it("allow is a whitelist; deny always removes", () => {
    const tools = [{ name: "read_file" }, { name: "write_file" }, { name: "git_commit" }];
    expect(filterByGuard(tools, ["read_*", "git_*"], []).map((t) => t.name)).toEqual(["read_file", "git_commit"]);
    expect(filterByGuard(tools, [], ["*_file"]).map((t) => t.name)).toEqual(["git_commit"]);
    expect(filterByGuard(tools, ["*"], ["git_*"]).map((t) => t.name)).toEqual(["read_file", "write_file"]);
  });
});

describe("formatToolSignature", () => {
  it("renders required and [optional] params", () => {
    const tool: McpTool = {
      name: "read_file",
      inputSchema: { properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path"] },
    };
    const sig = formatToolSignature(tool, noColor);
    expect(sig).toBe("read_file(path:string, [encoding:string])");
  });
});

describe("coerceArg + argsFromPairs", () => {
  it("types values via the schema", () => {
    expect(coerceArg("3000", "number")).toBe(3000);
    expect(coerceArg("true", "boolean")).toBe(true);
    expect(coerceArg("hello", "string")).toBe("hello");
    expect(coerceArg('{"a":1}')).toEqual({ a: 1 });
  });
  it("builds an args object from k=v pairs typed by schema", () => {
    const tool: McpTool = { name: "process_port", inputSchema: { properties: { port: { type: "number" } } } };
    expect(argsFromPairs(["port=3000"], tool)).toEqual({ port: 3000 });
  });
});

describe("renderToolResult", () => {
  it("flattens text content blocks", () => {
    expect(renderToolResult({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
  });
});

describe("GatewayClient MCP (mock fetch)", () => {
  it("mcpListTools follows cursor pagination", async () => {
    const original = globalThis.fetch;
    const sse = (obj: any) => new Response(`data: ${JSON.stringify({ result: obj, jsonrpc: "2.0", id: 1 })}\n\n`, { status: 200 });
    globalThis.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.method !== "tools/list") throw new Error("unexpected " + body.method);
      return body.params.cursor
        ? sse({ tools: [{ name: "b" }] })
        : sse({ tools: [{ name: "a" }], nextCursor: "c2" });
    }) as any;
    try {
      const tools = await new GatewayClient("http://x").mcpListTools();
      expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("mcpCallTool sends tools/call with name+arguments and Accept SSE", async () => {
    const original = globalThis.fetch;
    let sentBody: any, sentHeaders: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      sentHeaders = init.headers;
      return new Response(`data: ${JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] }, id: 1 })}\n\n`, { status: 200 });
    }) as any;
    try {
      const r = await new GatewayClient("http://x", "olm_key").mcpCallTool("read_file", { path: "a.ts" });
      expect(sentBody).toMatchObject({ method: "tools/call", params: { name: "read_file", arguments: { path: "a.ts" } } });
      expect(sentHeaders.Accept).toContain("text/event-stream");
      expect(sentHeaders.Authorization).toBe("Bearer olm_key");
      expect(renderToolResult(r)).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("maps a 401 on /mcp to an OLLAMAS_API_KEY hint", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as any;
    try {
      await expect(new GatewayClient("http://x").mcpListTools()).rejects.toThrow(/OLLAMAS_API_KEY/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("upstream CRUD hits the right path/method with Bearer", async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; method: string; auth?: string }> = [];
    globalThis.fetch = (async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method || "GET", auth: init.headers?.Authorization });
      if (init.method === "DELETE") return new Response(JSON.stringify({ deleted: "u1", toolsRemoved: 3 }), { status: 200 });
      if (init.method === "POST") return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      return new Response(JSON.stringify([{ id: "u1", name: "n" }]), { status: 200 });
    }) as any;
    try {
      const client = new GatewayClient("http://x", "olm_key");
      await client.listUpstreams();
      await client.addUpstream({ name: "n", transport: "http", url: "http://u" });
      const del = await client.removeUpstream("u1");
      expect(del).toEqual({ deleted: "u1", toolsRemoved: 3 });
      expect(calls[0]).toMatchObject({ url: "http://x/api/saas/upstreams", method: "GET", auth: "Bearer olm_key" });
      expect(calls[1]).toMatchObject({ url: "http://x/api/saas/upstreams", method: "POST" });
      expect(calls[2]).toMatchObject({ url: "http://x/api/saas/upstreams/u1", method: "DELETE" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("mcpInfo reads the public exposure endpoint", async () => {
    const original = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ exposeTiers: ["safe"], exposedTools: ["read_file"], upstreams: [] }), { status: 200 });
    }) as any;
    try {
      const info = await new GatewayClient("http://x").mcpInfo();
      expect(info.exposedTools).toEqual(["read_file"]);
      expect(url).toBe("http://x/api/mcp/upstreams");
    } finally {
      globalThis.fetch = original;
    }
  });
});
