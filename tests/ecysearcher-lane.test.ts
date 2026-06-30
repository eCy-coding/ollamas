import { describe, it, expect } from "vitest";
import { ecyDir, ecyBaseUrl, ecyHealthUrl, composeArgs, parseLaneArgs, composeEnv } from "../scripts/ecysearcher-lane.mjs";
import { complete, COMMAND_TREE } from "../cli/lib/completion";

describe("ecysearcher-lane — pure helpers", () => {
  it("ecyDir / ecyBaseUrl default (remapped :5055) + env override", () => {
    expect(ecyDir({})).toBe("/Users/emrecnyngmail.com/projem/eCySearcher");
    expect(ecyDir({ ECYSEARCHER_DIR: "/x/y" })).toBe("/x/y");
    expect(ecyBaseUrl({})).toBe("http://localhost:5055"); // dodges AirPlay :5000
    expect(ecyBaseUrl({ ECYSEARCHER_API_PORT: "5099" })).toBe("http://localhost:5099");
    expect(ecyBaseUrl({ ECYSEARCHER_URL: "http://h:5050/" })).toBe("http://h:5050");
  });

  it("ecyHealthUrl builds the Flask root liveness URL", () => {
    expect(ecyHealthUrl({})).toBe("http://localhost:5055/");
    expect(ecyHealthUrl({ ECYSEARCHER_URL: "http://h:5050" })).toBe("http://h:5050/");
  });

  it("composeEnv remaps the conflicting host ports (AirPlay/ecypro-safe)", () => {
    const e = composeEnv({});
    expect(e.API_PORT).toBe("5055");
    expect(e.DB_PORT).toBe("5433");
    expect(e.REDIS_PORT).toBe("6380");
    expect(e.FRONTEND_PORT).toBe("8088");
    expect(composeEnv({ ECYSEARCHER_DB_PORT: "5599" }).DB_PORT).toBe("5599"); // overridable
  });

  it("composeArgs emits docker compose v2 argv incl. logs", () => {
    expect(composeArgs("up")).toEqual(["compose", "up", "-d", "--build"]);
    expect(composeArgs("down")).toEqual(["compose", "down"]);
    expect(composeArgs("ps")).toEqual(["compose", "ps"]);
    expect(composeArgs("logs")).toEqual(["compose", "logs", "--tail", "200", "--no-color"]);
    expect(() => composeArgs("bogus")).toThrow(/unknown compose action/);
  });

  it("parseLaneArgs: action + flags, defaults to status; logs accepted", () => {
    expect(parseLaneArgs([])).toEqual({ action: "status", dry: false, json: false });
    expect(parseLaneArgs(["up", "--dry"])).toEqual({ action: "up", dry: true, json: false });
    expect(parseLaneArgs(["logs"])).toEqual({ action: "logs", dry: false, json: false });
    expect(parseLaneArgs(["health", "--json"])).toEqual({ action: "health", dry: false, json: true });
    expect(parseLaneArgs(["bogus"])).toEqual({ action: "status", dry: false, json: false }); // unknown ignored
  });
});

describe("ecysearcher — CLI completion wired", () => {
  it("ecysearcher is a top-level command with up/down/status/health/logs sub-actions", () => {
    expect(COMMAND_TREE.commands).toContain("ecysearcher");
    expect(complete(["ecysearcher"])).toEqual(expect.arrayContaining(["up", "down", "status", "health", "logs"]));
  });
});
