/**
 * Command-layer tests for `ollamas gemini` — drives main(argv) with a stdout/stderr spy
 * (no real `gemini` binary required). Pure: stripBadMcpType (the v0.22.2 settings auto-fix).
 */
import { describe, it, expect, vi } from "vitest";
import { main } from "../cli/index";
import { stripBadMcpType } from "../cli/commands/gemini";

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ""; let err = "";
  const so = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => { out += c; return true; });
  const se = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => { err += c; return true; });
  try {
    const code = await main(argv);
    return { code, out, err };
  } finally {
    so.mockRestore(); se.mockRestore();
  }
}

describe("ollamas gemini — command layer", () => {
  it("--help → usage, exit 0", async () => {
    const { code, out } = await run(["gemini", "--help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/usage:/i);
    expect(out).toContain("setup-mcp");
  });

  it("status → reports binary / auth / MCP / gateway (exit 0 or 2)", async () => {
    const { code, out } = await run(["gemini", "status"]);
    expect(out).toContain("gemini binary");
    expect(out).toContain("auth mode");
    expect(out).toContain("ollamas MCP");
    expect([0, 2]).toContain(code); // 0 if the binary is present, 2 (skip-with-warn) if absent
  });

  it("status --json → machine-readable shape", async () => {
    const { out } = await run(["gemini", "status", "--json"]);
    const j = JSON.parse(out);
    expect(j).toHaveProperty("present");
    expect(j).toHaveProperty("authMode");
    expect(j).toHaveProperty("ollamasMcpRegistered");
  });

  it("run without a prompt → usage + exit 2", async () => {
    const { code, err } = await run(["gemini"]);
    expect(code).toBe(2);
    expect(err).toMatch(/missing <prompt>/i);
  });
});

describe("stripBadMcpType (v0.22.2 settings auto-fix)", () => {
  it("removes the invalid type key from the ollamas entry", () => {
    const r = stripBadMcpType({ mcpServers: { ollamas: { httpUrl: "u", type: "http" } } });
    expect(r.fixed).toBe(true);
    expect(r.settings.mcpServers.ollamas).toEqual({ httpUrl: "u" });
  });
  it("no-op when there is no bad type", () => {
    const ok = { mcpServers: { ollamas: { httpUrl: "u" } } };
    expect(stripBadMcpType(ok).fixed).toBe(false);
  });
  it("total on missing/garbage settings", () => {
    expect(stripBadMcpType({}).fixed).toBe(false);
    expect(stripBadMcpType(null).fixed).toBe(false);
  });
});
