// bench_model tool (v1.8). Proves llama.cpp `llama-bench` tok/s telemetry flows
// through the ToolRegistry choke-point. Parsing is unit-tested with canned JSON
// (no binary needed); a RUN_LIVE_E2E test exercises the real binary when present.
import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";
import { ToolRegistry, parseLlamaBench } from "../server/tool-registry";

// Representative `llama-bench -o json` output: a prompt-processing row (n_gen=0)
// and a generation row (n_gen>0). tps comes from the generation row's avg_ts.
const CANNED = JSON.stringify([
  { model_filename: "qwen3-8b-q4.gguf", n_prompt: 512, n_gen: 0, avg_ts: 980.4 },
  { model_filename: "qwen3-8b-q4.gguf", n_prompt: 0, n_gen: 128, avg_ts: 76.3 },
]);

const fakeDeps = (out: any) =>
  ({ execOnHost: async () => out, shArg: (s: string) => `'${s}'` } as any);
const ctx = (deps: any) => ({ isLive: false, workspaceRoot: ".", autoApply: true, deps });

describe("bench_model — llama-bench tok/s via choke-point", () => {
  test("parseLlamaBench extracts gen tps + pp_tps", () => {
    const r = parseLlamaBench(CANNED);
    expect(r.tps).toBe(76.3);
    expect(r.pp_tps).toBe(980.4);
    expect(r.model).toBe("qwen3-8b-q4.gguf");
    expect(r.runs).toBe(2);
  });

  test("parseLlamaBench tolerates log noise around the JSON array", () => {
    const r = parseLlamaBench(`loading model...\n${CANNED}\ndone`);
    expect(r.tps).toBe(76.3);
  });

  test("ToolRegistry.execute('bench_model') returns structured numeric tps", async () => {
    const out = await ToolRegistry.execute(
      "bench_model",
      { model: "/models/qwen3-8b-q4.gguf", n_tokens: 128 },
      ctx(fakeDeps({ ok: true, exitCode: 0, output: CANNED })),
    );
    expect(out.ok).toBe(true);
    expect(typeof out.output.tps).toBe("number");
    expect(out.output.tps).toBeGreaterThan(0);
  });

  test("bench_model surfaces a failed binary as ok:false (never throws)", async () => {
    const out = await ToolRegistry.execute(
      "bench_model",
      { model: "/nope.gguf" },
      ctx(fakeDeps({ ok: false, exitCode: 127, output: "llama-bench: command not found" })),
    );
    expect(out.ok).toBe(false);
    expect(String(out.output.error)).toContain("llama-bench failed");
  });

  test("bench_model registers at host tier", () => {
    expect(ToolRegistry.tier("bench_model")).toBe("host");
  });

  // Live: real llama-bench against a real GGUF. Opt-in + skip if binary/model absent.
  const haveBinary = (() => {
    try { execSync("command -v llama-bench", { stdio: "ignore" }); return true; } catch { return false; }
  })();
  const MODEL = process.env.LLAMA_BENCH_MODEL;
  // gated: RUN_LIVE_E2E=1 + llama-bench binary + LLAMA_BENCH_MODEL — runs the real llama-bench.
  test.skipIf(process.env.RUN_LIVE_E2E !== "1" || !haveBinary || !MODEL)(
    "real llama-bench produces a positive tps",
    async () => {
      const { TerminalManager } = await import("../server/terminal");
      const realDeps = {
        shArg: (s: string) => `'${String(s).replace(/'/g, "'\\''")}'`,
        execOnHost: async (cmd: string) => {
          const out = await TerminalManager.execute(true, ".", cmd);
          return { ok: true, exitCode: 0, output: typeof out === "string" ? out : JSON.stringify(out) };
        },
      } as any;
      const r = await ToolRegistry.execute("bench_model", { model: MODEL, n_tokens: 64 }, ctx(realDeps));
      expect(r.ok).toBe(true);
      expect(r.output.tps).toBeGreaterThan(0);
    },
    240000,
  );
});
