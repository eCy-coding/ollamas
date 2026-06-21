import { describe, it, expect } from "vitest";
import {
  renderResourceContents,
  renderPromptMessages,
  formatPromptSignature,
  promptArgsFromPairs,
  type McpPrompt,
} from "../cli/lib/mcp";
import { GatewayClient } from "../cli/lib/client";

const ctx = { color: false } as any; // c() returns raw text when color is off
const sse = (obj: any) => new Response(`data: ${JSON.stringify({ result: obj, jsonrpc: "2.0", id: 1 })}\n\n`, { status: 200 });

describe("renderResourceContents", () => {
  it("prints text contents raw", () => {
    expect(renderResourceContents({ contents: [{ uri: "f://a", text: "hello" }, { text: "world" }] })).toBe("hello\nworld");
  });
  it("summarizes a binary blob instead of dumping it", () => {
    const out = renderResourceContents({ contents: [{ blob: "QUJD", mimeType: "image/png" }] });
    expect(out).toContain("[blob image/png");
    expect(out).toContain("base64");
  });
  it("empty → empty string", () => {
    expect(renderResourceContents({})).toBe("");
  });
});

describe("renderPromptMessages", () => {
  it("renders the message chain as role: text with a description header", () => {
    const out = renderPromptMessages({
      description: "architect stage",
      messages: [
        { role: "system", content: { type: "text", text: "you are an architect" } },
        { role: "user", content: { type: "text", text: "design X" } },
      ],
    });
    expect(out).toBe("# architect stage\nsystem: you are an architect\nuser: design X");
  });
  it("tolerates a bare string content", () => {
    expect(renderPromptMessages({ messages: [{ role: "user", content: "hi" }] })).toBe("user: hi");
  });
});

describe("formatPromptSignature", () => {
  it("shows required bare and optional in [brackets]", () => {
    const p: McpPrompt = { name: "review", arguments: [{ name: "path", required: true }, { name: "depth" }] };
    expect(formatPromptSignature(p, ctx)).toBe("review(path, [depth])");
  });
  it("no args → name()", () => {
    expect(formatPromptSignature({ name: "ping" }, ctx)).toBe("ping()");
  });
});

describe("promptArgsFromPairs", () => {
  it("builds a string map (no schema coercion, unlike tool args)", () => {
    expect(promptArgsFromPairs(["path=src/x.ts", "depth=3"])).toEqual({ path: "src/x.ts", depth: "3" });
  });
  it("keeps '=' inside the value", () => {
    expect(promptArgsFromPairs(["q=a=b"])).toEqual({ q: "a=b" });
  });
  it("skips malformed pairs", () => {
    expect(promptArgsFromPairs(["noeq", "k=v"])).toEqual({ k: "v" });
  });
});

describe("GatewayClient resources/prompts (mock fetch)", () => {
  it("mcpListResources follows cursor pagination", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.method !== "resources/list") throw new Error("unexpected " + body.method);
      return body.params.cursor
        ? sse({ resources: [{ uri: "f://b" }] })
        : sse({ resources: [{ uri: "f://a" }], nextCursor: "c2" });
    }) as any;
    try {
      const r = await new GatewayClient("http://x").mcpListResources();
      expect(r.map((x) => x.uri)).toEqual(["f://a", "f://b"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("mcpReadResource sends resources/read with the uri", async () => {
    const original = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return sse({ contents: [{ uri: "f://a", text: "hi" }] });
    }) as any;
    try {
      const r = await new GatewayClient("http://x").mcpReadResource("f://a");
      expect(sent).toMatchObject({ method: "resources/read", params: { uri: "f://a" } });
      expect(renderResourceContents(r)).toBe("hi");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("mcpGetPrompt sends prompts/get with name+arguments", async () => {
    const original = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return sse({ description: "d", messages: [{ role: "user", content: { type: "text", text: "go" } }] });
    }) as any;
    try {
      const r = await new GatewayClient("http://x").mcpGetPrompt("review", { path: "a.ts" });
      expect(sent).toMatchObject({ method: "prompts/get", params: { name: "review", arguments: { path: "a.ts" } } });
      expect(renderPromptMessages(r)).toContain("user: go");
    } finally {
      globalThis.fetch = original;
    }
  });
});
