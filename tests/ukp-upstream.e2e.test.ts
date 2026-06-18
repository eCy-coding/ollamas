// uk-pipeline ↔ ollamas E2E wire (v12.2). Proves ollamas CONSUMES uk-pipeline's MCP
// stdio server through the single ToolRegistry choke-point: spawns `python3 ukp.py
// --mcp-server`, lists tools, calls mcp__ukp__hesapla and asserts the real result.
// Skips gracefully if uk-pipeline or python3 is absent (CI without the sibling repo).
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
// uk-pipeline is a sibling of ollamas (~/Desktop/uk-pipeline). Absolute path mirrors
// the static tools.json `mcpServers` entry used in production.
const UKP = path.resolve(ROOT, "..", "uk-pipeline", "ukp.py");
const HAVE_UKP = fs.existsSync(UKP);

describe("MCP gateway CONSUME — uk-pipeline upstream (mcp__ukp__*)", () => {
  test.skipIf(!HAVE_UKP)(
    "connectUpstream spawns uk-pipeline stdio server; hesapla reachable via choke-point",
    async () => {
      process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-ukp-${process.pid}.db`);
      const { connectUpstream } = await import("../server/mcp/client");
      const { ToolRegistry } = await import("../server/tool-registry");

      const r = await connectUpstream({
        name: "ukp",
        transport: "stdio",
        command: "python3",
        args: [UKP, "--mcp-server"],
        allowedTools: ["hesapla", "sorgu", "kume", "seyir", "selftest"],
      });
      expect(r.ok).toBe(true);
      expect(r.tools).toBeGreaterThanOrEqual(5); // 5 local-safe tools (pipeline excluded by allowlist)
      expect(ToolRegistry.has("mcp__ukp__hesapla")).toBe(true);
      // Cloud `pipeline` tool must NOT be exposed (not in allowlist → isolation/cost guard).
      expect(ToolRegistry.has("mcp__ukp__pipeline")).toBe(false);

      // Real call through the choke-point: expr.hesapla("3+4*2") == 11.
      const out = await ToolRegistry.execute(
        "mcp__ukp__hesapla",
        { ifade: "3+4*2" },
        { isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any },
      );
      expect(out.ok).toBe(true);
      expect(out.output).toBe("11");
    },
    30000,
  );

  test.skipIf(!HAVE_UKP)("uk-pipeline tools register at host_upstream tier", async () => {
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");
    await connectUpstream({
      name: "ukp", transport: "stdio", command: "python3", args: [UKP, "--mcp-server"],
      allowedTools: ["hesapla"],
    });
    const t = ToolRegistry.list().find((x) => x.name === "mcp__ukp__hesapla");
    expect(t?.tier).toBe("host_upstream"); // untrusted upstream → gated, not in default expose
  }, 30000);
});
