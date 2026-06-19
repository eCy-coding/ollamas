import { describe, it, expect } from "vitest";
import { resolveProfileName, profilePath, configPath } from "../cli/lib/config";
import { extractGlobalFlags } from "../cli/index";

describe("resolveProfileName precedence (flag > env > active > default)", () => {
  it("flag wins over everything", () => {
    expect(resolveProfileName("flagp", "envp", "activep")).toBe("flagp");
  });
  it("env wins when no flag", () => {
    expect(resolveProfileName(undefined, "envp", "activep")).toBe("envp");
  });
  it("active pointer wins when no flag/env", () => {
    expect(resolveProfileName(undefined, undefined, "activep")).toBe("activep");
  });
  it("falls back to default", () => {
    expect(resolveProfileName(undefined, undefined, undefined)).toBe("default");
    expect(resolveProfileName("", "", "")).toBe("default");
  });
  it("trims whitespace-only to default", () => {
    expect(resolveProfileName("  ", undefined, undefined)).toBe("default");
  });
});

describe("profilePath layout", () => {
  it("default → cli.json (back-compat)", () => {
    expect(profilePath("default")).toBe(configPath());
  });
  it("named → ~/.ollamas/profiles/<name>.json", () => {
    expect(profilePath("box")).toMatch(/\/\.ollamas\/profiles\/box\.json$/);
  });
  it("rejects an unsafe profile name (path-traversal guard)", () => {
    expect(() => profilePath("../etc/passwd")).toThrow(/invalid profile name/);
    expect(() => profilePath("a/b")).toThrow(/invalid profile name/);
  });
});

describe("--profile global flag (realizes flag precedence via env)", () => {
  it("extracts --profile <name> and leaves the command in rest", () => {
    const g = extractGlobalFlags(["--profile", "box", "chat", "hi"]);
    expect(g.profile).toBe("box");
    expect(g.rest).toEqual(["chat", "hi"]);
  });
  it("supports --profile=<name>", () => {
    expect(extractGlobalFlags(["--profile=box", "doctor"]).profile).toBe("box");
  });
  it("coexists with --gateway", () => {
    const g = extractGlobalFlags(["--gateway", "http://x", "--profile", "box", "mcp", "tools"]);
    expect(g.gateway).toBe("http://x");
    expect(g.profile).toBe("box");
    expect(g.rest).toEqual(["mcp", "tools"]);
  });
});
