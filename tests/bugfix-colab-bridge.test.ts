// vC2-bridge — colab-bridge GenFn adapter. Hermetic: node:child_process.spawnSync
// is mocked via vi.mock (builtin namespaces are not spyable in ESM).

import { describe, test, expect, vi, beforeEach } from "vitest";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync }));

import { colabGen, colabRuntimeAvailable } from "../bugfix/colab-bridge";

beforeEach(() => spawnSync.mockReset());

describe("colabGen", () => {
  test("returns trimmed stdout as text", async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "  2 + 2 = 4\n", stderr: "" });
    expect(await colabGen("2+2?")).toEqual({ text: "2 + 2 = 4" });
  });

  test("passes model + system to the helper and prompt via stdin", async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "ok", stderr: "" });
    await colabGen("the prompt", { model: "google/gemini-2.5-flash-lite", system: "be terse" });
    const [cmd, argv, opts] = spawnSync.mock.calls[0];
    expect(cmd).toBe("python3");
    expect(argv).toContain("--model");
    expect(argv).toContain("google/gemini-2.5-flash-lite");
    expect(argv).toContain("--system");
    expect(opts.input).toBe("the prompt");
  });

  test("throws with stderr on non-zero exit", async () => {
    spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "colab_exec failed: boom" });
    await expect(colabGen("x")).rejects.toThrow(/boom/);
  });
});

describe("colabRuntimeAvailable", () => {
  test("false when COLAB_TOKEN is unset", () => {
    delete process.env.COLAB_TOKEN;
    expect(colabRuntimeAvailable()).toBe(false);
  });

  test("true when token set and curl returns a non-empty kernel array", () => {
    process.env.COLAB_TOKEN = "tok";
    spawnSync.mockReturnValue({ status: 0, stdout: '[{"id":"k1","name":"python3"}]', stderr: "" });
    expect(colabRuntimeAvailable()).toBe(true);
    delete process.env.COLAB_TOKEN;
  });
});
