// Faz 23 (v1.14) — expose-side sampling over stdio (bidirectional). A sampling-
// capable client connects to `bin/mcp-stdio.ts`, calls the `sample` tool, and the
// server reaches BACK to the client's LLM (server.createMessage → client's
// CreateMessageRequest handler). Mirror of consume-sampling.test.ts (opposite
// direction). Proves ctx.onSample is wired through the choke-point on the expose side.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WS = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-sample-ws-"));

afterAll(() => { try { fs.rmSync(WS, { recursive: true, force: true }); } catch {} });

describe("MCP stdio EXPOSE — sampling tool (Faz 23 e2e)", () => {
  test("a sampling-capable client's `sample` call is answered by the client's LLM", async () => {
    const c = new Client({ name: "sampler-client", version: "0" }, { capabilities: { sampling: {} } });
    // The client answers the server's createMessage request with its "LLM".
    c.setRequestHandler(CreateMessageRequestSchema, async (req) => {
      const text = (req.params?.messages?.[0]?.content as any)?.text ?? "";
      return { role: "assistant", content: { type: "text", text: "CLIENT-LLM-REPLY:" + text }, model: "test-model", stopReason: "endTurn" };
    });

    const tr = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "bin/mcp-stdio.ts"],
      cwd: ROOT,
      env: { ...process.env, OLLAMAS_WORKSPACE: WS } as Record<string, string>,
    });
    await c.connect(tr);
    const res: any = await c.callTool({ name: "sample", arguments: { prompt: "ping" } });
    await c.close();

    const out = Array.isArray(res.content) ? res.content.map((x: any) => x.text).join("") : "";
    expect(out).toContain("CLIENT-LLM-REPLY:ping");
  }, 40000);
});
