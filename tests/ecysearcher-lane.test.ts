import { describe, it, expect } from "vitest";
import { ecyDir, ecyBaseUrl, ecyHealthUrl, composeArgs, parseLaneArgs } from "../scripts/ecysearcher-lane.mjs";
import { complete, COMMAND_TREE } from "../cli/lib/completion";

describe("ecysearcher-lane — pure helpers", () => {
  it("ecyDir / ecyBaseUrl default + env override", () => {
    expect(ecyDir({})).toBe("/Users/emrecnyngmail.com/projem/eCySearcher");
    expect(ecyDir({ ECYSEARCHER_DIR: "/x/y" })).toBe("/x/y");
    expect(ecyBaseUrl({})).toBe("http://localhost:5000");
    expect(ecyBaseUrl({ ECYSEARCHER_URL: "http://h:5050" })).toBe("http://h:5050");
  });

  it("ecyHealthUrl builds the Flask root liveness URL", () => {
    expect(ecyHealthUrl({})).toBe("http://localhost:5000/");
    expect(ecyHealthUrl({ ECYSEARCHER_URL: "http://h:5050" })).toBe("http://h:5050/");
  });

  it("composeArgs emits docker compose v2 argv", () => {
    expect(composeArgs("up")).toEqual(["compose", "up", "-d"]);
    expect(composeArgs("down")).toEqual(["compose", "down"]);
    expect(composeArgs("ps")).toEqual(["compose", "ps"]);
    expect(() => composeArgs("bogus")).toThrow(/unknown compose action/);
  });

  it("parseLaneArgs: action + flags, defaults to status", () => {
    expect(parseLaneArgs([])).toEqual({ action: "status", dry: false, json: false });
    expect(parseLaneArgs(["up"])).toEqual({ action: "up", dry: false, json: false });
    expect(parseLaneArgs(["up", "--dry"])).toEqual({ action: "up", dry: true, json: false });
    expect(parseLaneArgs(["health", "--json"])).toEqual({ action: "health", dry: false, json: true });
    expect(parseLaneArgs(["bogus"])).toEqual({ action: "status", dry: false, json: false }); // unknown ignored
  });
});

describe("ecysearcher — CLI completion wired", () => {
  it("ecysearcher is a top-level command with up/down/status/health sub-actions", () => {
    expect(COMMAND_TREE.commands).toContain("ecysearcher");
    expect(complete(["ecysearcher"])).toEqual(expect.arrayContaining(["up", "down", "status", "health"]));
  });
});
