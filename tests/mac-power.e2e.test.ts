// mac_power tool (v1.9). Proves macOS powermetrics power telemetry flows through
// the ToolRegistry choke-point. Parsing is unit-tested with canned powermetrics
// text; a RUN_LIVE_E2E test runs the real (sudo) sampler on darwin when present.
import { describe, test, expect } from "vitest";
import os from "node:os";
import { ToolRegistry, parseMacPower } from "../server/tool-registry";

// Representative `powermetrics --samplers cpu_power` tail (Apple Silicon).
const CANNED = [
  "**** Processor usage ****",
  "CPU Power: 1234 mW",
  "GPU Power: 567 mW",
  "ANE Power: 0 mW",
  "Combined Power (CPU + GPU + ANE): 1801 mW",
].join("\n");

const fakeDeps = (out: any) => ({ execOnHost: async () => out, shArg: (s: string) => s } as any);
const ctx = (deps: any) => ({ isLive: false, workspaceRoot: ".", autoApply: true, deps });

describe("mac_power — powermetrics telemetry via choke-point", () => {
  test("parseMacPower extracts CPU/GPU/ANE/combined mW", () => {
    const r = parseMacPower(CANNED);
    expect(r.cpu_mw).toBe(1234);
    expect(r.gpu_mw).toBe(567);
    expect(r.ane_mw).toBe(0);
    expect(r.combined_mw).toBe(1801);
  });

  test("parseMacPower throws when no power lines present", () => {
    expect(() => parseMacPower("no relevant output here")).toThrow(/no power lines/);
  });

  test("ToolRegistry.execute('mac_power') returns structured numeric power", async () => {
    const out = await ToolRegistry.execute(
      "mac_power",
      { interval_ms: 200 },
      ctx(fakeDeps({ ok: true, exitCode: 0, output: CANNED })),
    );
    expect(out.ok).toBe(true);
    expect(out.output.combined_mw).toBe(1801);
  });

  test("mac_power surfaces a failed sampler as ok:false (never throws)", async () => {
    const out = await ToolRegistry.execute(
      "mac_power",
      {},
      ctx(fakeDeps({ ok: false, exitCode: 1, output: "powermetrics must be invoked as the superuser" })),
    );
    expect(out.ok).toBe(false);
    expect(String(out.output.error)).toContain("powermetrics failed");
  });

  test("mac_power registers at privileged tier", () => {
    expect(ToolRegistry.tier("mac_power")).toBe("privileged");
  });

  // Live: real powermetrics (needs sudo + darwin). Opt-in + skip otherwise.
  // gated: RUN_LIVE_E2E=1 + darwin — runs the real (sudo) powermetrics sampler; no-op elsewhere.
  test.skipIf(process.env.RUN_LIVE_E2E !== "1" || os.platform() !== "darwin")(
    "real powermetrics produces a power reading",
    async () => {
      const { TerminalManager } = await import("../server/terminal");
      const realDeps = {
        shArg: (s: string) => `'${String(s).replace(/'/g, "'\\''")}'`,
        execOnHost: async (cmd: string) => {
          const out = await TerminalManager.execute(true, ".", `sudo ${cmd}`);
          return { ok: true, exitCode: 0, output: typeof out === "string" ? out : JSON.stringify(out) };
        },
      } as any;
      const r = await ToolRegistry.execute("mac_power", { interval_ms: 200 }, ctx(realDeps));
      expect(r.ok).toBe(true);
      expect(Number(r.output.combined_mw ?? r.output.cpu_mw)).toBeGreaterThan(0);
    },
    30000,
  );
});
