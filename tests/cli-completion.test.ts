import { describe, it, expect } from "vitest";
import { complete, completionScript, COMMAND_TREE } from "../cli/lib/completion";

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
