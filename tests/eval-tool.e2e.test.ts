// eval_prompt tool (v1.12). Proves promptfoo verify-stage output flows through
// the ToolRegistry choke-point. Parsing is unit-tested with canned promptfoo
// JSON; a RUN_LIVE_E2E test runs the real binary on a config when present.
import { describe, test, expect } from "vitest";
import { ToolRegistry, parsePromptfoo } from "../server/tool-registry";

// Representative `promptfoo eval -o json` output: 3 pass, 1 fail.
const CANNED = JSON.stringify({
  results: {
    stats: { successes: 3, failures: 1, tokenUsage: { total: 1234 } },
    results: [
      { success: true, description: "greets politely" },
      { success: true, description: "answers in english" },
      { success: true, description: "no profanity" },
      { success: false, description: "stays under 50 tokens", error: "output too long" },
    ],
  },
});

const fakeDeps = (out: any) => ({ execOnHost: async () => out, shArg: (s: string) => `'${s}'` } as any);
const ctx = (deps: any) => ({ isLive: false, workspaceRoot: ".", autoApply: true, deps });

describe("eval_prompt — promptfoo verify stage via choke-point", () => {
  test("parsePromptfoo extracts passRate + failing cases", () => {
    const r = parsePromptfoo(CANNED);
    expect(r.pass).toBe(3);
    expect(r.total).toBe(4);
    expect(r.passRate).toBeCloseTo(0.75);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].error).toBe("output too long");
  });

  test("parsePromptfoo tolerates top-level stats shape + log noise", () => {
    const r = parsePromptfoo(`running eval...\n${JSON.stringify({ stats: { successes: 1, failures: 0 }, results: [] })}\ndone`);
    expect(r.pass).toBe(1);
    expect(r.passRate).toBe(1);
  });

  test("ToolRegistry.execute('eval_prompt') returns structured passRate", async () => {
    const out = await ToolRegistry.execute(
      "eval_prompt",
      { config_path: "promptfooconfig.yaml" },
      ctx(fakeDeps({ ok: true, exitCode: 0, output: CANNED })),
    );
    expect(out.ok).toBe(true);
    expect(out.output.passRate).toBeCloseTo(0.75);
    expect(out.output.total).toBe(4);
  });

  test("eval_prompt surfaces a failed binary as ok:false (never throws)", async () => {
    const out = await ToolRegistry.execute(
      "eval_prompt",
      { config_path: "missing.yaml" },
      ctx(fakeDeps({ ok: false, exitCode: 1, output: "promptfoo: config not found" })),
    );
    expect(out.ok).toBe(false);
    expect(String(out.output.error)).toContain("promptfoo failed");
  });

  test("eval_prompt registers at host tier", () => {
    expect(ToolRegistry.tier("eval_prompt")).toBe("host");
  });
});
