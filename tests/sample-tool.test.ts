// Faz 23 (v1.14) — expose-side sampling tool. The `sample` tool asks the connecting
// client's own LLM via ctx.onSample (set only when the client advertised sampling).
// Hermetic: drives the choke-point with a mocked onSample (no transport).
import { describe, test, expect, vi } from "vitest";
import { ToolRegistry } from "../server/tool-registry";

const ctx = (over: any = {}) => ({ isLive: true, workspaceRoot: "/ws", autoApply: true, deps: {} as any, ...over });

describe("expose-side sampling tool (Faz 23)", () => {
  test("forwards the prompt to ctx.onSample and returns the model text", async () => {
    const onSample = vi.fn(async (p: any) => ({ text: "SAMPLED:" + p.messages[0].content.text }));
    const r = await ToolRegistry.execute("sample", { prompt: "ping", maxTokens: 50, system: "be terse" }, ctx({ onSample }));
    expect(r.ok).toBe(true);
    expect(r.output).toBe("SAMPLED:ping");
    expect(onSample).toHaveBeenCalledOnce();
    expect(onSample.mock.calls[0][0].maxTokens).toBe(50);
    expect(onSample.mock.calls[0][0].systemPrompt).toBe("be terse");
  });

  test("without sampling capability → graceful notice, no throw", async () => {
    const r = await ToolRegistry.execute("sample", { prompt: "ping" }, ctx()); // no onSample
    expect(r.ok).toBe(true);
    expect(String(r.output)).toContain("sampling unavailable");
  });

  test("sample is a safe-tier tool (usable on the default free plan)", async () => {
    const r = await ToolRegistry.execute("sample", { prompt: "ping" }, ctx({ allowedTiers: ["safe"], onSample: async () => ({ text: "ok" }) }));
    expect(r.ok).toBe(true);
    expect(r.output).toBe("ok");
  });
});
