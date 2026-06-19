import { describe, it, expect, vi } from "vitest";
import { complete, completionScript, COMMAND_TREE } from "../cli/lib/completion";
import { main } from "../cli/index";

// Capture stdout for a single main() invocation.
async function run(argv: string[]): Promise<{ code: number; out: string }> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  try {
    const code = await main(argv);
    return { code, out };
  } finally {
    spy.mockRestore();
  }
}

describe("index wiring (completion + __complete)", () => {
  it("completion bash → prints a bash script", async () => {
    const { code, out } = await run(["completion", "bash"]);
    expect(code).toBe(0);
    expect(out).toContain("complete -F _ollamas ollamas");
  });
  it("completion with no/invalid shell → usage error exit 2", async () => {
    expect((await run(["completion"])).code).toBe(2);
    expect((await run(["completion", "tcsh"])).code).toBe(2);
  });
  it("__complete (no args) → all top-level commands", async () => {
    const { out } = await run(["__complete"]);
    expect(out.split("\n")).toEqual(expect.arrayContaining(["chat", "mcp", "top", "completion"]));
  });
  it("__complete mcp → mcp sub-actions", async () => {
    const { out } = await run(["__complete", "mcp"]);
    expect(out.split("\n")).toEqual(expect.arrayContaining(["info", "tools", "call", "upstreams", "add", "rm"]));
  });
  it("__complete config → use/profiles", async () => {
    const { out } = await run(["__complete", "config"]);
    expect(out).toContain("use");
    expect(out).toContain("profiles");
  });
});

describe("complete (candidate set for a position)", () => {
  it("no words / first empty word → all top-level commands", () => {
    const empty = complete([]);
    expect(empty).toEqual(complete([""]));
    expect(empty).toContain("chat");
    expect(empty).toContain("mcp");
    expect(empty).toContain("top");
    expect(empty).toContain("completion");
  });

  it("first word also offers global flags", () => {
    expect(complete([])).toContain("--gateway");
    expect(complete([])).toContain("--profile");
  });

  it("mcp → its sub-actions", () => {
    expect(complete(["mcp"])).toEqual(expect.arrayContaining(["info", "tools", "call", "upstreams", "add", "rm"]));
  });

  it("saas → its sub-actions", () => {
    expect(complete(["saas"])).toEqual(expect.arrayContaining(["plans", "tenants", "keys", "usage", "billing"]));
  });

  it("config → use/profiles + settable keys", () => {
    const c = complete(["config"]);
    expect(c).toContain("use");
    expect(c).toContain("profiles");
    expect(c).toContain("gateway");
    expect(c).toContain("apiKey");
  });

  it("agent → sessions/rm", () => {
    expect(complete(["agent"])).toEqual(expect.arrayContaining(["sessions", "rm"]));
  });

  it("a command with no sub-actions (top) → empty set", () => {
    expect(complete(["top"])).toEqual([]);
  });

  it("unknown command → empty set", () => {
    expect(complete(["nope"])).toEqual([]);
  });

  it("returns the FULL candidate set (shell prefix-filters, we don't)", () => {
    // 'co' is a partial — we still return the full command list, not a filtered one.
    expect(complete([]).length).toBe(COMMAND_TREE.commands.length + COMMAND_TREE.globalFlags.length);
  });
});

describe("completionScript", () => {
  it("bash script registers a completion function calling __complete", () => {
    const s = completionScript("bash");
    expect(s).toContain("complete -F");
    expect(s).toContain("__complete");
    expect(s).toContain("ollamas");
  });
  it("zsh script uses compdef + __complete", () => {
    const s = completionScript("zsh");
    expect(s).toContain("#compdef ollamas");
    expect(s).toContain("__complete");
  });
  it("fish script uses complete -c calling __complete", () => {
    const s = completionScript("fish");
    expect(s).toContain("complete -c ollamas");
    expect(s).toContain("__complete");
  });
  it("honors a custom bin name", () => {
    expect(completionScript("bash", "olm")).toContain("complete -F _olm olm");
  });
});
